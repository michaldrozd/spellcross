import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from '../systems/turn-processor.js';

const mkTile = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Weapon target-type restrictions', () => {
  it('enforces per-weapon target categories', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [mkTile('plain'), mkTile('plain')] };
    const base: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: {
            maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50,
            weaponRanges: { rifle: 2, aa: 3 }, weaponPower: { rifle: 3, aa: 3 }, weaponAccuracy: { rifle: 1, aa: 1 },
            weaponTargets: { rifle: ['infantry','vehicle','artillery','support','hero'], aa: ['air'] }
          } }, coordinate: { q: 0, r: 0 } }
        ]},
        { faction: 'otherSide', units: [
          { definition: { id: 'fly', faction: 'otherSide', name: 'F', type: 'air', stats: { maxHealth: 10, mobility: 6, vision: 3, armor: 0, morale: 50, weaponRanges: { claw: 1 }, weaponPower: { claw: 1 }, weaponAccuracy: { claw: 1 } } }, coordinate: { q: 1, r: 0 } }
        ]}
      ]
    };

    const state = createBattleState(base);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];

    // rifle cannot target air (per targets list)
    tp.state.activeFaction = 'alliance';
    let r = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'rifle' });
    expect(r.success).toBe(false);

    // aa can target air
    r = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'aa' });
    expect(r.success).toBe(true);
  });
});

