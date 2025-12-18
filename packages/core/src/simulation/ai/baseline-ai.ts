import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance } from '../types.js';
import { axialDistance, coordinateKey, directionIndex, getNeighbors, getTile, orientationDelta, tileIndex } from '../utils/grid.js';
import { calculateHitChance, canWeaponTarget, canAffordAttack, calculateAttackRange } from '../combat/combat-resolver.js';
import { movementMultiplierForStance } from '../pathfinding/hex-pathfinder.js';
import { hasLineOfSight } from '../visibility/vision.js';

export type AIImmediateAction =
  | { type: 'attack'; attackerId: string; defenderId: string; weaponId: string }
  | { type: 'attackTile'; unitId: string; target: HexCoordinate; weaponId: string }
  | { type: 'move'; unitId: string; path: HexCoordinate[] }
  | { type: 'supply'; supplierId: string; targetId: string }
  | { type: 'endTurn' };

function isUsableUnit(u: UnitInstance): boolean {
  return u.stance !== 'destroyed' && !u.embarkedOn && u.actionPoints > 0;
}

function listEnemyUnits(state: TacticalBattleState, faction: FactionId): UnitInstance[] {
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  const side = state.sides[enemyFaction];
  return Array.from(side.units.values()).filter((u) => u.stance !== 'destroyed' && !u.embarkedOn);
}

