import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const tile = (t: any, extra: Partial<typeof base> = {}) => ({ terrain: t, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false, ...extra });

describe('Destructible terrain', () => {
  it('allows destroying a structure tile and makes it passable', () => {
    const map = {
      id: 'm', width: 2, height: 1,
      tiles: [
        tile('plain'),
        { terrain: 'structure', elevation: 0, cover: 3, movementCostModifier: 1, passable: false, providesVisionBoost: false, destructible: true, hp: 10 }
      ]
    } as const;

    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'sapper', faction: 'alliance', name: 'Sapper', type: 'infantry', stats: { maxHealth: 10, mobility: 6, vision: 3, armor: 0, morale: 50, weaponRanges: { satchel: 2 }, weaponPower: { satchel: 6 }, weaponAccuracy: { satchel: 1 } } }, coordinate: { q: 0, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const unitId = Array.from(state.sides.alliance.units.keys())[0];

    // First hit
    let res = tp.attackTile({ attackerId: unitId, target: { q: 1, r: 0 }, weaponId: 'satchel' });
    expect(res.success).toBe(true);
    expect(state.map.tiles[1].hp).toBe(4);

    // Second hit destroys the tile
    res = tp.attackTile({ attackerId: unitId, target: { q: 1, r: 0 }, weaponId: 'satchel' });
    expect(res.success).toBe(true);

    const t = state.map.tiles[1];
    expect(t.hp).toBe(0);
    expect(t.terrain).toBe('plain');
    expect(t.passable).toBe(true);
    expect(t.cover).toBe(0);

    const destroyed = state.timeline.find(e => e.kind==='tile:destroyed');
    expect(destroyed).toBeDefined();
  });
});
