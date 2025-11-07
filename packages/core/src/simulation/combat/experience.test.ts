import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from '../systems/turn-processor.js';

const mkTile = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Experience awards', () => {
  it('awards XP on hit and extra on kill', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [mkTile('plain'), mkTile('plain')] };
    const base: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { rifle: 2 }, weaponPower: { rifle: 3 }, weaponAccuracy: { rifle: 1 } } }, coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: { id: 'e', faction: 'otherSide', name: 'E', type: 'infantry', stats: { maxHealth: 3, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { knife: 1 }, weaponPower: { knife: 1 }, weaponAccuracy: { knife: 1 } } }, coordinate: { q: 1, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(base);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];

    tp.state.activeFaction = 'alliance';

    const beforeXP = state.sides.alliance.units.get(allyId)!.experience;
    const res = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'rifle' });
    expect(res.success).toBe(true);

    const ally = state.sides.alliance.units.get(allyId)!;
    expect(ally.experience - beforeXP).toBe(25); // 5 hit + 20 kill

    const hitXp = state.timeline.find(e => e.kind==='unit:xp' && e.unitId===allyId && e.reason==='hit');
    const killXp = state.timeline.find(e => e.kind==='unit:xp' && e.unitId===allyId && e.reason==='kill');
    expect(hitXp).toBeDefined();
    expect(killXp).toBeDefined();
  });
});

