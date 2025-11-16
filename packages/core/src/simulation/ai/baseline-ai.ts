import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance } from '../types.js';
import { axialDistance, coordinateKey, getNeighbors, getTile, tileIndex } from '../utils/grid.js';
import { calculateHitChance, canWeaponTarget, canAffordAttack, calculateAttackRange } from '../combat/combat-resolver.js';
import { movementMultiplierForStance } from '../pathfinding/hex-pathfinder.js';
import { hasLineOfSight } from '../visibility/vision.js';

export type AIImmediateAction =
  | { type: 'attack'; attackerId: string; defenderId: string; weaponId: string }
  | { type: 'move'; unitId: string; path: HexCoordinate[] }
  | { type: 'endTurn' };

function isUsableUnit(u: UnitInstance): boolean {
  return u.stance !== 'destroyed' && u.actionPoints > 0;
}

function listEnemyUnits(state: TacticalBattleState, faction: FactionId): UnitInstance[] {
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  const side = state.sides[enemyFaction];
  return Array.from(side.units.values()).filter((u) => u.stance !== 'destroyed');
}

function occupiedSet(state: TacticalBattleState): Set<string> {
  const occ = new Set<string>();
  for (const side of Object.values(state.sides)) {
    for (const u of side.units.values()) {
      if (u.stance === 'destroyed') continue;
      occ.add(coordinateKey(u.coordinate));
    }
  }
  return occ;
}
function isAnyEnemyVisible(state: TacticalBattleState, faction: FactionId): boolean {
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  const vis = state.vision[faction]?.visibleTiles;
  if (!vis) return false;
  for (const u of state.sides[enemyFaction].units.values()) {
    if (u.stance === 'destroyed') continue;
    if (vis.has(tileIndex(state.map, u.coordinate))) return true;
  }
  return false;
}

function bestEnemyShotThreat(
  state: TacticalBattleState,
  enemy: UnitInstance,
  defenderAt: UnitInstance
): number {
  if (enemy.stance === 'destroyed') return 0;
  if (!canAffordAttack(enemy)) return 0;
  if (!hasLineOfSight(state.map, enemy.coordinate, defenderAt.coordinate)) return 0;
  let best = 0;
  for (const weaponId of Object.keys(enemy.stats.weaponRanges)) {
    if (!canWeaponTarget(enemy, weaponId, defenderAt)) continue;
    const maxRange = calculateAttackRange(enemy, weaponId, state.map) ?? 0;
    const dist = axialDistance(enemy.coordinate, defenderAt.coordinate);
    if (dist > maxRange) continue;
    const hit = calculateHitChance({ attacker: enemy, defender: defenderAt, weaponId, map: state.map });
    if (hit <= 0) continue;
    const power = enemy.stats.weaponPower[weaponId] ?? 0;
    const score = hit * (power || 1);
    if (score > best) best = score;
  }
  return best;
}

function computeTileThreat(
  state: TacticalBattleState,
  faction: FactionId,
  tile: HexCoordinate,
  unitTemplate: UnitInstance
): number {
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  const defenderAt = { ...unitTemplate, coordinate: tile } as UnitInstance;
  let sum = 0;
  for (const e of state.sides[enemyFaction].units.values()) {
    sum += bestEnemyShotThreat(state, e, defenderAt);
  }
  return sum;
}

function buildThreatAwarePathToward(
  state: TacticalBattleState,
  unit: UnitInstance,
  goal: HexCoordinate
): HexCoordinate[] {
  const occ = occupiedSet(state);
  const mult = movementMultiplierForStance(unit.stance);
  const anyVisible = isAnyEnemyVisible(state, unit.faction);
  // scouting when early or far from enemies or nothing seen
  let nearestDist = Infinity;
  for (const e of listEnemyUnits(state, unit.faction)) {
    const d = axialDistance(unit.coordinate, e.coordinate);
    if (d < nearestDist) nearestDist = d;
  }
  const scouting = (state.round <= 2) || !anyVisible || nearestDist > 8;
  const maxStepsCap = scouting ? 5 : 2;

  const path: HexCoordinate[] = [];
  let ap = unit.actionPoints;
  let current = unit.coordinate;
  const visited = new Set<string>([coordinateKey(current)]);

  for (let steps = 0; steps < maxStepsCap; steps++) {
    let best: { step: HexCoordinate; score: number; cost: number } | null = null;
    const baseDist = axialDistance(current, goal);
    for (const n of getNeighbors(state.map, current)) {
      const k = coordinateKey(n);
      if (visited.has(k)) continue;
      if (occ.has(k)) continue;
      const tile = getTile(state.map, n);
      if (!tile || !tile.passable) continue;
      const cost = tile.movementCostModifier * mult;
      if (cost > ap) continue;

      const distGain = baseDist - axialDistance(n, goal);
      const threat = computeTileThreat(state, unit.faction, n, unit);
      // heuristic weights
      const score = distGain * 8 + (tile.providesVisionBoost ? 0.7 : 0) + tile.cover * 0.3 - threat * 4.5;
      if (!best || score > best.score) best = { step: n, score, cost };
    }
    if (!best) break;

    // stop if the chosen step is clearly disadvantageous (no progress and high threat)
    const chosenTile = getTile(state.map, best.step)!;
    const distGainChosen = axialDistance(current, goal) - axialDistance(best.step, goal);
    const threatChosen = computeTileThreat(state, unit.faction, best.step, unit);
    if (distGainChosen <= 0 && threatChosen > 0.5) break;

    // commit step
    path.push(best.step);
    ap -= best.cost;
    current = best.step;
    visited.add(coordinateKey(current));

    // if we still have enough AP to attack from here and a viable shot exists, stop moving
    if (ap >= 2) {
      const hypot = { ...unit, coordinate: current, actionPoints: ap } as UnitInstance;
      const shot = bestAttackFromHere(state, hypot);
      if (shot) break;
    }

    if (ap <= 0.01) break;
  }
  return path;
}

