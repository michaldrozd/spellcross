import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plain = {
  terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false
} as const;

const makeMap = (w: number, h: number) => ({ id: 'm', width: w, height: h, tiles: Array.from({ length: w * h }, () => plain) });

describe('Field medic (heal action)', () => {
  const spec: CreateBattleStateOptions = {
    map: makeMap(5, 3),
    sides: [
      {
        faction: 'alliance',
        units: [
          {
            definition: {
              id: 'field-medic', faction: 'alliance', name: 'Field Medic', type: 'support',
              stats: { maxHealth: 50, mobility: 6, vision: 4, armor: 0, morale: 60, ammoCapacity: 8,
                weaponRanges: { smg: 3 }, weaponPower: { smg: 8 }, weaponAccuracy: { smg: 0.55 } }
            },
            coordinate: { q: 1, r: 1 }
          },
          {
            definition: {
              id: 'rifleman', faction: 'alliance', name: 'Rifleman', type: 'infantry',
              stats: { maxHealth: 40, mobility: 6, vision: 4, armor: 0, morale: 50, ammoCapacity: 8,
                weaponRanges: { rifle: 4 }, weaponPower: { rifle: 10 }, weaponAccuracy: { rifle: 0.7 } }
            },
            coordinate: { q: 2, r: 1 }
          }
        ]
      },
      { faction: 'otherSide', units: [] }
    ]
  };

  it('restores HP to a wounded adjacent ally for AP', () => {
    const state = createBattleState(spec);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const medicId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'support')!.id;
    const rifleId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'infantry')!.id;
    state.sides.alliance.units.get(rifleId)!.currentHealth = 10; // wounded
    const apBefore = state.sides.alliance.units.get(medicId)!.actionPoints;

    const res = proc.heal({ medicId, targetId: rifleId });
    expect(res.success).toBe(true);
    expect(state.sides.alliance.units.get(rifleId)!.currentHealth).toBe(35); // 10 + 25
    expect(state.sides.alliance.units.get(medicId)!.actionPoints).toBe(apBefore - 2);
  });

  it('never overheals past max health', () => {
    const state = createBattleState(spec);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const medicId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'support')!.id;
    const rifleId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'infantry')!.id;
    state.sides.alliance.units.get(rifleId)!.currentHealth = 38; // 2 below max of 40

    expect(proc.heal({ medicId, targetId: rifleId }).success).toBe(true);
    expect(state.sides.alliance.units.get(rifleId)!.currentHealth).toBe(40);
  });

  it('rejects healing a full-health ally and a non-medic healer', () => {
    const state = createBattleState(spec);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const medicId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'support')!.id;
    const rifleId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'infantry')!.id;

    expect(proc.heal({ medicId, targetId: rifleId }).success).toBe(false); // already full HP
    state.sides.alliance.units.get(medicId)!.currentHealth = 5;
    expect(proc.heal({ medicId: rifleId, targetId: medicId }).success).toBe(false); // a rifleman can't heal
  });
});
