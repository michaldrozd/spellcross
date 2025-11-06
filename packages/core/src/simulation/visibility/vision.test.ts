import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { updateFactionVision } from './vision.js';

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
  cover: 4,
  terrain: 'structure'
} as const;

const battleSpec: CreateBattleStateOptions = {
  map: {
    id: 'vision-map',
    width: 3,
    height: 3,
    tiles: [
      plainTile,
      wallTile,
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
            id: 'scout',
            faction: 'alliance',
            name: 'Scout',
            type: 'infantry',
            stats: {
              maxHealth: 80,
              mobility: 7,
              vision: 4,
              armor: 1,
              morale: 60,
              weaponRanges: { smg: 5 },
              weaponPower: { smg: 18 },
              weaponAccuracy: { smg: 0.7 }
            }
          },
          coordinate: { q: 0, r: 0 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: []
    }
  ]
};

describe('updateFactionVision', () => {
  it('marks tiles visible within vision range', () => {
    const state = createBattleState(battleSpec);
    updateFactionVision(state, 'alliance');
    const vision = state.vision.alliance.visibleTiles;
    expect(vision.has(3)).toBe(true); // tile (0,1)
    expect(state.vision.alliance.exploredTiles.has(3)).toBe(true);
  });

  it('blocks line of sight through impassable tiles', () => {
    const state = createBattleState(battleSpec);
    updateFactionVision(state, 'alliance');
    const blockedTileIndex = 2; // tile at (2,0) behind wall at (1,0)
    expect(state.vision.alliance.visibleTiles.has(blockedTileIndex)).toBe(false);
  });

  it('handles factions with no active units', () => {
    const state = createBattleState({
      ...battleSpec,
      sides: [
        {
          faction: 'otherSide',
          units: []
        }
      ]
    });

    updateFactionVision(state, 'otherSide');
    expect(state.vision.otherSide.visibleTiles.size).toBe(0);
  });
});
