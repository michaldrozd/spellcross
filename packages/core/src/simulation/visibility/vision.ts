import type { BattlefieldMap, FactionId, HexCoordinate, TacticalBattleState } from '../types.js';
import { getTile, isWithinBounds, tileIndex } from '../utils/grid.js';
import { isoLine, isoWithinRange } from '../utils/grid-iso.js';
import { isUnitDetected } from './stealth.js';

export interface VisionOptions {
  rangeModifier?: (params: { unitVision: number; tileProvidesBoost: boolean; elevation: number }) => number;
  detectionPenalty?: number; // stealth penalty applied globally
  weather?: 'clear' | 'night' | 'fog';
}

const DEFAULT_RANGE_MODIFIER = ({
  unitVision,
  tileProvidesBoost,
  elevation
}: {
  unitVision: number;
  tileProvidesBoost: boolean;
  elevation: number;
}) => unitVision + (tileProvidesBoost ? 1 : 0) + (elevation >= 1 ? 1 : 0);

const MAX_VISION_RANGE = 10;
const BASE_STEALTH_PENALTY = 1;

function tileBlocksVision(map: BattlefieldMap, coordinate: HexCoordinate): boolean {
  const tile = getTile(map, coordinate);
  if (!tile) {
    return true;
  }
  if (!tile.passable) {
    return true;
  }
  return tile.cover >= 3;
}

export function hasLineOfSight(map: BattlefieldMap, from: HexCoordinate, to: HexCoordinate): boolean {
  if (!isWithinBounds(map, to)) return false;
  const line = isoLine(from, to);
  for (let i = 1; i < line.length - 1; i++) {
    if (tileBlocksVision(map, line[i])) {
      return false;
    }
  }
  return true;
}

function computeVisibleTilesForUnit(
  state: TacticalBattleState,
  unitCoordinate: HexCoordinate,
  visionRange: number
): Set<number> {
  const result = new Set<number>();
  // Floor to an integer: night/fog penalties can make the range fractional, which would corrupt the
  // tile enumeration. Vision/range/movement all share the same iso (Chebyshev) geometry now.
  const boundedRange = Math.max(0, Math.floor(Math.min(visionRange, MAX_VISION_RANGE)));
  const candidates = isoWithinRange(unitCoordinate, boundedRange);

  for (const candidate of candidates) {
    if (!isWithinBounds(state.map, candidate)) {
      continue;
    }

    const line = isoLine(unitCoordinate, candidate);
    let blocked = false;
    for (let i = 1; i < line.length - 1; i++) {
      if (tileBlocksVision(state.map, line[i])) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      result.add(tileIndex(state.map, candidate));
    }
  }

  return result;
}

export function updateFactionVision(
  state: TacticalBattleState,
  faction: FactionId,
  options: VisionOptions = {}
): void {
  const visionGrid = state.vision[faction];
  if (!visionGrid) {
    return;
  }

  const rangeModifier = options.rangeModifier ?? DEFAULT_RANGE_MODIFIER;
  const weatherPenalty = options.weather === 'fog' ? 1 : options.weather === 'night' ? 0.5 : 0;

  const visibleTiles = new Set<number>();

  const side = state.sides[faction];
  if (!side) {
    visionGrid.visibleTiles = visibleTiles;
    return;
  }
  for (const unit of side.units.values()) {
    if (unit.stance === 'destroyed' || unit.embarkedOn) {
      continue;
    }

    const unitTile = getTile(state.map, unit.coordinate);
    const providesBoost = unitTile?.providesVisionBoost ?? false;
    const range = rangeModifier({
      unitVision: unit.stats.vision,
      tileProvidesBoost: providesBoost,
      elevation: unitTile?.elevation ?? 0
    }) - weatherPenalty;
    // General tile visibility uses the unit's full effective range. Stealth is a SEPARATE check below
    // (isUnitDetected) — it must not shrink how far everyone can see the ground.
    const unitVisibleTiles = computeVisibleTilesForUnit(state, unit.coordinate, range);
    for (const tile of unitVisibleTiles) {
      visibleTiles.add(tile);
    }
  }

  visionGrid.visibleTiles = visibleTiles;
  for (const tile of visibleTiles) {
    visionGrid.exploredTiles.add(tile);
  }

  // Apply stealth: remove unseen enemies from visibleTiles unless detected
  const enemyFaction: FactionId = faction === 'alliance' ? 'otherSide' : 'alliance';
  const enemyUnits = state.sides[enemyFaction]?.units;
  if (enemyUnits) {
    for (const u of enemyUnits.values()) {
      const idx = tileIndex(state.map, u.coordinate);
      if (!visibleTiles.has(idx)) continue;
      if (!isUnitDetected(state, faction, u, state.map)) {
        visibleTiles.delete(idx);
      } else {
        u.statusEffects.add('spotted');
      }
    }
  }
}

export function updateAllFactionsVision(state: TacticalBattleState, options?: VisionOptions): void {
  for (const faction of Object.keys(state.sides) as FactionId[]) {
    updateFactionVision(state, faction, options);
  }
}
