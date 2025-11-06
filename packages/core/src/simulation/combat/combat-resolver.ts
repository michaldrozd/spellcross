import { axialDistance, getTile } from '../utils/grid.js';
import type {
  BattlefieldMap,
  BattleEvent,
  TacticalBattleState,
  UnitInstance
} from '../types.js';

export interface AttackInput {
  attacker: UnitInstance;
  defender: UnitInstance;
  weaponId: string;
  map: BattlefieldMap;
  random?: () => number;
}

export interface AttackOutcome {
  damage: number;
  moraleDamage: number;
  hit: boolean;
  hitChance: number;
  roll: number;
  events: BattleEvent[];
}

const ATTACK_AP_COST = 2;
const MIN_MORALE = 0;
const MAX_MORALE = 100;

const MORALE_DAMAGE_FACTOR = 0.5;
const ARMOR_ABSORPTION_FACTOR = 0.65;
const COVER_ABSORPTION_FACTOR = 0.35;
const COVER_ACCURACY_PENALTY = 0.04;
const RANGE_ACCURACY_PENALTY = 0.12;
const MIN_HIT_CHANCE = 0.05;
const MAX_HIT_CHANCE = 0.98;

export function calculateAttackRange(attacker: UnitInstance, weaponId: string): number {
  return attacker.stats.weaponRanges[weaponId] ?? 0;
}

export function calculateHitChance(input: {
  attacker: UnitInstance;
  defender: UnitInstance;
  weaponId: string;
  map: BattlefieldMap;
}): number {
  const { attacker, defender, weaponId, map } = input;

  const maxRange = calculateAttackRange(attacker, weaponId);
  if (maxRange <= 0) {
    return 0;
  }

  const distance = axialDistance(attacker.coordinate, defender.coordinate);
  if (distance > maxRange) {
    return 0;
  }

  const baseAccuracy = attacker.stats.weaponAccuracy[weaponId] ?? 0.6;

  const normalizedDistance = maxRange === 0 ? 1 : distance / maxRange;
  const rangePenalty = normalizedDistance * RANGE_ACCURACY_PENALTY;

  const defenderTile = getTile(map, defender.coordinate);
  const cover = defenderTile?.cover ?? 0;
  const coverPenalty = cover * COVER_ACCURACY_PENALTY;

  const hitChance = Math.min(
    MAX_HIT_CHANCE,
    Math.max(MIN_HIT_CHANCE, baseAccuracy - rangePenalty - coverPenalty)
  );

  return hitChance;
}

export function resolveAttack(input: AttackInput): AttackOutcome {
  const { attacker, defender, weaponId, map, random } = input;

  const events: BattleEvent[] = [];
  const maxRange = calculateAttackRange(attacker, weaponId);
  const distance = axialDistance(attacker.coordinate, defender.coordinate);
  const weaponPower = attacker.stats.weaponPower[weaponId] ?? 0;
  const defenderArmor = defender.stats.armor;
  const defenderTile = getTile(map, defender.coordinate);
  const defenderCover = defenderTile?.cover ?? 0;

  const inRange = distance <= maxRange && maxRange > 0;
  const hitChance = inRange && weaponPower > 0 && defender.stance !== 'destroyed'
    ? calculateHitChance({ attacker, defender, weaponId, map })
    : 0;

  const roll = hitChance > 0 ? (random ?? Math.random)() : 1;
  const hit = hitChance > 0 && roll <= hitChance;

  let damage = 0;
  let moraleDamage = 0;

  if (hit) {
    const armorReduction = defenderArmor * ARMOR_ABSORPTION_FACTOR;
    const coverReduction = defenderCover * COVER_ABSORPTION_FACTOR;
    const mitigatedDamage = weaponPower - armorReduction - coverReduction;
    damage = Math.max(0, Math.round(mitigatedDamage));

    const newHealth = Math.max(0, defender.currentHealth - damage);
    defender.currentHealth = newHealth;

    moraleDamage = Math.max(0, Math.round(damage * MORALE_DAMAGE_FACTOR));
    const newMorale = Math.min(MAX_MORALE, Math.max(MIN_MORALE, defender.currentMorale - moraleDamage));
    defender.currentMorale = newMorale;

    if (defender.currentHealth === 0) {
      defender.stance = 'destroyed';
      defender.actionPoints = 0;
    }
  }

  events.push({
    kind: 'unit:attacked',
    attackerId: attacker.id,
    defenderId: defender.id,
    damage,
    moraleDamage,
    weapon: weaponId,
    hit,
    hitChance,
    roll,
    defenderRemainingHealth: defender.currentHealth,
    defenderRemainingMorale: defender.currentMorale
  });

  if (defender.currentHealth === 0) {
    events.push({
      kind: 'unit:defeated',
      unitId: defender.id,
      by: attacker.id
    });
  }

  return {
    damage,
    moraleDamage,
    hit,
    hitChance,
    roll,
    events
  };
}

export function canAffordAttack(attacker: UnitInstance): boolean {
  return attacker.actionPoints >= ATTACK_AP_COST;
}

export function spendAttackCost(attacker: UnitInstance) {
  attacker.actionPoints -= ATTACK_AP_COST;
}

export function findUnitInState(
  state: TacticalBattleState,
  unitId: string
): UnitInstance | undefined {
  for (const side of Object.values(state.sides)) {
    const unit = side.units.get(unitId);
    if (unit) {
      return unit;
    }
  }
  return undefined;
}
