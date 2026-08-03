import {
  canDigIn,
  canRally,
  ENTRENCHED_IDLE_MORALE_PENALTY,
  entrenchmentCap,
  entrenchmentStep,
  isRoutedRetreatStep,
  RALLY_MORALE_GAIN,
  stanceForMorale
} from './morale.js';
import { isDeployableSensor } from './sensor-deployment.js';
import {
  canAffordAttack,
  calculateAttackRange,
  calculateHitChance,
  canWeaponReachCoordinate,
  estimateHitDamage,
  findUnitInState,
  isMedicUnit,
  isSupplyUnit,
  resolveAttack,
  spendAttackCost,
  canWeaponTarget,
  hasWeaponLineOfFire,
  spendAmmo
} from '../combat/combat-resolver.js';
import { canUnitEnterTerrain } from '../pathfinding/hex-pathfinder.js';
import {
  canAffordMovementCost,
  movementMultiplierForStance
} from '../pathfinding/movement.js';
import type { AttackMode, HexCoordinate, TacticalBattleState, UnitInstance } from '../types.js';
import { isoDistance } from '../utils/grid-iso.js';
import { isIsoNeighbor, isoDirectionIndex } from '../utils/grid-iso.js';
import { coordinateKey, getTile, isNeighbor, tileIndex } from '../utils/grid.js';
import { updateAllFactionsVision, updateFactionVision } from '../visibility/vision.js';

export interface TurnContext {
  state: TacticalBattleState;
}

