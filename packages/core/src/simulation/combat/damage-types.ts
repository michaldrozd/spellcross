import type { UnitInstance } from '../types.js';

// Rock-paper-scissors combat depth (as in the original Spellcross): a weapon's effectiveness depends on
// what it hits. Anti-tank rounds shred armor but waste on infantry; small arms mow down infantry but
// ping off tanks; AA owns aircraft; etc. Kept as a compact damage-role × armor-class matrix so no
// per-unit data is required — roles/classes are derived from weapon and unit identity.

export type ArmorClass = 'infantry' | 'light' | 'heavy' | 'air' | 'structure';
export type DamageRole = 'ap' | 'he' | 'autocannon' | 'smallarms' | 'aa' | 'arrow' | 'fire' | 'melee' | 'magic';

const HEAVY = /tank|leopard|abrams|railgun|siege|golem|titan|breorn|demon-engine|paladin|spg|mlrs|death-knight/;
const LIGHT_VEHICLE = /apc|humvee|jeep|bradley|ifv|m113|scout|avenger|gepard|truck|sky-lance|arachnoid/;

export function unitArmorClass(unit: UnitInstance): ArmorClass {
  const id = unit.definitionId.toLowerCase();
  if (unit.unitType === 'air') return 'air';
  if (unit.unitType === 'vehicle' || unit.unitType === 'artillery') {
    if (HEAVY.test(id)) return 'heavy';
    if (LIGHT_VEHICLE.test(id)) return 'light';
    return 'light'; // flesh "vehicles" (wolves, ogre, salamander, wolf-rider) read as light armour
  }
  return 'infantry'; // infantry / support / hero
}

export function weaponDamageRole(weaponId: string): DamageRole {
  const w = weaponId.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => w.includes(k));
  if (has('hex', 'curse', 'doom', 'shadow', 'scream', 'shriek', 'psi', 'spectral', 'bolt') && !has('blade')) return 'magic';
  if (has('flame', 'flamer', 'hellfire', 'magma', 'breath', 'pyro', 'oil', 'incend')) return 'fire';
  if (has('bow', 'arrow', 'dart', 'crossbow', 'quarrel')) return 'arrow';
  if (has('sam', 'aa', 'flak', 'stinger')) return 'aa';
  if (has('at', 'antitank', 'cannon', 'railgun', 'sabot', 'siege', 'lance', 'tow') && !has('auto')) return 'ap';
  if (has('shell', 'rocket', 'mortar', 'howitzer', 'boulder', 'grenade', 'missile', 'quake', 'charge')) return 'he';
  if (has('autocannon', 'hmg')) return 'autocannon';
  if (has('axe', 'blade', 'sword', 'maul', 'slam', 'fang', 'bite', 'mandible', 'claw', 'cleaver', 'talon',
          'spear', 'fist', 'mace', 'hammer', 'gore', 'tusk', 'dive', 'javelin', 'bone')) return 'melee';
  return 'smallarms'; // rifle, smg, mg, coax, gun, musket, blunderbuss, sniper, marksman, dmr, railrifle
}

// multiplier applied to weapon power. Centred so an on-role hit is ~1.2–1.5 and an off-role hit 0.25–0.7.
const EFFECTIVENESS: Record<DamageRole, Record<ArmorClass, number>> = {
  ap:         { infantry: 0.55, light: 1.15, heavy: 1.45, air: 0.35, structure: 1.25 },
  he:         { infantry: 1.25, light: 1.10, heavy: 0.80, air: 0.45, structure: 1.35 },
  autocannon: { infantry: 1.05, light: 1.20, heavy: 0.55, air: 0.95, structure: 0.75 },
  smallarms:  { infantry: 1.30, light: 0.60, heavy: 0.28, air: 0.60, structure: 0.55 },
  aa:         { infantry: 0.70, light: 0.90, heavy: 0.50, air: 1.55, structure: 0.50 },
  arrow:      { infantry: 1.15, light: 0.55, heavy: 0.25, air: 0.70, structure: 0.45 },
  fire:       { infantry: 1.40, light: 1.00, heavy: 0.60, air: 0.50, structure: 1.15 },
  melee:      { infantry: 1.10, light: 0.95, heavy: 0.70, air: 0.40, structure: 0.85 },
  magic:      { infantry: 1.15, light: 1.10, heavy: 1.00, air: 1.00, structure: 0.70 }
};

// Weapon-vs-target multiplier. 1.0 = neutral (used when either side is unknown).
export function typeEffectiveness(attacker: UnitInstance, weaponId: string, defender: UnitInstance): number {
  return EFFECTIVENESS[weaponDamageRole(weaponId)][unitArmorClass(defender)] ?? 1;
}
