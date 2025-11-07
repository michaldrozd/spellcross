import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { calculateHitChance } from './combat-resolver.js';

const mkTile = (terrain: any, elevation: number) => ({ terrain, elevation, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Elevation advantage', () => {
  it('higher ground yields better hit chance', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [mkTile('plain', 2), mkTile('plain', 0)] };
    const base: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'a', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 3, vision: 3, armor: 0, morale: 50, weaponRanges: { w: 1 }, weaponPower: { w: 1 }, weaponAccuracy: { w: 0.5 } } }, coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: { id: 'b', faction: 'otherSide', name: 'B', type: 'infantry', stats: { maxHealth: 10, mobility: 3, vision: 3, armor: 0, morale: 50, weaponRanges: { w: 1 }, weaponPower: { w: 1 }, weaponAccuracy: { w: 0.5 } } }, coordinate: { q: 1, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(base);
    const attacker = Array.from(state.sides.alliance.units.values())[0]!;
    const defender = Array.from(state.sides.otherSide.units.values())[0]!;

    const high = calculateHitChance({ attacker, defender, weaponId: 'w', map: state.map });

    // swap elevations
    state.map.tiles[0].elevation = 0;
    state.map.tiles[1].elevation = 2;

    const low = calculateHitChance({ attacker, defender, weaponId: 'w', map: state.map });

    expect(high).toBeGreaterThan(low);
  });
});

