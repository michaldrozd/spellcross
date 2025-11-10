import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { findPathOnMapIso, planPathForUnitIso } from './iso-pathfinder.js';

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

const wallTile = {
  ...plainTile,
  passable: false,
  terrain: 'structure'
} as const;

const baseSpec: CreateBattleStateOptions = {
  map: {
    id: 'iso-map',
    width: 5,
    height: 5,
    tiles: Array.from({ length: 25 }, () => plainTile)
  },
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: {
            id: 'inf',
            faction: 'alliance',
            name: 'Inf',
            type: 'infantry',
            stats: {
              maxHealth: 100,
              mobility: 10,
              vision: 4,
              armor: 1,
              morale: 60,
              weaponRanges: { rifle: 5 },
              weaponPower: { rifle: 12 },
              weaponAccuracy: { rifle: 0.7 }
            }
          },
          coordinate: { q: 0, r: 0 }
        }
      ]
    },
    { faction: 'otherSide', units: [] }
  ]
};

describe('iso-pathfinder', () => {
  it('finds a diagonal path quickly on open ground', () => {
    const state = createBattleState(baseSpec);
    const res = findPathOnMapIso(
      state.map,
      { q: 0, r: 0 },
      { q: 4, r: 4 },
      { maxCost: 50 }
    );
    expect(res.success).toBe(true);
    // Chebyshev distance 4, so minimal steps should be 4 tiles traversed
    expect(res.path.length).toBeGreaterThan(0);
    expect(res.cost).toBeGreaterThan(0);
  });

  it('respects impassable walls', () => {
    const blocked: CreateBattleStateOptions = {
      ...baseSpec,
      map: {
        ...baseSpec.map,
        tiles: Array.from({ length: 25 }, (_, i) => {
          // Block a vertical wall at q=2 except at r=2
          const q = i % 5, r = Math.floor(i / 5);
          if (q === 2 && r !== 2) return wallTile;
          return plainTile;
        })
      }
    };
    const state = createBattleState(blocked);
    const res = findPathOnMapIso(state.map, { q: 0, r: 0 }, { q: 4, r: 4 }, { maxCost: 100 });
    expect(res.success).toBe(true);
    // Must go through the gap at (2,2) regardless of diagonal movement allowance
    expect(res.path.some((p) => p.q === 2 && p.r === 2)).toBe(true);
  });

  it('planPathForUnitIso obeys action point budget', () => {
    const state = createBattleState({
      ...baseSpec,
      sides: [
        {
          faction: 'alliance',
          units: [
            {
              definition: baseSpec.sides[0].units[0].definition,
              coordinate: { q: 0, r: 0 }
            }
          ]
        },
        { faction: 'otherSide', units: [] }
      ]
    });
    const unitId = Array.from(state.sides.alliance.units.keys())[0];
    // Budget too small
    state.sides.alliance.units.get(unitId)!.actionPoints = 2;
    let res = planPathForUnitIso(state, unitId, { q: 4, r: 4 });
    expect(res.success).toBe(false);
    // Larger budget should succeed
    state.sides.alliance.units.get(unitId)!.actionPoints = 20;
    res = planPathForUnitIso(state, unitId, { q: 4, r: 4 });
    expect(res.success).toBe(true);
  });
});

