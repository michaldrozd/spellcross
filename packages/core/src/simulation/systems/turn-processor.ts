import {
  canAffordAttack,
  calculateAttackRange,
  findUnitInState,
  resolveAttack,
  spendAttackCost
} from '../combat/combat-resolver.js';
import { movementMultiplierForStance } from '../pathfinding/hex-pathfinder.js';
import type { HexCoordinate, TacticalBattleState } from '../types.js';
import { axialDistance, coordinateKey, getTile, isNeighbor } from '../utils/grid.js';
import { updateAllFactionsVision, updateFactionVision } from '../visibility/vision.js';

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

    this.#state.round += current === 'otherSide' ? 1 : 0;
    this.#state.activeFaction = next;
    this.#state.timeline.push({
      kind: 'round:started',
      round: this.#state.round,
      activeFaction: next
    });

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

    let accumulatedCost = 0;
    const from = { ...unit.coordinate };
    let origin = { ...unit.coordinate };
    const visited = new Set<string>([coordinateKey(origin)]);
    const movementMultiplier = movementMultiplierForStance(unit.stance);

    for (const step of input.path) {
      if (!isNeighbor(origin, step)) {
        return { success: false, error: 'Path contains non-adjacent steps' };
      }

      const tile = getTile(this.#state.map, step);
      if (!tile || !tile.passable) {
        return { success: false, error: 'Destination tile is not passable' };
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

    unit.coordinate = { ...origin };
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

    if (defender.faction === attacker.faction) {
      return { success: false, error: 'Cannot attack friendly unit' };
    }

    if (defender.stance === 'destroyed') {
      return { success: false, error: 'Target already destroyed' };
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
}
