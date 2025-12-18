import {
  canAffordAttack,
  calculateAttackRange,
  calculateHitChance,
  findUnitInState,
  resolveAttack,
  spendAttackCost,
  canWeaponTarget,
  spendAmmo
} from '../combat/combat-resolver.js';
import { movementMultiplierForStance } from '../pathfinding/hex-pathfinder.js';
import type { HexCoordinate, TacticalBattleState, UnitInstance } from '../types.js';
import { axialDistance, coordinateKey, directionIndex, getTile, isNeighbor } from '../utils/grid.js';
import { hasLineOfSight, updateAllFactionsVision, updateFactionVision } from '../visibility/vision.js';

export interface TurnContext {
  state: TacticalBattleState;
}

export interface ActionResult {
  success: boolean;
  events?: TacticalBattleState['timeline'];
  error?: string;
}

export interface MoveActionInput {
  unitId: string;
  path: HexCoordinate[];
}

export interface AttackActionInput {
  attackerId: string;
  defenderId: string;
  weaponId: string;
}

export interface EmbarkActionInput {
  carrierId: string;
  passengerId: string;
}

export interface DisembarkActionInput {
  passengerId: string;
  target: HexCoordinate;
}

/**
 * Basic turn processor to unblock UI prototyping.
 */
export interface TurnProcessorOptions {
  random?: () => number;
}

export class TurnProcessor {
  #state: TacticalBattleState;
  #random: () => number;

  constructor(state: TacticalBattleState, options: TurnProcessorOptions = {}) {
    this.#state = state;
    this.#random = options.random ?? Math.random;
  }

  get state(): TacticalBattleState {
    return this.#state;
  }

