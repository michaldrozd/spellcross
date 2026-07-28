import { starterUnits } from '@spellcross/data';
import { describe, it, expect } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { estimateHitDamage } from './combat-resolver.js';
import { unitArmorClass, weaponDamageRole } from './damage-types.js';
import type { ArmorClass } from './damage-types.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const EXPECTED_ARMOR_CLASS_IDS: Record<ArmorClass, string[]> = {
  infantry: [
    'john-alexander', 'light-infantry', 'rangers', 'orc-warband', 'ghoul-pack',
    'necromancer', 'heavy-infantry', 'sniper-team', 'field-medic', 'warlock',
    'specter', 'lich-lord', 'hell-rider', 'skeleton-horde', 'commando-team',
    'flamethrower-squad', 'psi-corps', 'exo-troopers', 'ka-orc', 'war-orc',
    'antitank-orc', 'dark-elf-archers', 'valkyrie-mobile-infantry',
    'breach-engineers', 'rift-predator', 'veil-magus', 'gate-conjurer',
    'thorn-elf-master', 'signal-eater', 'renegade-cell'
  ],
  light: [
    'mortar-team', 'm113', 'gepard-aa', 'ogre-brute', 'supply-truck',
    'salamander', 'sky-lance', 'wolf-rider', 'humvee-scout', 'bradley-ifv',
    'avenger-aa', 'dire-wolves', 'arachnoid', 'firefly-105',
    'badger-mortar-carrier', 'thunderhead-155', 'tempest-counterbattery',
    'horizon-radar', 'tidewalker-apc', 'wardog-fire-support', 'bone-ballista',
    'resonance-cannon', 'slime-harvester', 'ash-mammoth'
  ],
  heavy: [
    'leopard-2', 'spg-m109', 'paladin-acs', 'demon-engine', 'light-tank',
    'railgun-tank', 'mlrs-battery', 'siege-walker', 'death-knight',
    'stone-golem', 'breorn-titan', 'aegis-assault-tank',
    'ironroot-colossus', 'dread-fortress', 'glass-regent'
  ],
  air: [
    'winged-fiend', 'attack-helo', 'void-drake', 'harpy-swarm', 'black-angel',
    'cerberus-gunship', 'kestrel-recon-drone', 'razorwing-flock',
    'gloom-balloon', 'ash-crown-sovereign'
  ],
  structure: ['arrow-tower']
};

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
  it('pins the armour class of every canonical unit', () => {
    const actual: Record<ArmorClass, string[]> = {
      infantry: [],
      light: [],
      heavy: [],
      air: [],
      structure: []
    };

    for (const unit of starterUnits) {
      actual[unitArmorClass({ definitionId: unit.id, unitType: unit.type })].push(unit.id);
    }

    expect(actual).toEqual(EXPECTED_ARMOR_CLASS_IDS);
    expect(Object.values(EXPECTED_ARMOR_CLASS_IDS).flat()).toHaveLength(starterUnits.length);
  });

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

  it('treats the largest armoured constructs as heavy targets', () => {
    for (const defenderId of ['ironroot-colossus', 'dread-fortress', 'glass-regent']) {
      const antiTank = dmg('vehicle', 'at', 'vehicle', defenderId);
      const autocannon = dmg('vehicle', 'autocannon', 'vehicle', defenderId);
      expect(antiTank, defenderId).toBeGreaterThan(autocannon * 2);
    }
  });

  it('treats support vehicles as light armour rather than infantry', () => {
    for (const defenderId of ['supply-truck', 'horizon-radar']) {
      const vsSupportVehicle = dmg('infantry', 'rifle', 'support', defenderId);
      const vsFootSupport = dmg('infantry', 'rifle', 'support', 'field-medic');
      expect(vsFootSupport, defenderId).toBeGreaterThan(vsSupportVehicle * 2);
    }
  });
});
