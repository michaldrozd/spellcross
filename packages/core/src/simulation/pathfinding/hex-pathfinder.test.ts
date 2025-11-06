import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { planPathForUnit } from './hex-pathfinder.js';

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

const swampTile = {
  ...plainTile,
  terrain: 'swamp',
  movementCostModifier: 2
} as const;

const wallTile = {
  ...plainTile,
  passable: false,
  terrain: 'structure'
} as const;

const baseSpec: CreateBattleStateOptions = {
  map: {
    id: 'path-map',
    width: 4,
    height: 4,
    tiles: [
      plainTile,
      plainTile,
      wallTile,
      plainTile,
      plainTile,
      swampTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile,
      plainTile
    ]
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
              mobility: 6,
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
    {
      faction: 'otherSide',
      units: [
        {
          definition: {
            id: 'imp',
            faction: 'otherSide',
            name: 'Imp',
            type: 'infantry',
            stats: {
              maxHealth: 70,
              mobility: 6,
              vision: 3,
              armor: 0,
              morale: 40,
              weaponRanges: { claws: 1 },
              weaponPower: { claws: 8 },
              weaponAccuracy: { claws: 0.55 }
            }
          },
          coordinate: { q: 2, r: 1 }
        }
      ]
    }
  ]
};

describe('planPathForUnit', () => {
  it('finds a viable path around impassable tiles', () => {
    const state = createBattleState(baseSpec);
    const result = planPathForUnit(state, Array.from(state.sides.alliance.units.keys())[0], {
      q: 3,
      r: 0
    });

    expect(result.success).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.cost).toBeGreaterThan(0);
    expect(result.cost).toBeLessThanOrEqual(6);
  });

  it('respects occupied tiles', () => {
    const state = createBattleState(baseSpec);
    const blockerId = Array.from(state.sides.otherSide.units.keys())[0];
    const targetCoord = state.sides.otherSide.units.get(blockerId)?.coordinate;
    expect(targetCoord).toBeDefined();

    const result = planPathForUnit(state, Array.from(state.sides.alliance.units.keys())[0], targetCoord!);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('unreachable');
  });

  it('fails when cost exceeds available action points', () => {
    const custom = createBattleState({
      ...baseSpec,
      sides: [
        {
          faction: 'alliance',
          units: [
            {
              definition: {
                ...baseSpec.sides[0].units[0].definition,
                stats: {
                  ...baseSpec.sides[0].units[0].definition.stats,
                  mobility: 2
                }
              },
              coordinate: { q: 0, r: 0 }
            }
          ]
        }
      ]
    });

    const result = planPathForUnit(custom, Array.from(custom.sides.alliance.units.keys())[0], {
      q: 3,
      r: 0
    });

    expect(result.success).toBe(false);
  });
});
