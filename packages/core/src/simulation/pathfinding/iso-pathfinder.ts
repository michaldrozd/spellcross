import type {
  BattlefieldMap,
  HexCoordinate,
  TacticalBattleState,
  UnitInstance
} from '../types.js';
import {
  canAffordMovementCost,
  movementMultiplierForStance
} from './movement.js';
import type { PathfindingOptions, PathResult } from './types.js';
import { isoDistance, isoNeighbors } from '../utils/grid-iso.js';
import { getTile, coordinateKey as hexKey } from '../utils/grid.js';

interface NodeRecord {
  coordinate: HexCoordinate;
  costFromStart: number;
  estimatedTotalCost: number;
  stepsFromStart: number;
  parent?: NodeRecord;
}

function canUnitEnterTerrain(unitType: UnitInstance['unitType'] | undefined, tile: { terrain: string; passable: boolean }): boolean {
  if (!tile || !tile.passable) return false;
  if (!unitType) return true;
  switch (tile.terrain) {
    case 'forest':
      return unitType === 'infantry' || unitType === 'hero';
    case 'water':
      return unitType === 'air';
    case 'swamp':
      return unitType !== 'air';
    case 'structure':
      // Impassable buildings are already rejected by the !tile.passable guard above; reaching here
      // means walkable rubble (cover terrain), which ground units may cross. Returning false stranded
      // enemies spawned on rubble (ruins/rift maps) as unreachable, soft-locking the eliminate goal.
      return true;
    default:
      return true;
  }
}

export function findPathOnMapIso(
  map: BattlefieldMap,
  start: HexCoordinate,
  goal: HexCoordinate,
  options: PathfindingOptions & { occupied?: Set<string>; movementMultiplier?: number } = {}
): PathResult {
  if (start.q === goal.q && start.r === goal.r) {
    return { success: true, path: [], cost: 0 };
  }

  const occupied = options.occupied ?? new Set<string>();
  const ignore = options.ignoreCoordinates ?? new Set<string>();
  const movementMultiplier = options.movementMultiplier ?? 1;

  // Admissible heuristic: cheap tiles (roads at 0.7-0.8) cost less than 1 per step, so a raw
  // grid distance overestimates and can misreport road-reachable tiles as beyond maxCost.
  let minStepCost = 1;
  for (const t of map.tiles) {
    if (t?.passable && t.movementCostModifier < minStepCost) minStepCost = t.movementCostModifier;
  }
  minStepCost *= movementMultiplier;

  const openSet: NodeRecord[] = [
    {
      coordinate: start,
      costFromStart: 0,
      estimatedTotalCost: isoDistance(start, goal) * minStepCost,
      stepsFromStart: 0
    }
  ];
  const closedSet = new Set<string>();
  const nodeLookup = new Map<string, NodeRecord>();
  nodeLookup.set(hexKey(start), openSet[0]);

  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;

  const popLowest = () => {
    let idx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].estimatedTotalCost < openSet[idx].estimatedTotalCost) idx = i;
    }
    return openSet.splice(idx, 1)[0];
  };

  while (openSet.length > 0) {
    const current = popLowest();
    const currentKey = hexKey(current.coordinate);

    if (current.coordinate.q === goal.q && current.coordinate.r === goal.r) {
      const path: HexCoordinate[] = [];
      let cursor: NodeRecord | undefined = current;
      while (cursor?.parent) {
        path.unshift(cursor.coordinate);
        cursor = cursor.parent;
      }
      return { success: true, path, cost: current.costFromStart };
    }

    closedSet.add(currentKey);

    for (const neighbor of isoNeighbors(map, current.coordinate)) {
      const neighborKey = hexKey(neighbor);
      if (closedSet.has(neighborKey)) continue;
      if (!ignore.has(neighborKey) && occupied.has(neighborKey)) continue;

      const tileB = getTile(map, neighbor);
      if (!tileB || !tileB.passable) continue;
      if (!canUnitEnterTerrain(options.unitType, tileB)) continue;

      // Cost must match TurnProcessor.moveUnit exactly (movementCostModifier * multiplier). The old
      // slope/cliff model was gated on tile.elevEdges, which is never populated anywhere, so every
      // hill edge read as a sheer cliff and hills were unreachable; it also charged an edge penalty
      // the executor never spends. The executor enforces no elevation movement rules, so neither does
      // the planner.
      const movementCost = tileB.movementCostModifier * movementMultiplier;
      const tentativeCost = current.costFromStart + movementCost;
      const tentativeSteps = current.stepsFromStart + 1;
      if (!canAffordMovementCost(tentativeCost, maxCost, tentativeSteps)) continue;

      const heuristic = isoDistance(neighbor, goal) * minStepCost;
      const existing = nodeLookup.get(neighborKey);

      if (!existing) {
        const rec: NodeRecord = {
          coordinate: neighbor,
          costFromStart: tentativeCost,
          estimatedTotalCost: tentativeCost + heuristic,
          stepsFromStart: tentativeSteps,
          parent: current
        };
        nodeLookup.set(neighborKey, rec);
        openSet.push(rec);
      } else if (tentativeCost < existing.costFromStart) {
        // update the one shared record — a fresh copy in the lookup would let the open-set
        // entry go stale after a second improvement
        existing.costFromStart = tentativeCost;
        existing.estimatedTotalCost = tentativeCost + heuristic;
        existing.stepsFromStart = tentativeSteps;
        existing.parent = current;
      }
    }
  }

  return { success: false, path: [], cost: Number.POSITIVE_INFINITY, reason: 'unreachable' };
}

export function planPathForUnitIso(
  state: TacticalBattleState,
  unitId: string,
  destination: HexCoordinate
): PathResult {
  const activeSide = state.sides[state.activeFaction];
  const unit = (activeSide.units.get(unitId) ??
    state.sides.alliance.units.get(unitId) ??
    state.sides.otherSide.units.get(unitId)) as UnitInstance | undefined;

  if (!unit) {
    return { success: false, path: [], cost: 0, reason: 'unit_not_found' };
  }

  const start = unit.coordinate;
  const occupation = new Set<string>();
  for (const side of Object.values(state.sides)) {
    for (const other of side.units.values()) {
      // Skip embarked passengers: their coordinate stays frozen at the carrier's embark tile and
      // would otherwise phantom-block that tile (the executor and hex planner skip them too).
      if (other.id === unit.id || other.stance === 'destroyed' || other.embarkedOn) continue;
      occupation.add(hexKey(other.coordinate));
    }
  }

  const weather = state.weather;
  const weatherMoveMod = weather === 'fog' ? 1.2 : weather === 'night' ? 1.1 : 1;
  const movementMultiplier = movementMultiplierForStance(unit.stance) * weatherMoveMod;

  const pathResult = findPathOnMapIso(state.map, start, destination, {
    occupied: occupation,
    ignoreCoordinates: new Set([hexKey(start)]),
    maxCost: unit.actionPoints,
    movementMultiplier,
    unitType: unit.unitType
  });

  return pathResult;
}