  endTurn(): ActionResult {
    const current = this.#state.activeFaction === 'alliance' ? 'alliance' : 'otherSide';
    const next = current === 'alliance' ? 'otherSide' : 'alliance';

    // Apply entrenchment to units of the side that just ended their turn
    const justEnded = this.#state.sides[current];
    for (const unit of justEnded.units.values()) {
      if (unit.stance === 'destroyed') continue;
      // air cannot entrench
      if (unit.unitType === 'air') continue;
      if (!unit.movedThisRound) {
        unit.entrench = Math.min(3, (unit.entrench ?? 0) + 1);
      }
      // reset move flag for next time
      unit.movedThisRound = false;
      // Morale recovery and proximity effects
      const enemySide = this.#state.sides[next];
      let nearbyEnemy = false;
      for (const enemy of enemySide.units.values()) {
        if (enemy.stance === 'destroyed') continue;
        if (axialDistance(enemy.coordinate, unit.coordinate) <= 1) { nearbyEnemy = true; break; }
      }
      const baseRecovery = 3 + (unit.entrench ?? 0);
      const penalty = nearbyEnemy ? 2 : 0;
      unit.currentMorale = Math.min(100, Math.max(0, unit.currentMorale + baseRecovery - penalty));
      unit.stance = unit.currentMorale <= 20 ? 'routed' : unit.currentMorale <= 40 ? 'suppressed' : 'ready';

      // Commander aura (+2 morale if any friendly hero within 2 hexes). Non-stacking.
      const hasCommanderNearby = (() => {
        for (const f of justEnded.units.values()) {
          if (f.stance === 'destroyed') continue;
          if (f.unitType === 'hero' && axialDistance(f.coordinate, unit.coordinate) <= 2) return true;
        }
        return false;
      })();
      if (hasCommanderNearby) {
        unit.currentMorale = Math.min(100, unit.currentMorale + 2);
      }

    }

    this.#state.round += current === 'otherSide' ? 1 : 0;
    this.#state.activeFaction = next;
    this.#state.timeline.push({
      kind: 'round:started',
      round: this.#state.round,
      activeFaction: next
    });

    // refresh AP at the start of the new active side's turn
    for (const side of Object.values(this.#state.sides)) {
      for (const unit of side.units.values()) {
        unit.actionPoints = unit.maxActionPoints;
        // overwatch reset when AP refreshed
        if (unit.statusEffects.has('overwatch')) {
          unit.statusEffects.delete('overwatch');
        }
        // ammo resupply: small trickle, full if on supply tile
        const cap = unit.stats.ammoCapacity;
        if (cap !== undefined) {
          const supplyTiles = this.#state.supplyZones?.[unit.faction] ?? [];
          const onSupply = supplyTiles.some((c) => c.q === unit.coordinate.q && c.r === unit.coordinate.r);
          if (onSupply) {
            unit.currentAmmo = cap;
          } else {
            const trickle = Math.max(1, Math.floor(cap * 0.25));
            unit.currentAmmo = Math.min(cap, unit.currentAmmo + trickle);
          }
        }
      }
    }

    updateAllFactionsVision(this.#state);

    return { success: true, events: this.#state.timeline };
  }

  moveUnit(input: MoveActionInput): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(input.unitId);

    if (!unit) {
      return { success: false, error: `Unit ${input.unitId} not found` };
    }

    const occupied = new Set<string>();
    for (const sideState of Object.values(this.#state.sides)) {
      for (const other of sideState.units.values()) {
        if (other.id === unit.id || other.stance === 'destroyed' || other.embarkedOn) {
          continue;
        }
        occupied.add(coordinateKey(other.coordinate));
      }
    }

    const from = { ...unit.coordinate };
    let origin = { ...unit.coordinate };
    const visited = new Set<string>([coordinateKey(origin)]);
    const movementMultiplier = movementMultiplierForStance(unit.stance);
    const weather = (this.#state as any).weather as ('clear' | 'night' | 'fog' | undefined);
    const weatherMoveMod = weather === 'fog' ? 1.2 : weather === 'night' ? 1.1 : 1;

    // First pass: validate path and compute total cost
    let accumulatedCost = 0;
    for (const step of input.path) {
      if (!isNeighbor(origin, step)) {
        return { success: false, error: 'Path contains non-adjacent steps' };
      }

      const tile = getTile(this.#state.map, step);
      if (!tile || !tile.passable) {
        return { success: false, error: 'Destination tile is not passable' };
      }
      if (!this.#canUnitEnterTile(unit, tile)) {
        return { success: false, error: 'Unit cannot enter terrain' };
      }

      if (visited.has(coordinateKey(step))) {
        return { success: false, error: 'Path loops back on itself' };
      }

      if (occupied.has(coordinateKey(step))) {
        return { success: false, error: 'Path collides with another unit' };
      }

      accumulatedCost += tile.movementCostModifier * movementMultiplier * weatherMoveMod;
      origin = { ...step };
      visited.add(coordinateKey(origin));
    }

    if (accumulatedCost > unit.actionPoints) {
      return { success: false, error: 'Not enough action points' };
    }

    if (input.path.length > 0) {
      unit.movedThisRound = true;
      unit.entrench = 0;
    }

    // Second pass: execute movement step-by-step and process reaction fire
    origin = { ...from };
    let costSpent = 0;
    for (const step of input.path) {
      const tile = getTile(this.#state.map, step)!;
      const stepCost = tile.movementCostModifier * movementMultiplier * weatherMoveMod;

      // advance to step
      origin = { ...step };
      unit.coordinate = { ...origin };
      costSpent += stepCost;

      // process reactive fire from opposing units at the new position
      const destroyed = this.#processReactionFireOnMovement(unit);
      if (destroyed) {
        // charge spent movement, but do not log a move event
        unit.actionPoints -= costSpent;
        updateFactionVision(this.#state, unit.faction);
        return { success: true, events: this.#state.timeline };
      }
    }

    // movement completed
    unit.actionPoints -= accumulatedCost;
    if (input.path.length > 0) {
      const lastStep = input.path[input.path.length - 1];
      unit.orientation = directionIndex(from, lastStep);
    }
    this.#state.timeline.push({
      kind: 'unit:moved',
      unitId: unit.id,
      from,
      to: { ...origin },
      cost: accumulatedCost
    });

    updateFactionVision(this.#state, unit.faction);
    // Pickup ammo crates if present
    if (this.#state.pickups) {
      for (const pickup of this.#state.pickups) {
        if (pickup.picked) continue;
        if (pickup.kind === 'ammo' && pickup.coordinate.q === unit.coordinate.q && pickup.coordinate.r === unit.coordinate.r) {
          if (unit.stats.ammoCapacity) {
            unit.currentAmmo = Math.min(unit.stats.ammoCapacity, unit.currentAmmo + pickup.amount);
          }
          pickup.picked = true;
          this.#state.timeline.push({ kind: 'unit:xp', unitId: unit.id, amount: 0, reason: 'hit' });
        }
      }
    }

    return { success: true, events: this.#state.timeline };
  }


  // Returns true if the mover was destroyed by reaction fire
  #processReactionFireOnMovement(mover: UnitInstance): boolean {
    for (const [faction, side] of Object.entries(this.#state.sides)) {
      if (faction === mover.faction) continue;
      for (const defender of side.units.values()) {
        if (defender.stance === 'destroyed' || defender.embarkedOn) continue;
        const hasOverwatch = defender.statusEffects.has('overwatch');
        if (!hasOverwatch && !canAffordAttack(defender)) continue;
        // require LoS at current positions
        if (!hasLineOfSight(this.#state.map, defender.coordinate, mover.coordinate)) continue;

        // choose a viable weapon with the highest hit chance
        let bestWeapon: string | null = null;
        let bestHit = 0;
        const distance = axialDistance(defender.coordinate, mover.coordinate);
        for (const weaponId of Object.keys(defender.stats.weaponRanges)) {
          const range = calculateAttackRange(defender, weaponId, this.#state.map);
          if (range <= 0 || distance > range) continue;
          if (!canWeaponTarget(defender, weaponId, mover)) continue;
          const hitChance = calculateHitChance({ attacker: defender, defender: mover, weaponId, map: this.#state.map });
          if (hitChance > bestHit) {
            bestHit = hitChance;
            bestWeapon = weaponId;
          }
        }
        if (!bestWeapon) continue;

        const outcome = resolveAttack({ attacker: defender, defender: mover, weaponId: bestWeapon, map: this.#state.map, random: this.#random });
        if (!hasOverwatch) {
          spendAttackCost(defender);
          spendAmmo(defender);
        } else {
          defender.statusEffects.delete('overwatch');
          spendAmmo(defender);
        }
        this.#state.timeline.push(...outcome.events);

        // update visions for both sides after shots
        updateFactionVision(this.#state, defender.faction);
        updateFactionVision(this.#state, mover.faction);

        if (mover.stance === 'destroyed') {
          return true;
        }

      }
    }
    return false;
  }

  #canUnitEnterTile(unit: UnitInstance, tile: { terrain: string; passable: boolean }): boolean {
    if (!tile.passable) return false;
    switch (tile.terrain) {
      case 'forest':
        return unit.unitType === 'infantry';
      case 'water':
        return unit.unitType === 'air';
      case 'swamp':
        return unit.unitType !== 'air';
      case 'structure':
        return false;
      default:
        return true;
    }
  }

  attackUnit(input: AttackActionInput): ActionResult {
    const attackerSide = this.#state.sides[this.#state.activeFaction];
    const attacker = attackerSide.units.get(input.attackerId);
    if (!attacker) {
      return { success: false, error: `Unit ${input.attackerId} not found` };
    }

    const defender = findUnitInState(this.#state, input.defenderId);
    if (!defender) {
      return { success: false, error: `Target ${input.defenderId} not found` };
    }

    if (!canAffordAttack(attacker)) {
      return { success: false, error: 'Not enough action points to attack' };
    }
    if (attacker.currentAmmo !== Infinity && attacker.currentAmmo <= 0) {
      return { success: false, error: 'No ammo' };
    }
    if (attacker.currentAmmo !== Infinity && attacker.currentAmmo <= 0) {
      return { success: false, error: 'No ammo' };
    }

    if (!(input.weaponId in attacker.stats.weaponRanges)) {
      return { success: false, error: `Weapon ${input.weaponId} unavailable` };
    }

    // Verify weapon target-type rules
    if (!canWeaponTarget(attacker, input.weaponId, defender)) {
      return { success: false, error: 'Weapon cannot target this unit type' };
    }

    if (defender.faction === attacker.faction) {
      return { success: false, error: 'Cannot attack friendly unit' };
    }

    if (defender.stance === 'destroyed') {
      return { success: false, error: 'Target already destroyed' };
    }

    if (attacker.stance === 'routed') {
      return { success: false, error: 'Routed units cannot attack' };
    }

    const maxRange = calculateAttackRange(attacker, input.weaponId, this.#state.map);
    const distance = axialDistance(attacker.coordinate, defender.coordinate);

    if (distance > maxRange) {
      return { success: false, error: 'Target out of range' };
    }

    const outcome = resolveAttack({
      attacker,
      defender,
      weaponId: input.weaponId,
      map: this.#state.map,
      weather: (this.#state as any).weather ?? 'clear',
      random: this.#random
    });
    attacker.orientation = directionIndex(attacker.coordinate, defender.coordinate);

    spendAttackCost(attacker);
    spendAmmo(attacker);
    this.#state.timeline.push(...outcome.events);

    updateFactionVision(this.#state, attacker.faction);
    updateFactionVision(this.#state, defender.faction);

    const destroyedNow = (defender as UnitInstance).stance === 'destroyed';
    if (destroyedNow && defender.carrying && defender.carrying.length) {
      for (const pid of defender.carrying) {
        const passenger = findUnitInState(this.#state, pid);
        if (passenger && passenger.stance !== 'destroyed') {
          passenger.stance = 'destroyed';
          passenger.currentHealth = 0;
          passenger.embarkedOn = undefined;
          this.#state.timeline.push({ kind: 'unit:defeated', unitId: passenger.id, by: attacker.id });
        }
      }
      defender.carrying = [];
    }

    return { success: true, events: outcome.events };
  }

  setOverwatch(unitId: string): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(unitId);
    if (!unit) return { success: false, error: 'Unit not found' };
    if (!canAffordAttack(unit)) return { success: false, error: 'Not enough AP for overwatch' };
    if (unit.currentAmmo !== Infinity && unit.currentAmmo <= 0) return { success: false, error: 'No ammo' };
    unit.statusEffects.add('overwatch');
    unit.actionPoints -= 2;
    this.#state.timeline.push({ kind: 'unit:xp', unitId: unit.id, amount: 0, reason: 'hit' });
    return { success: true };
  }

  embark(input: EmbarkActionInput): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const carrier = side.units.get(input.carrierId);
    const passenger = findUnitInState(this.#state, input.passengerId);
    if (!carrier || !passenger) return { success: false, error: 'Unit not found' };
    if (carrier.faction !== passenger.faction) return { success: false, error: 'Faction mismatch' };
    if (carrier.stats.transportCapacity == null || carrier.stats.transportCapacity <= 0) {
      return { success: false, error: 'Carrier has no transport capacity' };
    }
    if (carrier.carrying && carrier.carrying.length >= carrier.stats.transportCapacity) {
      return { success: false, error: 'Carrier full' };
    }
    if (passenger.embarkedOn) return { success: false, error: 'Passenger already embarked' };
    if (passenger.unitType !== 'infantry' && passenger.unitType !== 'support' && passenger.unitType !== 'hero') {
      return { success: false, error: 'Only infantry/support can embark' };
    }
    if (!isNeighbor(carrier.coordinate, passenger.coordinate) && coordinateKey(carrier.coordinate) !== coordinateKey(passenger.coordinate)) {
      return { success: false, error: 'Not adjacent to carrier' };
    }
    passenger.embarkedOn = carrier.id;
    passenger.statusEffects.add('embarked');
    passenger.coordinate = { ...carrier.coordinate };
    carrier.carrying = carrier.carrying ?? [];
    carrier.carrying.push(passenger.id);
    return { success: true };
  }

  disembark(input: DisembarkActionInput): ActionResult {
    const passenger = findUnitInState(this.#state, input.passengerId);
    if (!passenger) return { success: false, error: 'Passenger not found' };
    if (!passenger.embarkedOn) return { success: false, error: 'Not embarked' };
    const carrier = findUnitInState(this.#state, passenger.embarkedOn);
    if (!carrier) return { success: false, error: 'Carrier missing' };
    if (!isNeighbor(carrier.coordinate, input.target) && coordinateKey(carrier.coordinate) !== coordinateKey(input.target)) {
      return { success: false, error: 'Disembark target not adjacent' };
    }
    const tile = getTile(this.#state.map, input.target);
    if (!tile || !tile.passable) return { success: false, error: 'Target not passable' };
    const occupied = new Set<string>();
    for (const side of Object.values(this.#state.sides)) {
      for (const u of side.units.values()) {
        if (u.stance === 'destroyed' || u.embarkedOn || u.id === passenger.id) continue;
        occupied.add(coordinateKey(u.coordinate));
      }
    }
    if (occupied.has(coordinateKey(input.target))) return { success: false, error: 'Target occupied' };
    passenger.embarkedOn = undefined;
    passenger.statusEffects.delete('embarked');
    passenger.coordinate = { ...input.target };
    if (carrier.carrying) {
      carrier.carrying = carrier.carrying.filter((id) => id !== passenger.id);
    }
    updateFactionVision(this.#state, passenger.faction);
    return { success: true };
  }

  attackTile(input: { attackerId: string; target: HexCoordinate; weaponId: string }): ActionResult {
    const attackerSide = this.#state.sides[this.#state.activeFaction];
    const attacker = attackerSide.units.get(input.attackerId);
    if (!attacker) return { success: false, error: `Unit ${input.attackerId} not found` };

    const tile = getTile(this.#state.map, input.target);
    if (!tile) return { success: false, error: 'Target tile out of bounds' };
    if (!tile.destructible || !tile.hp || tile.hp <= 0) {
      return { success: false, error: 'Tile is not destructible' };
    }

    if (!canAffordAttack(attacker)) {
      return { success: false, error: 'Not enough action points to attack' };
    }

    // Range and LoS check against the tile
    const distance = axialDistance(attacker.coordinate, input.target);
    const maxRange = calculateAttackRange(attacker, input.weaponId, this.#state.map);
    if (distance > maxRange) return { success: false, error: 'Target out of range' };
    if (!hasLineOfSight(this.#state.map, attacker.coordinate, input.target)) {
      return { success: false, error: 'No line of sight to tile' };
    }

    const power = attacker.stats.weaponPower[input.weaponId] ?? 0;
    const damage = Math.max(0, Math.round(power));

    tile.hp = Math.max(0, (tile.hp ?? 0) - damage);

    spendAttackCost(attacker);
    spendAmmo(attacker);

    // If destroyed, convert to plain passable ground and update vision
    if ((tile.hp ?? 0) === 0) {
      tile.terrain = 'plain';
      tile.passable = true;
      tile.cover = 0;
      tile.movementCostModifier = 1;
      tile.providesVisionBoost = false;
      this.#state.timeline.push({ kind: 'tile:destroyed', at: { ...input.target } });
      updateAllFactionsVision(this.#state);
    }

    return { success: true, events: this.#state.timeline };
  }

}