function bestAttackFromHere(
  state: TacticalBattleState,
  attacker: UnitInstance
): { defenderId: string; weaponId: string; score: number } | null {
  // Must have enough AP to attack
  if (!canAffordAttack(attacker)) return null;

  let best: { defenderId: string; weaponId: string; score: number } | null = null;
  const enemies = listEnemyUnits(state, attacker.faction);
  for (const enemy of enemies) {
    for (const weaponId of Object.keys(attacker.stats.weaponRanges)) {
      if (!canWeaponTarget(attacker, weaponId, enemy)) continue;
      const hit = calculateHitChance({ attacker, defender: enemy, weaponId, map: state.map });
      if (hit <= 0) continue;
      const power = attacker.stats.weaponPower[weaponId] ?? 0;
      const score = hit * (power || 1);
      if (!best || score > best.score) {
        best = { defenderId: enemy.id, weaponId, score };
      }
    }
  }
  return best;
}

function chooseGreedyStepToward(
  state: TacticalBattleState,
  unit: UnitInstance,
  goal: HexCoordinate
): HexCoordinate | null {
  const occ = occupiedSet(state);
  const mult = movementMultiplierForStance(unit.stance);

  let best: { step: HexCoordinate; score: number } | null = null;
  for (const n of getNeighbors(state.map, unit.coordinate)) {
    const k = coordinateKey(n);
    if (occ.has(k)) continue;
    const tile = getTile(state.map, n);
    if (!tile || !tile.passable) continue;
    // movement cost must be affordable for a single step
    const stepCost = tile.movementCostModifier * mult;
    if (stepCost > unit.actionPoints) continue;

    // Heuristic: prefer reducing distance, high elevation, higher cover
    const distGain = axialDistance(unit.coordinate, goal) - axialDistance(n, goal);
    const score = distGain * 5 + (tile.providesVisionBoost ? 1 : 0) + tile.cover * 0.25;
    if (!best || score > best.score) best = { step: n, score };
  }
  return best?.step ?? null;
}

export function decideNextAIAction(
  state: TacticalBattleState,
  faction: FactionId
): AIImmediateAction {
  const side = state.sides[faction];
  const units = Array.from(side.units.values()).filter(isUsableUnit);
  if (units.length === 0) return { type: 'endTurn' };

  // 1) Global best immediate attack among all units
  let bestAttack:
    | { attackerId: string; defenderId: string; weaponId: string; score: number }
    | null = null;
  for (const u of units) {
    const choice = bestAttackFromHere(state, u);
    if (choice && (!bestAttack || choice.score > bestAttack.score)) {
      bestAttack = { attackerId: u.id, defenderId: choice.defenderId, weaponId: choice.weaponId, score: choice.score };
    }
  }
  if (bestAttack) {
    return { type: 'attack', attackerId: bestAttack.attackerId, defenderId: bestAttack.defenderId, weaponId: bestAttack.weaponId };
  }

  // 2) Otherwise, plan a (possibly multi-step) threat-aware path toward nearest enemy
  const enemiesAll = listEnemyUnits(state, faction);
  let bestMove: { unitId: string; path: HexCoordinate[]; score: number } | null = null;
  for (const u of units) {
    let nearest: UnitInstance | null = null;
    let nearestDist = Infinity;
    for (const e of enemiesAll) {
      const d = axialDistance(u.coordinate, e.coordinate);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }
    if (!nearest) continue;
    const path = buildThreatAwarePathToward(state, u, nearest.coordinate);
    if (!path || path.length === 0) continue;
    const last = path[path.length - 1];
    const distReduction = nearestDist - axialDistance(last, nearest.coordinate);
    // approximate cumulative threat along path (for scoring only)
    let threatSum = 0;
    for (const step of path) {
      threatSum += computeTileThreat(state, u.faction as FactionId, step, u);
    }
    const score = distReduction * 12 - threatSum * 2 + Math.min(u.actionPoints, 10) + Math.random() * 0.01;
    if (!bestMove || score > bestMove.score) bestMove = { unitId: u.id, path, score };
  }

  if (bestMove) {
    return { type: 'move', unitId: bestMove.unitId, path: bestMove.path };
  }

  // 3) Nothing to do → end turn
  return { type: 'endTurn' };
}
