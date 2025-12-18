import type {
  BattlefieldMap,
  EdgeDir,
  HexCoordinate,
  MapTile,
  TacticalBattleState,
  UnitInstance
} from '../types.js';
import { getTile, coordinateKey as hexKey } from '../utils/grid.js';
import { isoDistance, isoNeighbors } from '../utils/grid-iso.js';
import type { PathfindingOptions, PathResult } from './types.js';

interface NodeRecord {
  coordinate: HexCoordinate;
  costFromStart: number;
  estimatedTotalCost: number;
  parent?: NodeRecord;
}

import { movementMultiplierForStance } from './movement.js';

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

  const openSet: NodeRecord[] = [
    { coordinate: start, costFromStart: 0, estimatedTotalCost: isoDistance(start, goal) }
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

      // Elevation-aware movement across edges (slopes vs. cliffs)
      const tileA = getTile(map, current.coordinate);
      const elevA = tileA?.elevation ?? 0;
      const elevB = tileB?.elevation ?? 0;
      const dq = neighbor.q - current.coordinate.q;
      const dr = neighbor.r - current.coordinate.r;
      const isDiagonal = dq !== 0 && dr !== 0;

      let edgePenalty = 0;
      if (elevA !== elevB) {
        // Only allow orthogonal steps across elevation if the higher tile marks that edge as a slope
        if (isDiagonal) continue;
        const dir: EdgeDir = dq === 1 && dr === 0 ? 'E' : dq === -1 && dr === 0 ? 'W' : dq === 0 && dr === 1 ? 'S' : 'N';
        const higherIsB = elevB > elevA;
        const higherTile: MapTile | undefined = higherIsB ? tileB : tileA;
        const edgeOnHigher: EdgeDir = higherIsB
          ? (dir === 'N' ? 'S' : dir === 'S' ? 'N' : dir === 'E' ? 'W' : 'E')
          : dir;
        const style = higherTile?.elevEdges?.[edgeOnHigher];
        if (style !== 'slope') continue; // sheer cliff
        edgePenalty = higherIsB ? 0.6 : 0.3; // uphill costs more than downhill
      }

      const movementCost = (tileB.movementCostModifier + edgePenalty) * movementMultiplier;
      const tentativeCost = current.costFromStart + movementCost;
      if (tentativeCost > maxCost) continue;

      const heuristic = isoDistance(neighbor, goal);
      const existing = nodeLookup.get(neighborKey);

      if (!existing || tentativeCost < existing.costFromStart) {
        const estimatedTotalCost = tentativeCost + heuristic;
        const rec: NodeRecord = {
          coordinate: neighbor,
          costFromStart: tentativeCost,
          estimatedTotalCost,
          parent: current
        };
        nodeLookup.set(neighborKey, rec);
        if (!existing) openSet.push(rec);
        else {
          existing.costFromStart = tentativeCost;
          existing.estimatedTotalCost = estimatedTotalCost;
          existing.parent = current;
        }
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
      if (other.id === unit.id || other.stance === 'destroyed') continue;
      occupation.add(hexKey(other.coordinate));
    }
  }

  const movementMultiplier = movementMultiplierForStance(unit.stance);

  const pathResult = findPathOnMapIso(state.map, start, destination, {
    occupied: occupation,
    ignoreCoordinates: new Set([hexKey(start)]),
    maxCost: unit.actionPoints,
    movementMultiplier,
    unitType: unit.unitType
  });

  return pathResult;
}