function priorityScore(unit: UnitInstance): number {
  let score = 1;
  if (unit.unitType === 'hero' || unit.definitionId === 'john-alexander') score += 3;
  if (unit.stats.transportCapacity && unit.stats.transportCapacity > 0) score += 2.5;
  if (unit.unitType === 'artillery') score += 2;
  if (unit.unitType === 'support') score += 1;
  return score;
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

function findDemolitionTarget(
  state: TacticalBattleState,
  unit: UnitInstance,
  goals: HexCoordinate[]
): { target: HexCoordinate; weaponId: string; score: number } | null {
  if (!canAffordAttack(unit)) return null;
  let best: { target: HexCoordinate; weaponId: string; score: number } | null = null;
  for (let idx = 0; idx < state.map.tiles.length; idx++) {
    const tile = state.map.tiles[idx];
    if (!tile?.destructible) continue;
    if ((tile.hp ?? 0) <= 0) continue;
    const coord: HexCoordinate = { q: idx % state.map.width, r: Math.floor(idx / state.map.width) };
    const distToGoal = goals.length
      ? Math.min(...goals.map((g) => axialDistance(coord, g)))
      : axialDistance(coord, unit.coordinate);
    for (const weaponId of Object.keys(unit.stats.weaponRanges)) {
      const range = calculateAttackRange(unit, weaponId, state.map);
      if (range <= 0 || axialDistance(unit.coordinate, coord) > range) continue;
      if (!hasLineOfSight(state.map, unit.coordinate, coord)) continue;
      const power = unit.stats.weaponPower[weaponId] ?? 0;
      const score = power + Math.max(0, 6 - distToGoal);
      if (!best || score > best.score) {
        best = { target: coord, weaponId, score };
      }
    }
  }
  return best;
}

function findSupplyTarget(state: TacticalBattleState, supplier: UnitInstance): { targetId: string; path: HexCoordinate[] } | null {
  if (supplier.unitType !== 'support' && supplier.stats.ammoCapacity !== 0) return null;
  const allies = Array.from(state.sides[supplier.faction].units.values()).filter(
    (u) => u.id !== supplier.id && u.stance !== 'destroyed' && u.currentAmmo < (u.stats.ammoCapacity ?? Infinity)
  );
  if (allies.length === 0) return null;
  let best: { targetId: string; path: HexCoordinate[] } | null = null;
  for (const ally of allies) {
    const path = buildThreatAwarePathToward(state, supplier, ally.coordinate, {
      flankTarget: undefined,
      threatWeight: 4,
      flankWeight: 0,
      maxStepBonus: 0
    });
    if (!path) continue;
    if (!best || path.length < best.path.length) {
      best = { targetId: ally.id, path };
    }
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

function tryFallbackStep(
  state: TacticalBattleState,
  unit: UnitInstance,
  awayFrom: UnitInstance[]
): HexCoordinate[] | null {
  let best: { step: HexCoordinate; score: number } | null = null;
  for (const n of getNeighbors(state.map, unit.coordinate)) {
    const tile = getTile(state.map, n);
    if (!tile || !tile.passable) continue;
    // increase distance from nearest enemy
    const currentNearest = awayFrom.reduce((min, foe) => Math.min(min, axialDistance(unit.coordinate, foe.coordinate)), Infinity);
    const afterNearest = awayFrom.reduce((min, foe) => Math.min(min, axialDistance(n, foe.coordinate)), Infinity);
    if (afterNearest <= currentNearest) continue;
    const threat = computeTileThreat(state, unit.faction, n, unit);
    const score = afterNearest - threat;
    if (!best || score > best.score) best = { step: n, score };
  }
  return best ? [best.step] : null;
}

function maxRange(unit: UnitInstance): number {
  return Math.max(0, ...Object.values(unit.stats.weaponRanges));
}

function buildThreatAwarePathToward(
  state: TacticalBattleState,
  unit: UnitInstance,
  goal: HexCoordinate,
  opts: {
    flankTarget?: UnitInstance;
    threatWeight: number;
    flankWeight: number;
    maxStepBonus?: number;
  }
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
  const scouting = state.round <= 2 || !anyVisible || nearestDist > 8;
  const maxStepsCap = (scouting ? 5 : 2) + (opts.maxStepBonus ?? 0);

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
      let cohesionBonus = 0;
      for (const ally of state.sides[unit.faction].units.values()) {
        if (ally.id === unit.id || ally.stance === 'destroyed') continue;
        const dist = axialDistance(ally.coordinate, n);
        if (dist <= 2) {
          cohesionBonus += 0.25;
        }
      }
      const flankScore = (() => {
        if (!opts.flankTarget) return 0;
        const attackDir = directionIndex(opts.flankTarget.coordinate, n);
        const delta = orientationDelta(opts.flankTarget.orientation ?? 0, attackDir);
        return delta >= 3 ? opts.flankWeight : delta === 2 ? opts.flankWeight * 0.5 : 0;
      })();
      // heuristic weights
      const score =
        distGain * 8 +
        (tile.providesVisionBoost ? 0.7 : 0) +
        tile.cover * 0.6 +
        cohesionBonus +
        flankScore -
        threat * opts.threatWeight;
      if (!best || score > best.score) best = { step: n, score, cost };
    }
    if (!best) break;

    // stop if the chosen step is clearly disadvantageous (no progress and high threat)
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

function flankAwareAttackScore(attacker: UnitInstance, defender: UnitInstance, weaponId: string, map: TacticalBattleState['map']): number {
  const hit = calculateHitChance({ attacker, defender, weaponId, map });
  if (hit <= 0) return 0;
  const power = attacker.stats.weaponPower[weaponId] ?? 0;
  const attackDir = directionIndex(defender.coordinate, attacker.coordinate);
  const delta = orientationDelta(defender.orientation ?? 0, attackDir);
  const flankBonus = delta >= 3 ? 1.25 : delta === 2 ? 1.15 : 1;
  return hit * (power || 1) * flankBonus * priorityScore(defender);
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
      const score = flankAwareAttackScore(attacker, enemy, weaponId, state.map);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { defenderId: enemy.id, weaponId, score };
      }
    }
  }
  return best;
}

export interface AIContextOptions {
  objectiveTargets?: HexCoordinate[];
  holdTargets?: HexCoordinate[];
  reachTargets?: HexCoordinate[];
  defendBias?: boolean;
  aggression?: number; // 0-1, higher = more aggressive
  avoidTiles?: Set<string>; // tiles to avoid (e.g., destructible chokepoints)
  difficulty?: 'normal' | 'hard' | 'brutal';
  allowDemolition?: boolean;
}

