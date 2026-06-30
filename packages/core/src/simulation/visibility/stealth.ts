import type { BattlefieldMap, FactionId, TacticalBattleState, UnitInstance } from '../types.js';
import { getTile, tileIndex } from '../utils/grid.js';
import { isoDistance } from '../utils/grid-iso.js';

export function isUnitDetected(
  state: TacticalBattleState,
  viewerFaction: FactionId,
  target: UnitInstance,
  map: BattlefieldMap
): boolean {
  if (target.stance === 'destroyed') return false;
  const viewerUnits = state.sides[viewerFaction]?.units;
  if (!viewerUnits) return false;
  for (const viewer of viewerUnits.values()) {
    if (viewer.stance === 'destroyed' || viewer.embarkedOn) continue;
    // Match the effective range the visibility pass uses (vision + high-ground/lookout boosts), so a
    // unit you can SEE the ground around can also actually detect a stealthed enemy standing there.
    const viewerTile = getTile(map, viewer.coordinate);
    const boost = viewerTile?.providesVisionBoost ? 1 : 0;
    const elev = (viewerTile?.elevation ?? 0) >= 1 ? 1 : 0;
    const range = viewer.stats.vision + boost + elev;
    const dist = isoDistance(viewer.coordinate, target.coordinate);
    if (dist > range) continue;
    const targetTile = getTile(map, target.coordinate);
    const concealBonus = target.stats.concealmentBonus ?? 0;
    const tileCover = targetTile?.cover ?? 0;
    const stealth = target.stats.stealth ?? 0;
    const detectionDifficulty = stealth + tileCover + concealBonus;
    // simple rule: detection succeeds if distance plus detectionDifficulty <= vision
    if (dist + detectionDifficulty <= range) {
      return true;
    }
  }
  return false;
}

export function markDetected(state: TacticalBattleState, viewerFaction: FactionId) {
  const enemyFaction: FactionId = viewerFaction === 'alliance' ? 'otherSide' : 'alliance';
  const enemyUnits = state.sides[enemyFaction]?.units;
  if (!enemyUnits) return;
  const vis = state.vision[viewerFaction]?.visibleTiles;
  if (!vis) return;
  for (const u of enemyUnits.values()) {
    const idx = tileIndex(state.map, u.coordinate);
    if (vis.has(idx)) {
      u.statusEffects.add('spotted');
    }
  }
}
