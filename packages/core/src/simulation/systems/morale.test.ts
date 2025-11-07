import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const base: CreateBattleStateOptions = {
  map: { id: 'm', width: 2, height: 1, tiles: [plain, plain] },
  sides: [
    {
      faction: 'alliance',
      units: [
        { definition: { id: 'ally', faction: 'alliance', name: 'Ally', type: 'infantry', stats: { maxHealth: 20, mobility: 4, vision: 3, armor: 0, morale: 28, weaponRanges: { rifle: 1 }, weaponPower: { rifle: 10 }, weaponAccuracy: { rifle: 1 } } }, coordinate: { q: 0, r: 0 } }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        { definition: { id: 'e', faction: 'otherSide', name: 'E', type: 'infantry', stats: { maxHealth: 50, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { pistol: 1 }, weaponPower: { pistol: 8 }, weaponAccuracy: { pistol: 1 } } }, coordinate: { q: 1, r: 0 } }
      ]
    }
  ]
};

describe('Morale states', () => {
  it('drops to suppressed and routed at thresholds and blocks routed attacks', () => {
    const state = createBattleState(base);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];

    // Enemy attacks ally twice to push morale down
    tp.state.activeFaction = 'otherSide';
    tp.attackUnit({ attackerId: enemyId, defenderId: allyId, weaponId: 'pistol' });
    const ally = state.sides.alliance.units.get(allyId)!;
    expect(ally.stance === 'suppressed' || ally.stance === 'routed').toBe(true);

    // More attacks to push into routed territory
    tp.attackUnit({ attackerId: enemyId, defenderId: allyId, weaponId: 'pistol' });
    expect(ally.stance).toBe('routed');

    // Routed unit cannot attack
    tp.state.activeFaction = 'alliance';
    const res = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'rifle' });
    expect(res.success).toBe(false);
  });
});

