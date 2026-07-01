import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { isUnitDetected } from './stealth.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;
const forest = { ...plain, terrain: 'forest', cover: 2 } as const;

const scout = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number, vision = 6) => ({
  definition: { id, faction, name: id, type: 'infantry' as const,
    stats: { maxHealth: 20, mobility: 4, vision, armor: 0, morale: 60,
      weaponRanges: { r: 4 }, weaponPower: { r: 1 }, weaponAccuracy: { r: 1 } } },
  coordinate: { q, r }
});

// viewer at (0,0); target somewhere on a 10x1 strip. tiles[targetQ] can be forest to add concealment.
function build(targetQ: number, targetOnForest: boolean, viewerVision = 6, spotter = false) {
  const tiles = Array.from({ length: 10 }, (_, i) => (targetOnForest && i === targetQ ? forest : plain));
  const viewerDef = scout('viewer', 'alliance', 0, 0, viewerVision);
  if (spotter) (viewerDef.definition.stats as any).spotter = true;
  const spec: CreateBattleStateOptions = {
    map: { id: 'm', width: 10, height: 1, tiles: [...tiles] },
    sides: [
      { faction: 'alliance', units: [viewerDef] },
      { faction: 'otherSide', units: [scout('t', 'otherSide', targetQ, 0)] }
    ]
  };
  const state = createBattleState(spec);
  const target = Array.from(state.sides.otherSide.units.values())[0];
  return { state, target };
}

describe('stealth / concealment', () => {
  it('an open-ground target is detected within vision range', () => {
    const { state, target } = build(4, false, 6); // dist 4, vision 6, no cover
    expect(isUnitDetected(state, 'alliance', target, state.map)).toBe(true);
  });

  it('forest concealment hides a target at the edge of vision, but not up close', () => {
    // dist 5, vision 6: open would be seen (5<=6); forest adds cover 2 → 5+2 > 6 → concealed
    const far = build(5, true, 6);
    expect(isUnitDetected(far.state, 'alliance', far.target, far.state.map)).toBe(false);
    // move viewer closer: dist 3, 3+2 <= 6 → spotted even in forest
    const near = build(3, true, 6);
    expect(isUnitDetected(near.state, 'alliance', near.target, near.state.map)).toBe(true);
  });

  it('a spotter sees further, cutting through concealment', () => {
    const plainViewer = build(5, true, 6, false);
    expect(isUnitDetected(plainViewer.state, 'alliance', plainViewer.target, plainViewer.state.map)).toBe(false);
    const spotterViewer = build(5, true, 8, false); // higher vision defeats the +2 forest concealment
    expect(isUnitDetected(spotterViewer.state, 'alliance', spotterViewer.target, spotterViewer.state.map)).toBe(true);
  });
});
