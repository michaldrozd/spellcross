import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const t = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Leveling', () => {
  it('levels up when XP crosses 100 * level threshold and emits unit:level', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [t('plain'), t('plain')] } as const;
    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { r: 2 }, weaponPower: { r: 3 }, weaponAccuracy: { r: 1 } } }, coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: { id: 'e', faction: 'otherSide', name: 'E', type: 'infantry', stats: { maxHealth: 3, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { k: 1 }, weaponPower: { k: 1 }, weaponAccuracy: { k: 1 } } }, coordinate: { q: 1, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];

    const ally = state.sides.alliance.units.get(allyId)!;
    ally.experience = 95; // close to level 2 threshold (100)

    tp.state.activeFaction = 'alliance';
    const res = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'r' });
    expect(res.success).toBe(true);

    expect(ally.level).toBe(2);
    const levelEvent = state.timeline.find(e => e.kind==='unit:level' && e.unitId===allyId && e.level===2);
    expect(levelEvent).toBeDefined();
  });
});