export function decideNextAIAction(
  state: TacticalBattleState,
  faction: FactionId,
  options: AIContextOptions = {}
): AIImmediateAction {
  const difficulty = options.difficulty ?? 'normal';
  const aggression = options.aggression ?? (difficulty === 'brutal' ? 0.75 : difficulty === 'hard' ? 0.6 : 0.5);
  const threatWeight = difficulty === 'brutal' ? 3.2 : difficulty === 'hard' ? 3.8 : 4.5;
  const flankWeight = difficulty === 'brutal' ? 2.8 : difficulty === 'hard' ? 2.2 : 1.5;
  const maxStepBonus = difficulty === 'brutal' ? 2 : difficulty === 'hard' ? 1 : 0;
  const side = state.sides[faction];
  const units = Array.from(side.units.values()).filter(isUsableUnit);
  if (units.length === 0) return { type: 'endTurn' };

  const enemiesAll = listEnemyUnits(state, faction);

  // 0) Fallback/retreat for fragile units
  for (const u of units) {
    const lowHealth = u.currentHealth <= u.stats.maxHealth * (aggression > 0.7 ? 0.25 : 0.35);
    const rattled = u.currentMorale <= (aggression > 0.7 ? 20 : 30);
    const rangedStandoff =
      maxRange(u) >= 6 &&
      enemiesAll.some((e) => axialDistance(u.coordinate, e.coordinate) < Math.max(2, maxRange(u) - 2));
    if (lowHealth || rattled || rangedStandoff) {
      const step = tryFallbackStep(state, u, enemiesAll);
      if (step && step.length) return { type: 'move', unitId: u.id, path: step };
    }
  }

  // Objective contesting: if the opponent is occupying an objective tile, focus fire
  const contestTargets: UnitInstance[] = [];
  const objectiveTargets = options.objectiveTargets ?? [];
  for (const obj of objectiveTargets) {
    for (const enemy of enemiesAll) {
      if (coordinateKey(enemy.coordinate) === coordinateKey(obj)) {
        contestTargets.push(enemy);
      }
    }
  }

  // 1) Global best immediate attack among all units (prioritizing objective occupiers and flanks)
  let bestAttack:
    | { attackerId: string; defenderId: string; weaponId: string; score: number }
    | null = null;
  for (const u of units) {
    // Fast lane: shoot occupying enemies first
    for (const target of contestTargets) {
      for (const weaponId of Object.keys(u.stats.weaponRanges)) {
        if (!canWeaponTarget(u, weaponId, target)) continue;
        const score = flankAwareAttackScore(u, target, weaponId, state.map) + 2;
        if (!bestAttack || score > bestAttack.score) {
          bestAttack = { attackerId: u.id, defenderId: target.id, weaponId, score };
        }
      }
    }

    // artillery prefers standoff: skip attack if moving closer is safer unless enemy in range
    const isArtillery = u.unitType === 'artillery' || Object.keys(u.stats.weaponRanges).some((w) => u.stats.weaponRanges[w] >= 7);
    const choice = bestAttackFromHere(state, u);
    // conserve ammo if low unless high-priority target
    const lowAmmo = u.currentAmmo !== Infinity && u.currentAmmo <= Math.max(1, (u.stats.ammoCapacity ?? 0) * 0.25);
    if (choice && (!bestAttack || choice.score > bestAttack.score)) {
      const defender = listEnemyUnits(state, faction).find((e) => e.id === choice.defenderId);
      const priority = defender ? priorityScore(defender) : 1;
      const weightedScore = choice.score * priority;
      if (lowAmmo && priority < 2) {
        // hold fire to conserve ammo
      } else if (isArtillery && defender && axialDistance(u.coordinate, defender.coordinate) <= 2) {
        // avoid point-blank for artillery; let movement handle reposition
      } else if (!bestAttack || weightedScore > bestAttack.score) {
        bestAttack = { attackerId: u.id, defenderId: choice.defenderId, weaponId: choice.weaponId, score: weightedScore };
      }
    }
  }
  if (bestAttack) {
    return { type: 'attack', attackerId: bestAttack.attackerId, defenderId: bestAttack.defenderId, weaponId: bestAttack.weaponId };
  }

  // 2) Otherwise, plan a (possibly multi-step) threat-aware path toward objectives or nearest enemy
  const objectiveGoals = objectiveTargets;
  const holdGoals = options.holdTargets ?? [];
  const reachGoals = options.reachTargets ?? [];
  const defendBias = options.defendBias ?? false;
  const avoidTiles = options.avoidTiles ?? new Set<string>();
  if (defendBias && holdGoals.length > 0) {
    const anchor = holdGoals[0];
    const holder = units.find((u) => axialDistance(u.coordinate, anchor) <= 2);
    if (holder) {
      const shot = bestAttackFromHere(state, holder);
      if (shot) {
        return { type: 'attack', attackerId: holder.id, defenderId: shot.defenderId, weaponId: shot.weaponId };
      }
      return { type: 'endTurn' };
    }
  }
  let bestMove: { unitId: string; path: HexCoordinate[]; score: number } | null = null;
  for (const u of units) {
    // supply role: if support truck, try resupply first
    if (u.unitType === 'support' && u.stats.ammoCapacity === 0) {
      const supply = findSupplyTarget(state, u);
      if (supply && supply.path.length) {
        return { type: 'move', unitId: u.id, path: supply.path.slice(0, 2) };
      }
    }
    // ranged standoff: maintain distance while advancing
    const ranged = maxRange(u) >= 6;
    const targets: HexCoordinate[] = [];
    if (objectiveGoals.length > 0) {
      targets.push(...objectiveGoals);
    } else if (holdGoals.length > 0) {
      targets.push(...holdGoals);
    } else if (reachGoals.length > 0) {
      targets.push(...reachGoals);
    } else {
      let nearest: UnitInstance | null = null;
      let nearestDist = Infinity;
      for (const e of enemiesAll) {
        const d = axialDistance(u.coordinate, e.coordinate);
        if (d < nearestDist) { nearest = e; nearestDist = d; }
      }
      if (nearest) targets.push(nearest.coordinate);
    }
    if (targets.length === 0) continue;

    for (const tgt of targets) {
      const flankTarget =
        enemiesAll.find((e) => coordinateKey(e.coordinate) === coordinateKey(tgt)) ??
        enemiesAll.sort((a, b) => axialDistance(u.coordinate, a.coordinate) - axialDistance(u.coordinate, b.coordinate))[0];
      const path = buildThreatAwarePathToward(state, u, tgt, {
        flankTarget,
        threatWeight,
        flankWeight,
        maxStepBonus: maxStepBonus + (ranged ? 1 : 0)
      }).filter((step) => !avoidTiles.has(coordinateKey(step)));
      if (!path || path.length === 0) continue;
      const last = path[path.length - 1];
      const distReduction = axialDistance(u.coordinate, tgt) - axialDistance(last, tgt);
      const threatSum = path.reduce((acc, step) => acc + computeTileThreat(state, u.faction, step, u), 0);
      const isObjectiveStep = objectiveGoals.some((o) => coordinateKey(o) === coordinateKey(tgt));
      const flankIncentive = flankTarget ? flankWeight * 0.6 : 0;
      let score =
        distReduction * 12 +
        flankIncentive -
        threatSum * (threatWeight * (aggression > 0.65 ? 0.35 : 0.5)) +
        Math.min(u.actionPoints, 10) +
        (isObjectiveStep ? 4 : 0) +
        Math.random() * 0.01;
      if (ranged) {
        score += 2;
      }
      if (defendBias && holdGoals.length > 0) {
        score += 5;
      }
      if (!bestMove || score > bestMove.score) bestMove = { unitId: u.id, path, score };
    }
  }

  if (bestMove) {
    return { type: 'move', unitId: bestMove.unitId, path: bestMove.path };
  }

  // 2b) If no movement makes sense, consider demolishing blocking cover near objectives
  if (options.allowDemolition !== false) {
    let bestDemo: { unitId: string; target: HexCoordinate; weaponId: string; score: number } | null = null;
    for (const u of units) {
      const demo = findDemolitionTarget(state, u, objectiveGoals);
      if (!demo) continue;
      if (!bestDemo || demo.score > bestDemo.score) {
        bestDemo = { unitId: u.id, target: demo.target, weaponId: demo.weaponId, score: demo.score };
      }
    }
    if (bestDemo) {
      return { type: 'attackTile', unitId: bestDemo.unitId, target: bestDemo.target, weaponId: bestDemo.weaponId };
    }
  }

  // 3) Nothing to do → end turn
  return { type: 'endTurn' };
}
