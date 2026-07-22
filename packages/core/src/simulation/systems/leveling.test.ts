import { describe, it, expect } from 'vitest';

import { calculateHitChance } from '../combat/combat-resolver.js';
import {
  MAX_EXPERIENCE_LEVEL,
  experienceAccuracyBonus,
  experienceLevelFor,
  nextExperienceLevelThreshold
} from '../combat/experience.js';
import { createBattleState, createUnitInstance } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const t = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Leveling', () => {
  it('improves accuracy immediately when cumulative XP crosses a level threshold', () => {
    const map = { id: 'm', width: 2, height: 1, tiles: [t('plain'), t('plain')] } as const;
    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { r: 2 }, weaponPower: { r: 3 }, weaponAccuracy: { r: 0.7 } } }, coordinate: { q: 0, r: 0 }, experience: 195 }
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
    const enemy = state.sides.otherSide.units.get(enemyId)!;
    const before = calculateHitChance({ attacker: ally, defender: enemy, weaponId: 'r', map: state.map });

    tp.state.activeFaction = 'alliance';
    const res = tp.attackUnit({ attackerId: allyId, defenderId: enemyId, weaponId: 'r' });
    expect(res.success).toBe(true);

    expect(ally.level).toBe(2);
    const levelEvent = state.timeline.find(e => e.kind==='unit:level' && e.unitId===allyId && e.level===2);
    expect(levelEvent).toBeDefined();
    const after = calculateHitChance({ attacker: ally, defender: enemy, weaponId: 'r', map: state.map });
    expect(after - before).toBeCloseTo(0.01);
  });

  it('caps level bonuses and keeps level one neutral', () => {
    expect(experienceLevelFor(0)).toBe(1);
    expect(experienceAccuracyBonus(1)).toBe(0);
    expect(experienceLevelFor(1_000_000)).toBe(MAX_EXPERIENCE_LEVEL);
    expect(experienceAccuracyBonus(1_000_000)).toBe(0.04);
    expect(nextExperienceLevelThreshold(1_000_000)).toBeUndefined();

    const attacker = createUnitInstance({
      id: 'capped-attacker', faction: 'alliance', name: 'Capped attacker', type: 'infantry',
      stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { r: 2 }, weaponPower: { r: 3 }, weaponAccuracy: { r: 0.94 } }
    }, 'alliance', { q: 0, r: 0 });
    const defender = createUnitInstance({
      id: 'target', faction: 'otherSide', name: 'Target', type: 'infantry',
      stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { r: 2 }, weaponPower: { r: 3 }, weaponAccuracy: { r: 0.6 } }
    }, 'otherSide', { q: 0, r: 0 });
    attacker.level = MAX_EXPERIENCE_LEVEL;
    const map = {
      id: 'cap-map', width: 1, height: 1, tiles: [t('plain')]
    };
    expect(calculateHitChance({ attacker, defender, weaponId: 'r', map })).toBe(0.94);

    attacker.careerProgression = true;
    expect(calculateHitChance({ attacker, defender, weaponId: 'r', map })).toBe(0.98);
  });
});
