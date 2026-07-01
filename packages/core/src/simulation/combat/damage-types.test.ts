import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { estimateHitDamage } from './combat-resolver.js';
import { unitArmorClass, weaponDamageRole } from './damage-types.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const mk = (id: string, faction: 'alliance' | 'otherSide', type: any, q: number, weapons: Record<string, number>) => ({
  definition: { id, faction, name: id, type, stats: { maxHealth: 100, mobility: 4, vision: 4, armor: 0, morale: 60,
    weaponRanges: Object.fromEntries(Object.keys(weapons).map((w) => [w, 4])), weaponPower: weapons,
    weaponAccuracy: Object.fromEntries(Object.keys(weapons).map((w) => [w, 1])) } },
  coordinate: { q, r: 0 }
});

function dmg(attackerType: any, weapon: string, defenderType: any, defenderId = 'foe') {
  const spec: CreateBattleStateOptions = {
    map: { id: 'm', width: 3, height: 1, tiles: [plain, plain, plain] },
    sides: [
      { faction: 'alliance', units: [mk('atk', 'alliance', attackerType, 0, { [weapon]: 20 })] },
      { faction: 'otherSide', units: [mk(defenderId, 'otherSide', defenderType, 1, { x: 1 })] }
    ]
  };
  const state = createBattleState(spec);
  const a = Array.from(state.sides.alliance.units.values())[0];
  const d = Array.from(state.sides.otherSide.units.values())[0];
  return estimateHitDamage(a, d, weapon, state.map);
}

describe('damage-type effectiveness (rock-paper-scissors)', () => {
  it('classifies roles and armour classes', () => {
    expect(weaponDamageRole('at')).toBe('ap');
    expect(weaponDamageRole('rifle')).toBe('smallarms');
    expect(weaponDamageRole('longbow')).toBe('arrow');
    expect(weaponDamageRole('sam')).toBe('aa');
    expect(weaponDamageRole('flamer')).toBe('fire');
  });

  it('anti-tank shreds heavy armour but wastes on infantry', () => {
    const vsTank = dmg('vehicle', 'at', 'vehicle', 'railgun-tank'); // heavy
    const vsInf = dmg('vehicle', 'at', 'infantry', 'foot');
    expect(vsTank).toBeGreaterThan(vsInf * 2);
  });

  it('small arms mow down infantry but ping off tanks', () => {
    const vsInf = dmg('infantry', 'rifle', 'infantry', 'foot');
    const vsTank = dmg('infantry', 'rifle', 'vehicle', 'leopard-2'); // heavy
    expect(vsInf).toBeGreaterThan(vsTank * 3);
  });

  it('AA owns aircraft', () => {
    const vsAir = dmg('vehicle', 'sam', 'air', 'harpy');
    const vsGround = dmg('vehicle', 'sam', 'vehicle', 'leopard-2');
    expect(vsAir).toBeGreaterThan(vsGround * 2);
  });
});
