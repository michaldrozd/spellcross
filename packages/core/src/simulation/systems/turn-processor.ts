import {
  canAffordAttack,
  calculateAttackRange,
  calculateHitChance,
  findUnitInState,
  resolveAttack,
  spendAttackCost,
  canWeaponTarget
} from '../combat/combat-resolver.js';
import { movementMultiplierForStance } from '../pathfinding/hex-pathfinder.js';
import type { HexCoordinate, TacticalBattleState, UnitInstance } from '../types.js';
import { axialDistance, coordinateKey, getTile, isNeighbor } from '../utils/grid.js';
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
        if (other.id === unit.id || other.stance === 'destroyed') {
          continue;
        }
        occupied.add(coordinateKey(other.coordinate));
      }
    }

    const from = { ...unit.coordinate };
    let origin = { ...unit.coordinate };
    const visited = new Set<string>([coordinateKey(origin)]);
    const movementMultiplier = movementMultiplierForStance(unit.stance);

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

      accumulatedCost += tile.movementCostModifier * movementMultiplier;
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
      const stepCost = tile.movementCostModifier * movementMultiplier;

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
    this.#state.timeline.push({
      kind: 'unit:moved',
      unitId: unit.id,
      from,
      to: { ...origin },
      cost: accumulatedCost
    });

    updateFactionVision(this.#state, unit.faction);

    return { success: true, events: this.#state.timeline };
  }


  // Returns true if the mover was destroyed by reaction fire
  #processReactionFireOnMovement(mover: UnitInstance): boolean {
    for (const [faction, side] of Object.entries(this.#state.sides)) {
      if (faction === mover.faction) continue;
      for (const defender of side.units.values()) {
        if (defender.stance === 'destroyed') continue;
        if (!canAffordAttack(defender)) continue;
        // require LoS at current positions
        if (!hasLineOfSight(this.#state.map, defender.coordinate, mover.coordinate)) continue;

        // choose a viable weapon with the highest hit chance
        let bestWeapon: string | null = null;
        let bestHit = 0;
        const distance = axialDistance(defender.coordinate, mover.coordinate);
        for (const weaponId of Object.keys(defender.stats.weaponRanges)) {
          const range = calculateAttackRange(defender, weaponId);
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
        spendAttackCost(defender);
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

    const maxRange = calculateAttackRange(attacker, input.weaponId);
    const distance = axialDistance(attacker.coordinate, defender.coordinate);

    if (distance > maxRange) {
      return { success: false, error: 'Target out of range' };
    }

    const outcome = resolveAttack({
      attacker,
      defender,
      weaponId: input.weaponId,
      map: this.#state.map,
      random: this.#random
    });

    spendAttackCost(attacker);
    this.#state.timeline.push(...outcome.events);

    updateFactionVision(this.#state, attacker.faction);
    updateFactionVision(this.#state, defender.faction);

    return { success: true, events: outcome.events };
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
    const maxRange = calculateAttackRange(attacker, input.weaponId);
    if (distance > maxRange) return { success: false, error: 'Target out of range' };
    if (!hasLineOfSight(this.#state.map, attacker.coordinate, input.target)) {
      return { success: false, error: 'No line of sight to tile' };
    }

    const power = attacker.stats.weaponPower[input.weaponId] ?? 0;
    const damage = Math.max(0, Math.round(power));

    tile.hp = Math.max(0, (tile.hp ?? 0) - damage);

    spendAttackCost(attacker);

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
