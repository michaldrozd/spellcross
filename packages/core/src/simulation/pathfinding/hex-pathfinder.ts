import type {
  BattlefieldMap,
  HexCoordinate,
  TacticalBattleState,
  UnitInstance
} from '../types.js';
import { axialDistance, coordinateKey, getNeighbors, getTile } from '../utils/grid.js';
import type { PathfindingOptions, PathResult } from './types.js';

interface NodeRecord {
  coordinate: HexCoordinate;
  costFromStart: number;
  estimatedTotalCost: number;
  parent?: NodeRecord;
}

import { movementMultiplierForStance } from './movement.js';
export { movementMultiplierForStance };

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
      return false;
    default:
      return true;
  }
}

export function findPathOnMap(
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

  const openSet: NodeRecord[] = [
    {
      coordinate: start,
      costFromStart: 0,
      estimatedTotalCost: axialDistance(start, goal)
    }
  ];
  const closedSet = new Set<string>();
  const nodeLookup = new Map<string, NodeRecord>();
  nodeLookup.set(coordinateKey(start), openSet[0]);

  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;

  const popLowest = () => {
    let lowestIndex = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].estimatedTotalCost < openSet[lowestIndex].estimatedTotalCost) {
        lowestIndex = i;
      }
    }
    return openSet.splice(lowestIndex, 1)[0];
  };

  while (openSet.length > 0) {
    const current = popLowest();
    const currentKey = coordinateKey(current.coordinate);

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

    for (const neighbor of getNeighbors(map, current.coordinate)) {
      const neighborKey = coordinateKey(neighbor);
      if (closedSet.has(neighborKey)) {
        continue;
      }
      if (!ignore.has(neighborKey) && occupied.has(neighborKey)) {
        continue;
      }

      const tile = getTile(map, neighbor);
      if (!tile || !tile.passable) {
        continue;
      }
      if (!canUnitEnterTerrain(options.unitType, tile)) {
        continue;
      }

      const movementCost = tile.movementCostModifier * movementMultiplier;
      const tentativeCost = current.costFromStart + movementCost;

      if (tentativeCost > maxCost) {
        continue;
      }

      const heuristic = axialDistance(neighbor, goal);
      const existing = nodeLookup.get(neighborKey);

      if (!existing || tentativeCost < existing.costFromStart) {
        const estimatedTotalCost = tentativeCost + heuristic;
        const record: NodeRecord = {
          coordinate: neighbor,
          costFromStart: tentativeCost,
          estimatedTotalCost,
          parent: current
        };
        nodeLookup.set(neighborKey, record);

        if (!existing) {
          openSet.push(record);
        } else {
          existing.costFromStart = tentativeCost;
          existing.estimatedTotalCost = estimatedTotalCost;
          existing.parent = current;
        }
      }
    }
  }

  return { success: false, path: [], cost: Number.POSITIVE_INFINITY, reason: 'unreachable' };
}

export function planPathForUnit(
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
      if (other.id === unit.id || other.stance === 'destroyed' || other.embarkedOn) {
        continue;
      }
      occupation.add(coordinateKey(other.coordinate));
    }
  }

  const movementMultiplier = movementMultiplierForStance(unit.stance);

  const pathResult = findPathOnMap(state.map, start, destination, {
    occupied: occupation,
    ignoreCoordinates: new Set([coordinateKey(start)]),
    maxCost: unit.actionPoints,
    movementMultiplier,
    unitType: unit.unitType
  });

  if (!pathResult.success) {
    return pathResult;
  }

  return pathResult;
}
