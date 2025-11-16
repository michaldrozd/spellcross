import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { calculateAttackRange, calculateHitChance, resolveAttack } from './combat-resolver.js';

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

const battleSpec: CreateBattleStateOptions = {
  map: {
    id: 'combat-map',
    width: 2,
    height: 1,
    tiles: [plainTile, plainTile]
  },
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: {
            id: 'sniper',
            faction: 'alliance',
            name: 'Sniper',
            type: 'infantry',
            stats: {
              maxHealth: 80,
              mobility: 6,
              vision: 6,
              armor: 1,
              morale: 70,
              weaponRanges: { rifle: 6 },
              weaponPower: { rifle: 50 },
              weaponAccuracy: { rifle: 0.85 }
            }
          },
          coordinate: { q: 0, r: 0 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        {
          definition: {
            id: 'ghoul',
            faction: 'otherSide',
            name: 'Ghoul',
            type: 'infantry',
            stats: {
              maxHealth: 30,
              mobility: 5,
              vision: 3,
              armor: 0,
              morale: 30,
              weaponRanges: { claws: 1 },
              weaponPower: { claws: 8 },
              weaponAccuracy: { claws: 0.6 }
            }
          },
          coordinate: { q: 1, r: 0 }
        }
      ]
    }
  ]
};

describe('combat-resolver', () => {
  it('calculates attack range from unit stats', () => {
    const state = createBattleState(battleSpec);
    const attackerId = Array.from(state.sides.alliance.units.keys())[0];
    const attacker = state.sides.alliance.units.get(attackerId)!;
    expect(calculateAttackRange(attacker, 'rifle')).toBe(6);
    expect(calculateAttackRange(attacker, 'unknown')).toBe(0);
  });

  it('grants additional range when the attacker occupies high ground', () => {
    const elevatedSpec: CreateBattleStateOptions = {
      ...battleSpec,
      map: {
        ...battleSpec.map,
        tiles: [
          {
            ...battleSpec.map.tiles[0],
            elevation: 1,
            providesVisionBoost: true
          },
          battleSpec.map.tiles[1]
        ]
      }
    };
    const state = createBattleState(elevatedSpec);
    const attackerId = Array.from(state.sides.alliance.units.keys())[0];
    const attacker = state.sides.alliance.units.get(attackerId)!;
    // base 6 + 1 (elevation) + 1 (vision boost)
    expect(calculateAttackRange(attacker, 'rifle', state.map)).toBe(8);
  });

  it('resolves lethal attacks and emits events', () => {
    const state = createBattleState(battleSpec);
    const attackerId = Array.from(state.sides.alliance.units.keys())[0];
    const defenderId = Array.from(state.sides.otherSide.units.keys())[0];

    const attacker = state.sides.alliance.units.get(attackerId)!;
    const defender = state.sides.otherSide.units.get(defenderId)!;

  const outcome = resolveAttack({
    attacker,
    defender,
    weaponId: 'rifle',
    map: state.map,
    random: () => 0
  });

  expect(outcome.hit).toBe(true);
  expect(outcome.hitChance).toBeGreaterThan(0);
  expect(outcome.roll).toBe(0);
  expect(defender.currentHealth).toBe(0);
  expect(defender.stance).toBe('destroyed');
  expect(outcome.events.some((event) => event.kind === 'unit:defeated')).toBe(true);
});

it('reduces hit chance with cover', () => {
  const state = createBattleState({
    ...battleSpec,
    map: {
      ...battleSpec.map,
      tiles: [
        {
          ...battleSpec.map.tiles[0]
        },
        {
          ...battleSpec.map.tiles[1],
          cover: 4
        }
      ]
    }
  });

  const attackerId = Array.from(state.sides.alliance.units.keys())[0];
  const defenderId = Array.from(state.sides.otherSide.units.keys())[0];
  const attacker = state.sides.alliance.units.get(attackerId)!;
  const defender = state.sides.otherSide.units.get(defenderId)!;

  const chance = calculateHitChance({
    attacker,
    defender,
    weaponId: 'rifle',
    map: state.map
  });

  expect(chance).toBeLessThan(attacker.stats.weaponAccuracy.rifle);
});
});
