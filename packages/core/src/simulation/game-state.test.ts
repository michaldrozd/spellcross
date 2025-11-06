import { describe, expect, it } from 'vitest';

import { createBattleState } from './game-state.js';
import type { CreateBattleStateOptions } from './game-state.js';

const mockSpec: CreateBattleStateOptions = {
  map: {
    id: 'test-map',
    width: 2,
    height: 2,
    tiles: [
      {
        terrain: 'plain',
        elevation: 0,
        cover: 0,
        movementCostModifier: 1,
        passable: true,
        providesVisionBoost: false
      },
      {
        terrain: 'plain',
        elevation: 0,
        cover: 0,
        movementCostModifier: 1,
        passable: true,
        providesVisionBoost: false
      },
      {
        terrain: 'plain',
        elevation: 0,
        cover: 0,
        movementCostModifier: 1,
        passable: true,
        providesVisionBoost: false
      },
      {
        terrain: 'plain',
        elevation: 0,
        cover: 0,
        movementCostModifier: 1,
        passable: true,
        providesVisionBoost: false
      }
    ]
  },
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: {
            id: 'light-infantry',
            faction: 'alliance',
            name: 'Light Infantry',
            type: 'infantry',
            stats: {
              maxHealth: 100,
              mobility: 6,
              vision: 4,
              armor: 1,
              morale: 50,
              weaponRanges: { rifle: 5 },
              weaponPower: { rifle: 12 },
              weaponAccuracy: { rifle: 0.7 }
            }
          },
          coordinate: { q: 0, r: 0 }
        }
      ]
    }
  ]
};

describe('createBattleState', () => {
  it('creates units with default stats', () => {
    const state = createBattleState(mockSpec);
    const units = state.sides.alliance.units;
    expect(units.size).toBe(1);
    const [unit] = units.values();
    expect(unit.currentHealth).toBe(100);
    expect(unit.actionPoints).toBe(6);
    expect(unit.maxActionPoints).toBe(6);
    expect(unit.stats.weaponRanges?.rifle).toBe(5);
    expect(state.vision.alliance.visibleTiles.size).toBeGreaterThan(0);
  });
});
