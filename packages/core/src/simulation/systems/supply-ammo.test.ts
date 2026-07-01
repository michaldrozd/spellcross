import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const spec: CreateBattleStateOptions = {
  map: { id: 'm', width: 3, height: 1, tiles: [plain, plain, plain] },
  sides: [
    {
      faction: 'alliance',
      units: [
        // a gunner with just 2 rounds, next to a supply truck
        { definition: { id: 'gunner', faction: 'alliance', name: 'G', type: 'infantry',
          stats: { maxHealth: 30, mobility: 4, vision: 4, armor: 0, morale: 60, ammoCapacity: 2,
            weaponRanges: { rifle: 3 }, weaponPower: { rifle: 10 }, weaponAccuracy: { rifle: 1 } } }, coordinate: { q: 0, r: 0 } },
        { definition: { id: 'supply-truck', faction: 'alliance', name: 'Supply', type: 'support',
          stats: { maxHealth: 40, mobility: 6, vision: 4, armor: 0, morale: 60, ammoCapacity: 0,
            weaponRanges: {}, weaponPower: {}, weaponAccuracy: {} } }, coordinate: { q: 1, r: 0 } }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        { definition: { id: 'target', faction: 'otherSide', name: 'T', type: 'infantry',
          stats: { maxHealth: 200, mobility: 4, vision: 4, armor: 0, morale: 60,
            weaponRanges: { r: 1 }, weaponPower: { r: 1 }, weaponAccuracy: { r: 1 } } }, coordinate: { q: 2, r: 0 } }
      ]
    }
  ]
};

describe('ammo depletion + resupply', () => {
  it('firing drains ammo, an empty weapon cannot fire, and a supply unit refills it', () => {
    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const gunnerId = Array.from(state.sides.alliance.units.keys()).find((k) => k.startsWith('gunner'))!;
    const truckId = Array.from(state.sides.alliance.units.keys()).find((k) => k.startsWith('supply'))!;
    const targetId = Array.from(state.sides.otherSide.units.keys())[0];
    const gunner = state.sides.alliance.units.get(gunnerId)!;

    expect(gunner.currentAmmo).toBe(2);
    tp.attackUnit({ attackerId: gunnerId, defenderId: targetId, weaponId: 'rifle' });
    expect(gunner.currentAmmo).toBe(1);
    tp.attackUnit({ attackerId: gunnerId, defenderId: targetId, weaponId: 'rifle' });
    expect(gunner.currentAmmo).toBe(0);

    // out of ammo → attack is rejected
    const dry = tp.attackUnit({ attackerId: gunnerId, defenderId: targetId, weaponId: 'rifle' });
    expect(dry.success).toBe(false);

    // supply truck refills the adjacent gunner to full
    const res = tp.supply({ supplierId: truckId, targetId: gunnerId });
    expect(res.success).toBe(true);
    expect(gunner.currentAmmo).toBe(2);
  });
});
