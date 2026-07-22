import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance, UnitStance } from '../types.js';
import { isoDistance } from '../utils/grid-iso.js';

export const RALLY_MORALE_GAIN = 8;
export const ENTRENCHED_IDLE_MORALE_PENALTY = 6;

export function stanceForMorale(morale: number): Exclude<UnitStance, 'destroyed'> {
  return morale <= 20 ? 'routed' : morale <= 40 ? 'suppressed' : 'ready';
}

export function entrenchmentCap(unit: UnitInstance): number {
  if (unit.unitType === 'air') return 0;
  return unit.unitType === 'vehicle' || unit.unitType === 'artillery' ? 2 : 3;
}

export function entrenchmentStep(unit: UnitInstance): number {
  if (unit.unitType === 'air') return 0;
  return unit.unitType === 'vehicle' || unit.unitType === 'artillery' ? 1 : 2;
}

export function canDigIn(unit: UnitInstance): boolean {
  const cap = entrenchmentCap(unit);
  return cap > 0
    && !unit.embarkedOn
    && unit.stance !== 'destroyed'
    && unit.stance !== 'routed'
    && unit.actionPoints > 0
    && !unit.movedThisRound
    && !unit.dugInThisRound
    && (unit.entrench ?? 0) < cap;
}

function liveEnemies(state: TacticalBattleState, faction: FactionId): UnitInstance[] {
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  return Array.from(state.sides[enemyFaction].units.values()).filter(
    (unit) => unit.stance !== 'destroyed' && !unit.embarkedOn
  );
}

export function nearestEnemyDistance(
  state: TacticalBattleState,
  faction: FactionId,
  coordinate: HexCoordinate
): number {
  const enemies = liveEnemies(state, faction);
  if (enemies.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...enemies.map((enemy) => isoDistance(coordinate, enemy.coordinate)));
}

export function isRoutedRetreatStep(
  state: TacticalBattleState,
  unit: UnitInstance,
  from: HexCoordinate,
  to: HexCoordinate
): boolean {
  const before = nearestEnemyDistance(state, unit.faction, from);
  if (!Number.isFinite(before)) return true;
  return nearestEnemyDistance(state, unit.faction, to) > before;
}

export function canRally(state: TacticalBattleState, unit: UnitInstance): boolean {
  if (unit.embarkedOn || unit.actionPoints <= 0) return false;
  if (unit.stance !== 'suppressed' && unit.stance !== 'routed') return false;
  return nearestEnemyDistance(state, unit.faction, unit.coordinate) > 1;
}