export interface ActionResult {
  success: boolean;
  events?: TacticalBattleState['timeline'];
  // `error` is the English fallback message; `errorKey` is a stable identifier the UI can translate
  // (`t('errors:' + errorKey)`) so a rejected action reads in the player's language instead of always English.
  error?: string;
  errorKey?: string;
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

export interface SupplyActionInput {
  supplierId: string;
  targetId: string;
}

export interface HealActionInput {
  medicId: string;
  targetId: string;
}

// HP a medic restores per action, and the AP it costs.
const HEAL_AMOUNT = 25;
const HEAL_AP_COST = 2;

/**
 * Basic turn processor to unblock UI prototyping.
 */
export interface TurnProcessorOptions {
  random?: () => number;
}

export interface ReactionShot {
  defender: UnitInstance;
  weaponId: string;
  hitChance: number;
  viaOverwatch: boolean;
}

export interface ReactionThreat {
  attackerId: string;
  weaponId: string;
  hitChance: number;
  potentialDamage: number;
  viaOverwatch: boolean;
}

// Enemies that would reaction-fire at `mover` standing at its current coordinate, with the weapon
// each would pick (highest hit chance). This is the single source of truth shared by the engine's
// reaction-fire step and the UI move-threat preview, so the preview can never drift from reality.
export function reactionAttackers(state: TacticalBattleState, mover: UnitInstance): ReactionShot[] {
  const shots: ReactionShot[] = [];
  for (const [faction, side] of Object.entries(state.sides)) {
    if (faction === mover.faction) continue;
    for (const defender of side.units.values()) {
      // Routed units may not attack on their own turn (attackUnit + AI both block them); they must not
      // get free reaction fire either, or the move-threat preview predicts phantom shots from routed foes.
      if (defender.stance === 'destroyed' || defender.stance === 'routed' || defender.embarkedOn) continue;
      const viaOverwatch = defender.statusEffects.has('overwatch');
      // Overwatch banks the AP when it's set, but an empty gun still can't fire a reaction shot.
      if (defender.currentAmmo !== Infinity && defender.currentAmmo <= 0) continue;
      if (!viaOverwatch && !canAffordAttack(defender)) continue;
      const vision = state.vision[defender.faction];
      if (vision && !vision.visibleTiles.has(tileIndex(state.map, mover.coordinate))) continue;

      let bestWeapon: string | null = null;
      let bestHit = 0;
      let bestScore = 0;
      for (const weaponId of Object.keys(defender.stats.weaponRanges)) {
        if (!canWeaponTarget(defender, weaponId, mover)) continue;
        if (!canWeaponReachCoordinate(defender, weaponId, mover.coordinate, state.map)) continue;
        const hitChance = calculateHitChance({ attacker: defender, defender: mover, weaponId, map: state.map, weather: state.weather });
        // pick by expected effective damage (hit × armour/type-aware damage), not raw accuracy
        const score = hitChance * Math.max(1, estimateHitDamage(defender, mover, weaponId, state.map));
        if (score > bestScore) {
          bestScore = score;
          bestHit = hitChance;
          bestWeapon = weaponId;
        }
      }
      if (bestWeapon) shots.push({ defender, weaponId: bestWeapon, hitChance: bestHit, viaOverwatch });
    }
  }
  return shots;
}

// Same selection as reactionAttackers, plus the deterministic damage each shot would deal on a hit —
// used by the UI to decide whether a move would expose a unit to potentially lethal reaction fire.
export function reactionThreats(state: TacticalBattleState, mover: UnitInstance): ReactionThreat[] {
  return reactionAttackers(state, mover).map((shot) => ({
    attackerId: shot.defender.id,
    weaponId: shot.weaponId,
    hitChance: shot.hitChance,
    potentialDamage: estimateHitDamage(shot.defender, mover, shot.weaponId, state.map),
    viaOverwatch: shot.viaOverwatch
  }));
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

    // Resolve stationary defense and morale for the side that just ended its turn.
    const justEnded = this.#state.sides[current];
    for (const unit of justEnded.units.values()) {
      if (unit.stance === 'destroyed') continue;
      // embarked passengers ride inside the carrier; their coordinate is frozen at the embark tile,
      // so entrenching / morale-by-proximity here would use a stale position.
      if (unit.embarkedOn) continue;
      const spentActionPoints = unit.actionPoints < unit.maxActionPoints;
      const fullyIdle = !unit.movedThisRound && !unit.dugInThisRound && !spentActionPoints;
      const cap = entrenchmentCap(unit);
      if (fullyIdle && cap > 0) {
        unit.entrench = Math.min(cap, (unit.entrench ?? 0) + entrenchmentStep(unit));
      }

      const fullyEntrenchedAndIdle = fullyIdle && cap > 0 && (unit.entrench ?? 0) >= cap;
      unit.idleEntrenchedTurns = fullyEntrenchedAndIdle
        ? (unit.idleEntrenchedTurns ?? 0) + 1
        : 0;

      // Morale recovery and proximity effects
      const enemySide = this.#state.sides[next];
      let nearbyEnemy = false;
      for (const enemy of enemySide.units.values()) {
        if (enemy.stance === 'destroyed' || enemy.embarkedOn) continue;
        if (isoDistance(enemy.coordinate, unit.coordinate) <= 1) { nearbyEnemy = true; break; }
      }
      const baseRecovery = 3 + (unit.entrench ?? 0);
      const penalty = nearbyEnemy ? 2 : 0;
      unit.currentMorale = Math.min(100, Math.max(0, unit.currentMorale + baseRecovery - penalty));
      unit.stance = stanceForMorale(unit.currentMorale);

      // Commander aura (+2 morale if any friendly hero within 2 hexes). Non-stacking.
      const hasCommanderNearby = (() => {
        for (const f of justEnded.units.values()) {
          // the aura inspires nearby troops, not the commander itself; embarked heroes have a
          // frozen coordinate and would project it from the embark tile
          if (f.id === unit.id || f.stance === 'destroyed' || f.embarkedOn) continue;
          if (f.unitType === 'hero' && isoDistance(f.coordinate, unit.coordinate) <= 2) return true;
        }
        return false;
      })();
      if (hasCommanderNearby) {
        unit.currentMorale = Math.min(100, unit.currentMorale + 2);
        unit.stance = stanceForMorale(unit.currentMorale);
      }

      // Fear aura: supernatural enemies (undead, demons, the titan) sap the morale of mundane
      // troops within 2 hexes. Strongest source wins, no stacking. Units that project fear
      // themselves are fearless and immune.
      if (!unit.stats.fear) {
        let dread = 0;
        for (const enemy of enemySide.units.values()) {
          if (enemy.stance === 'destroyed' || enemy.embarkedOn) continue;
          const f = enemy.stats.fear ?? 0;
          if (f > 0 && isoDistance(enemy.coordinate, unit.coordinate) <= 2) {
            dread = Math.max(dread, f);
          }
        }
        if (dread > 0) {
          unit.currentMorale = Math.max(0, unit.currentMorale - dread * 2);
          unit.stance = stanceForMorale(unit.currentMorale);
        }
      }

      // A fully prepared unit that keeps doing nothing no longer heals back to perfect morale forever.
      // The six-point penalty cancels an infantry bunker’s six-point safe recovery and slightly erodes
      // vehicle crews, while one active turn resets the counter immediately.
      if ((unit.idleEntrenchedTurns ?? 0) >= 2) {
        unit.currentMorale = Math.max(0, unit.currentMorale - ENTRENCHED_IDLE_MORALE_PENALTY);
        unit.stance = stanceForMorale(unit.currentMorale);
      }

      unit.movedThisRound = false;
      unit.dugInThisRound = false;
    }

    this.#state.round += current === 'otherSide' ? 1 : 0;
    this.#state.activeFaction = next;
    this.#state.timeline.push({
      kind: 'round:started',
      round: this.#state.round,
      activeFaction: next
    });

    // Refresh AP/ammo only for the side whose turn is starting. The resting side keeps its leftover
    // AP (so it can reaction-fire) and keeps any overwatch it set on its own turn until its next turn
    // begins — previously both sides were refreshed every endTurn, which cleared overwatch before it
    // could ever fire and double-regenerated ammo (twice per round).
    const startingSide = this.#state.sides[next];
    for (const unit of startingSide.units.values()) {
      unit.actionPoints = unit.maxActionPoints;
      // overwatch is reset at the start of the unit's own next turn
      if (unit.statusEffects.has('overwatch')) {
        unit.statusEffects.delete('overwatch');
      }
      unit.statusEffects.delete('suppression-used');
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

    updateAllFactionsVision(this.#state);

    return { success: true, events: this.#state.timeline };
  }

  moveUnit(input: MoveActionInput): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(input.unitId);

    if (!unit) {
      return { success: false, error: `Unit ${input.unitId} not found`, errorKey: 'unitNotFound' };
    }
    if (unit.sensorDeployed && input.path.length > 0) {
      return { success: false, error: 'Deployed sensors cannot move', errorKey: 'deployedSensorCannotMove' };
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
    const weather = this.#state.weather;
    const weatherMoveMod = weather === 'fog' ? 1.2 : weather === 'night' ? 1.1 : 1;
    const movementMultiplier = movementMultiplierForStance(unit.stance) * weatherMoveMod;

    // First pass: validate path and compute total cost
    let accumulatedCost = 0;
    for (const step of input.path) {
      if (!isNeighbor(origin, step) && !isIsoNeighbor(origin, step)) {
        return { success: false, error: 'Path contains non-adjacent steps', errorKey: 'pathNonAdjacent' };
      }

      const tile = getTile(this.#state.map, step);
      if (!tile || !tile.passable) {
        return { success: false, error: 'Destination tile is not passable', errorKey: 'destinationNotPassable' };
      }
      if (!this.#canUnitEnterTile(unit, tile)) {
        return { success: false, error: 'Unit cannot enter terrain', errorKey: 'unitCannotEnterTerrain' };
      }

      if (visited.has(coordinateKey(step))) {
        return { success: false, error: 'Path loops back on itself', errorKey: 'pathLoopsBack' };
      }

      if (occupied.has(coordinateKey(step))) {
        return { success: false, error: 'Path collides with another unit', errorKey: 'pathCollision' };
      }

      if (unit.stance === 'routed' && !isRoutedRetreatStep(this.#state, unit, origin, step)) {
        return { success: false, error: 'Routed units must retreat from the nearest enemy', errorKey: 'routedMustRetreat' };
      }

      accumulatedCost += tile.movementCostModifier * movementMultiplier;
      origin = { ...step };
      visited.add(coordinateKey(origin));
    }

    if (!canAffordMovementCost(accumulatedCost, unit.actionPoints, input.path.length)) {
      return { success: false, error: 'Not enough action points', errorKey: 'notEnoughActionPoints' };
    }

    if (input.path.length > 0) {
      unit.movedThisRound = true;
      unit.entrench = 0;
      unit.dugInThisRound = false;
      unit.idleEntrenchedTurns = 0;
    }

    // Second pass: execute movement step-by-step and process reaction fire. Each defender may react at
    // most once per move (not once per step) — otherwise a single stationary enemy emptied its whole AP
    // pool on one passing unit and arrived at its own turn unable to act.
    origin = { ...from };
    let costSpent = 0;
    const reactedThisMove = new Set<string>();
    for (const step of input.path) {
      const tile = getTile(this.#state.map, step)!;
      const stepCost = tile.movementCostModifier * movementMultiplier;
      const previous = { ...origin };

      // advance to step
      origin = { ...step };
      // Always store facing in the 8-dir iso/compass space that calculateHitChance's flank/rear logic
      // decodes; the old 6-dir directionIndex fallback was mis-read as a compass index, corrupting the
      // flank/rear accuracy bonus. isoDirectionIndex works for any coordinate pair (sign of the delta).
      unit.orientation = isoDirectionIndex(previous, step);
      unit.coordinate = { ...origin };
      costSpent += stepCost;

      // process reactive fire from opposing units at the new position
      const destroyed = this.#processReactionFireOnMovement(unit, reactedThisMove);
      if (destroyed) {
        // charge spent movement, but do not log a move event
        unit.actionPoints -= costSpent;
        updateFactionVision(this.#state, unit.faction);
        return { success: true, events: this.#state.timeline };
      }
    }

    // movement completed
    unit.actionPoints = Math.max(0, unit.actionPoints - accumulatedCost);
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


  // Returns true if the mover was destroyed by reaction fire. `alreadyReacted` carries the set of
  // defenders that have already fired during this move so none reacts more than once per move.
  #processReactionFireOnMovement(mover: UnitInstance, alreadyReacted: Set<string>): boolean {
    for (const shot of reactionAttackers(this.#state, mover)) {
      const { defender } = shot;
      if (defender.stance === 'destroyed') continue;
      if (alreadyReacted.has(defender.id)) continue;
      alreadyReacted.add(defender.id);

      const outcome = resolveAttack({ attacker: defender, defender: mover, weaponId: shot.weaponId, map: this.#state.map, random: this.#random, weather: this.#state.weather });
      if (shot.viaOverwatch) {
        defender.statusEffects.delete('overwatch');
        spendAmmo(defender);
      } else {
        spendAttackCost(defender);
        spendAmmo(defender);
      }
      this.#state.timeline.push(...outcome.events);

      // update visions for both sides after shots
      updateFactionVision(this.#state, defender.faction);
      updateFactionVision(this.#state, mover.faction);

      if (mover.stance === 'destroyed') {
        this.#killCarriedPassengers(mover, defender.id);
        return true;
      }
    }
    return false;
  }

  // Single source of truth shared with the pathfinders and the AI, so a route the planner accepts
  // is always one moveUnit will execute (previously this allowed only infantry on forest while the
  // pathfinders allowed heroes too, soft-locking hero moves through forest).
  #canUnitEnterTile(unit: UnitInstance, tile: { terrain: string; passable: boolean }): boolean {
    return canUnitEnterTerrain(unit.unitType, tile);
  }

  attackUnit(input: AttackActionInput): ActionResult {
    return this.#executeAttack(input, 'normal');
  }

  suppressUnit(input: AttackActionInput): ActionResult {
    return this.#executeAttack(input, 'suppressive');
  }

  #executeAttack(input: AttackActionInput, attackMode: AttackMode): ActionResult {
    const attackerSide = this.#state.sides[this.#state.activeFaction];
    const attacker = attackerSide.units.get(input.attackerId);
    if (!attacker) {
      return { success: false, error: `Unit ${input.attackerId} not found`, errorKey: 'unitNotFound' };
    }

    const defender = findUnitInState(this.#state, input.defenderId);
    if (!defender) {
      return { success: false, error: `Target ${input.defenderId} not found`, errorKey: 'targetNotFound' };
    }

    if (!canAffordAttack(attacker)) {
      return { success: false, error: 'Not enough action points to attack', errorKey: 'notEnoughApToAttack' };
    }
    if (attacker.currentAmmo !== Infinity && attacker.currentAmmo <= 0) {
      return { success: false, error: 'No ammo', errorKey: 'noAmmo' };
    }

    if (!(input.weaponId in attacker.stats.weaponRanges)) {
      return { success: false, error: `Weapon ${input.weaponId} unavailable`, errorKey: 'weaponUnavailable' };
    }

    // Verify weapon target-type rules
    if (!canWeaponTarget(attacker, input.weaponId, defender)) {
      return { success: false, error: 'Weapon cannot target this unit type', errorKey: 'weaponCannotTarget' };
    }

    if (defender.faction === attacker.faction) {
      return { success: false, error: 'Cannot attack friendly unit', errorKey: 'cannotAttackFriendly' };
    }

    if (defender.stance === 'destroyed') {
      return { success: false, error: 'Target already destroyed', errorKey: 'targetAlreadyDestroyed' };
    }

    if (defender.embarkedOn) {
      return { success: false, error: 'Target is embarked', errorKey: 'targetEmbarked' };
    }

    if (attacker.stance === 'routed') {
      return { success: false, error: 'Routed units cannot attack', errorKey: 'routedCannotAttack' };
    }
    if (attackMode === 'suppressive' && attacker.stance !== 'ready') {
      return { success: false, error: 'Only ready units can use suppressive fire', errorKey: 'suppressionRequiresReady' };
    }
    if (attackMode === 'suppressive' && attacker.statusEffects.has('suppression-used')) {
      return { success: false, error: 'Unit already used suppressive fire this turn', errorKey: 'suppressionAlreadyUsed' };
    }

    const maxRange = calculateAttackRange(attacker, input.weaponId, this.#state.map);
    const distance = isoDistance(attacker.coordinate, defender.coordinate);

    if (distance > maxRange) {
      return { success: false, error: 'Target out of range', errorKey: 'targetOutOfRange' };
    }

    // Fog of war: you can't deliberately fire on an enemy your side cannot currently see. Without this
    // the engine resolved hits on fogged, un-rendered enemies, leaving a "HIT" number floating on an
    // apparently empty tile. (Reaction fire uses resolveAttack directly and is intentionally not gated.)
    const vision = this.#state.vision?.[attacker.faction];
    if (vision) {
      const defIdx = defender.coordinate.r * this.#state.map.width + defender.coordinate.q;
      if (!vision.visibleTiles.has(defIdx)) {
        return { success: false, error: 'Target not visible', errorKey: 'targetNotVisible' };
      }
    }

    if (!hasWeaponLineOfFire(attacker, input.weaponId, defender.coordinate, this.#state.map)) {
      return { success: false, error: 'Direct fire blocked', errorKey: 'directFireBlocked' };
    }

    const outcome = resolveAttack({
      attacker,
      defender,
      weaponId: input.weaponId,
      map: this.#state.map,
      weather: this.#state.weather ?? 'clear',
      random: this.#random,
      attackMode
    });
    attacker.orientation = isoDirectionIndex(attacker.coordinate, defender.coordinate);

    spendAttackCost(attacker);
    spendAmmo(attacker);
    if (attackMode === 'suppressive') attacker.statusEffects.add('suppression-used');
    this.#state.timeline.push(...outcome.events);

    updateFactionVision(this.#state, attacker.faction);
    updateFactionVision(this.#state, defender.faction);

    if ((defender as UnitInstance).stance === 'destroyed') {
      this.#killCarriedPassengers(defender, attacker.id);
    }

    return { success: true, events: outcome.events };
  }

  // When a transport is destroyed, its embarked passengers die with it. Must run from EVERY death
  // path (direct attack, reaction fire, tile demolition) or passengers get orphaned on a dead carrier
  // — uncontrollable, still counted alive, and able to stall battle resolution.
  #killCarriedPassengers(carrier: UnitInstance, byId: string) {
    if (!carrier.carrying || carrier.carrying.length === 0) return;
    for (const pid of carrier.carrying) {
      const passenger = findUnitInState(this.#state, pid);
      if (passenger && passenger.stance !== 'destroyed') {
        passenger.stance = 'destroyed';
        passenger.currentHealth = 0;
        passenger.embarkedOn = undefined;
        this.#state.timeline.push({ kind: 'unit:defeated', unitId: passenger.id, by: byId });
      }
    }
    carrier.carrying = [];
  }

  setOverwatch(unitId: string): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(unitId);
    if (!unit) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (unit.stance === 'routed') return { success: false, error: 'Routed units cannot set overwatch', errorKey: 'routedCannotOverwatch' };
    if (unit.stance === 'suppressed') return { success: false, error: 'Suppressed units cannot set overwatch', errorKey: 'suppressedCannotOverwatch' };
    if (Object.keys(unit.stats.weaponRanges).length === 0) return { success: false, error: 'Unit has no weapon for overwatch', errorKey: 'unitCannotOverwatch' };
    if (!canAffordAttack(unit)) return { success: false, error: 'Not enough AP for overwatch', errorKey: 'notEnoughApOverwatch' };
    if (unit.currentAmmo !== Infinity && unit.currentAmmo <= 0) return { success: false, error: 'No ammo', errorKey: 'noAmmo' };
    unit.statusEffects.add('overwatch');
    unit.actionPoints -= 2;
    this.#state.timeline.push({ kind: 'unit:xp', unitId: unit.id, amount: 0, reason: 'hit' });
    return { success: true };
  }

  setSensorDeployment(unitId: string, deployed: boolean): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(unitId);
    if (!unit) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (!isDeployableSensor(unit)) return { success: false, error: 'Unit has no deployable sensor', errorKey: 'unitCannotDeploySensor' };
    if (unit.stance === 'destroyed' || unit.stance === 'routed' || unit.embarkedOn) {
      return { success: false, error: 'Unit cannot change sensor mode', errorKey: 'sensorModeUnavailable' };
    }
    if (unit.sensorDeployed === deployed) {
      return { success: false, error: 'Sensor is already in that mode', errorKey: 'sensorModeUnchanged' };
    }
    if (deployed && unit.movedThisRound) {
      return { success: false, error: 'Sensor cannot deploy after moving', errorKey: 'movedCannotDeploySensor' };
    }
    if (unit.actionPoints <= 0) {
      return { success: false, error: 'No action points to change sensor mode', errorKey: 'notEnoughApSensorMode' };
    }

    unit.sensorDeployed = deployed;
    unit.actionPoints = 0;
    unit.entrench = 0;
    unit.dugInThisRound = false;
    unit.idleEntrenchedTurns = 0;
    this.#state.timeline.push({ kind: 'unit:sensor-mode', unitId: unit.id, deployed });
    updateFactionVision(this.#state, unit.faction);
    return { success: true, events: this.#state.timeline };
  }

  digIn(unitId: string): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(unitId);
    if (!unit) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (unit.unitType === 'air') return { success: false, error: 'Air units cannot dig in', errorKey: 'airCannotDigIn' };
    if (unit.embarkedOn) return { success: false, error: 'Embarked units cannot dig in', errorKey: 'embarkedCannotDigIn' };
    if (unit.stance === 'routed') return { success: false, error: 'Routed units cannot dig in', errorKey: 'routedCannotDigIn' };
    if (unit.movedThisRound) return { success: false, error: 'A unit cannot dig in after moving', errorKey: 'movedCannotDigIn' };
    if (unit.dugInThisRound) return { success: false, error: 'Unit already dug in this turn', errorKey: 'alreadyDugIn' };
    if ((unit.entrench ?? 0) >= entrenchmentCap(unit)) {
      return { success: false, error: 'Unit is fully entrenched', errorKey: 'fullyEntrenched' };
    }
    if (unit.actionPoints <= 0) return { success: false, error: 'No action points to dig in', errorKey: 'notEnoughApDigIn' };
    if (!canDigIn(unit)) return { success: false, error: 'Unit cannot dig in', errorKey: 'cannotDigIn' };

    unit.entrench = Math.min(entrenchmentCap(unit), (unit.entrench ?? 0) + entrenchmentStep(unit));
    unit.actionPoints = 0;
    unit.dugInThisRound = true;
    unit.idleEntrenchedTurns = 0;
    this.#state.timeline.push({ kind: 'unit:dug-in', unitId: unit.id, level: unit.entrench });
    return { success: true, events: this.#state.timeline };
  }

  rally(unitId: string): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const unit = side.units.get(unitId);
    if (!unit) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (unit.stance !== 'suppressed' && unit.stance !== 'routed') {
      return { success: false, error: 'Only shaken units can rally', errorKey: 'unitCannotRally' };
    }
    if (unit.actionPoints <= 0) return { success: false, error: 'No action points to rally', errorKey: 'notEnoughApRally' };
    if (!canRally(this.#state, unit)) {
      return { success: false, error: 'Enemy too close to rally', errorKey: 'enemyTooCloseToRally' };
    }

    unit.currentMorale = Math.min(100, unit.currentMorale + RALLY_MORALE_GAIN);
    unit.stance = stanceForMorale(unit.currentMorale);
    unit.actionPoints = 0;
    unit.idleEntrenchedTurns = 0;
    this.#state.timeline.push({ kind: 'unit:rallied', unitId: unit.id, morale: unit.currentMorale });
    return { success: true, events: this.#state.timeline };
  }

  embark(input: EmbarkActionInput): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const carrier = side.units.get(input.carrierId);
    const passenger = findUnitInState(this.#state, input.passengerId);
    if (!carrier || !passenger) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (carrier.stance === 'destroyed' || passenger.stance === 'destroyed') {
      return { success: false, error: 'Unit destroyed', errorKey: 'unitDestroyed' };
    }
    if (carrier.faction !== passenger.faction) return { success: false, error: 'Faction mismatch', errorKey: 'factionMismatch' };
    if (carrier.stats.transportCapacity == null || carrier.stats.transportCapacity <= 0) {
      return { success: false, error: 'Carrier has no transport capacity', errorKey: 'carrierNoCapacity' };
    }
    if (carrier.carrying && carrier.carrying.length >= carrier.stats.transportCapacity) {
      return { success: false, error: 'Carrier full', errorKey: 'carrierFull' };
    }
    if (passenger.embarkedOn) return { success: false, error: 'Passenger already embarked', errorKey: 'passengerAlreadyEmbarked' };
    if (passenger.sensorDeployed) return { success: false, error: 'Pack the sensor before embarking', errorKey: 'deployedSensorCannotEmbark' };
    if (passenger.unitType !== 'infantry' && passenger.unitType !== 'support' && passenger.unitType !== 'hero') {
      return { success: false, error: 'Only infantry/support can embark', errorKey: 'onlyInfantrySupportEmbark' };
    }
    if (!isNeighbor(carrier.coordinate, passenger.coordinate) && !isIsoNeighbor(carrier.coordinate, passenger.coordinate) && coordinateKey(carrier.coordinate) !== coordinateKey(passenger.coordinate)) {
      return { success: false, error: 'Not adjacent to carrier', errorKey: 'notAdjacentToCarrier' };
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
    if (!passenger) return { success: false, error: 'Passenger not found', errorKey: 'passengerNotFound' };
    if (!passenger.embarkedOn) return { success: false, error: 'Not embarked', errorKey: 'notEmbarked' };
    const carrier = findUnitInState(this.#state, passenger.embarkedOn);
    if (!carrier) return { success: false, error: 'Carrier missing', errorKey: 'carrierMissing' };
    if (!isNeighbor(carrier.coordinate, input.target) && !isIsoNeighbor(carrier.coordinate, input.target) && coordinateKey(carrier.coordinate) !== coordinateKey(input.target)) {
      return { success: false, error: 'Disembark target not adjacent', errorKey: 'disembarkNotAdjacent' };
    }
    const tile = getTile(this.#state.map, input.target);
    if (!tile || !tile.passable) return { success: false, error: 'Target not passable', errorKey: 'targetNotPassable' };
    const occupied = new Set<string>();
    for (const side of Object.values(this.#state.sides)) {
      for (const u of side.units.values()) {
        if (u.stance === 'destroyed' || u.embarkedOn || u.id === passenger.id) continue;
        occupied.add(coordinateKey(u.coordinate));
      }
    }
    if (occupied.has(coordinateKey(input.target))) return { success: false, error: 'Target occupied', errorKey: 'targetOccupied' };
    passenger.embarkedOn = undefined;
    passenger.statusEffects.delete('embarked');
    passenger.coordinate = { ...input.target };
    if (carrier.carrying) {
      carrier.carrying = carrier.carrying.filter((id) => id !== passenger.id);
    }
    updateFactionVision(this.#state, passenger.faction);
    return { success: true };
  }

  // A supply unit (e.g. the supply truck) refills an adjacent friendly unit's ammo to full for AP.
  supply(input: SupplyActionInput): ActionResult {
    const SUPPLY_AP_COST = 2;
    const side = this.#state.sides[this.#state.activeFaction];
    const supplier = side.units.get(input.supplierId);
    const target = findUnitInState(this.#state, input.targetId);
    if (!supplier || !target) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (supplier.id === target.id) return { success: false, error: 'Cannot resupply self', errorKey: 'cannotResupplySelf' };
    if (supplier.faction !== target.faction) return { success: false, error: 'Faction mismatch', errorKey: 'factionMismatch' };
    if (supplier.stance === 'destroyed' || target.stance === 'destroyed') return { success: false, error: 'Unit destroyed', errorKey: 'unitDestroyed' };
    if (target.embarkedOn) return { success: false, error: 'Target is embarked', errorKey: 'targetEmbarked' };
    if (!isSupplyUnit(supplier)) return { success: false, error: 'Unit cannot resupply', errorKey: 'unitCannotResupply' };
    if (
      !isNeighbor(supplier.coordinate, target.coordinate) &&
      !isIsoNeighbor(supplier.coordinate, target.coordinate)
    ) {
      return { success: false, error: 'Target not adjacent', errorKey: 'targetNotAdjacent' };
    }
    const cap = target.stats.ammoCapacity;
    if (cap === undefined || cap === Infinity) return { success: false, error: 'Target has no ammo store', errorKey: 'targetNoAmmoStore' };
    if (target.currentAmmo >= cap) return { success: false, error: 'Target ammo already full', errorKey: 'targetAmmoFull' };
    // Supply doesn't consume the supplier's own ammo (it carries none), so check AP directly.
    if (supplier.actionPoints < SUPPLY_AP_COST) return { success: false, error: 'Not enough action points to resupply', errorKey: 'notEnoughApResupply' };
    target.currentAmmo = cap;
    supplier.actionPoints -= SUPPLY_AP_COST;
    return { success: true, events: this.#state.timeline };
  }

  // A field medic restores HP to a wounded adjacent friendly unit for AP.
  heal(input: HealActionInput): ActionResult {
    const side = this.#state.sides[this.#state.activeFaction];
    const medic = side.units.get(input.medicId);
    const target = findUnitInState(this.#state, input.targetId);
    if (!medic || !target) return { success: false, error: 'Unit not found', errorKey: 'unitNotFound' };
    if (medic.id === target.id) return { success: false, error: 'Cannot heal self', errorKey: 'cannotHealSelf' };
    if (medic.faction !== target.faction) return { success: false, error: 'Faction mismatch', errorKey: 'factionMismatch' };
    if (medic.stance === 'destroyed' || target.stance === 'destroyed') return { success: false, error: 'Unit destroyed', errorKey: 'unitDestroyed' };
    if (target.embarkedOn) return { success: false, error: 'Target is embarked', errorKey: 'targetEmbarked' };
    if (!isMedicUnit(medic)) return { success: false, error: 'Unit cannot heal', errorKey: 'unitCannotHeal' };
    if (
      !isNeighbor(medic.coordinate, target.coordinate) &&
      !isIsoNeighbor(medic.coordinate, target.coordinate)
    ) {
      return { success: false, error: 'Target not adjacent', errorKey: 'targetNotAdjacent' };
    }
    if (target.currentHealth >= target.stats.maxHealth) return { success: false, error: 'Target at full health', errorKey: 'targetFullHealth' };
    // The medic carries ammo so canAffordAttack would also gate on it; heal only needs AP.
    if (medic.actionPoints < HEAL_AP_COST) return { success: false, error: 'Not enough action points to heal', errorKey: 'notEnoughApHeal' };
    target.currentHealth = Math.min(target.stats.maxHealth, target.currentHealth + HEAL_AMOUNT);
    medic.actionPoints -= HEAL_AP_COST;
    this.#state.timeline.push({ kind: 'unit:xp', unitId: medic.id, amount: 0, reason: 'hit' });
    return { success: true, events: this.#state.timeline };
  }

  attackTile(input: { attackerId: string; target: HexCoordinate; weaponId: string }): ActionResult {
    const attackerSide = this.#state.sides[this.#state.activeFaction];
    const attacker = attackerSide.units.get(input.attackerId);
    if (!attacker) return { success: false, error: `Unit ${input.attackerId} not found`, errorKey: 'unitNotFound' };
    if (attacker.stance === 'routed') {
      return { success: false, error: 'Routed units cannot attack', errorKey: 'routedCannotAttack' };
    }

    const tile = getTile(this.#state.map, input.target);
    if (!tile) return { success: false, error: 'Target tile out of bounds', errorKey: 'targetTileOutOfBounds' };
    if (!tile.destructible || !tile.hp || tile.hp <= 0) {
      return { success: false, error: 'Tile is not destructible', errorKey: 'tileNotDestructible' };
    }

    if (!canAffordAttack(attacker)) {
      return { success: false, error: 'Not enough action points to attack', errorKey: 'notEnoughApToAttack' };
    }

    // Range, spotting and line-of-fire checks against the tile
    const distance = isoDistance(attacker.coordinate, input.target);
    const maxRange = calculateAttackRange(attacker, input.weaponId, this.#state.map);
    if (distance > maxRange) return { success: false, error: 'Target out of range', errorKey: 'targetOutOfRange' };
    const vision = this.#state.vision[attacker.faction];
    if (vision && !vision.visibleTiles.has(tileIndex(this.#state.map, input.target))) {
      return { success: false, error: 'Target not visible', errorKey: 'targetNotVisible' };
    }
    if (!hasWeaponLineOfFire(attacker, input.weaponId, input.target, this.#state.map)) {
      return { success: false, error: 'No line of sight to tile', errorKey: 'noLineOfSightTile' };
    }

    const power = attacker.stats.weaponPower[input.weaponId] ?? 0;
    const damage = Math.max(0, Math.round(power));
    // Refuse a no-op demolition: it would spend AP + ammo to chip 0 HP off the tile.
    if (damage <= 0) return { success: false, error: 'Weapon cannot damage structures', errorKey: 'weaponCannotDamageStructures' };

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
      tile.blocksVision = false;
      this.#state.timeline.push({ kind: 'tile:destroyed', at: { ...input.target } });
      updateAllFactionsVision(this.#state);
    }

    return { success: true, events: this.#state.timeline };
  }

}
