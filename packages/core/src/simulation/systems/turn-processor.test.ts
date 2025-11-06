import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

const baseSpec: CreateBattleStateOptions = {
  map: {
    id: 'turn-map',
    width: 3,
    height: 3,
    tiles: Array.from({ length: 9 }, () => plainTile)
  },
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: {
            id: 'inf',
            faction: 'alliance',
            name: 'Inf',
            type: 'infantry',
            stats: {
              maxHealth: 100,
              mobility: 6,
              vision: 4,
              armor: 1,
              morale: 60,
              weaponRanges: { rifle: 5 },
              weaponPower: { rifle: 24 },
              weaponAccuracy: { rifle: 0.8 }
            }
          },
          coordinate: { q: 0, r: 0 }
        }
      ]
    }
  ]
};

describe('TurnProcessor.moveUnit', () => {
  it('spends action points according to movement cost', () => {
    const state = createBattleState(baseSpec);
    const processor = new TurnProcessor(state);
    const unitId = Array.from(state.sides.alliance.units.keys())[0];

    const result = processor.moveUnit({
      unitId,
      path: [
        { q: 1, r: 0 },
        { q: 1, r: 1 }
      ]
    });

    expect(result.success).toBe(true);
    const unit = state.sides.alliance.units.get(unitId);
    expect(unit?.coordinate).toEqual({ q: 1, r: 1 });
    expect(unit?.actionPoints).toBeCloseTo(4);
  });

  it('rejects paths that include occupied tiles', () => {
    const state = createBattleState({
      ...baseSpec,
      sides: [
        ...baseSpec.sides,
        {
          faction: 'otherSide',
          units: [
            {
              definition: {
                id: 'imp',
                faction: 'otherSide',
                name: 'Imp',
                type: 'infantry',
                stats: {
                  maxHealth: 70,
                  mobility: 5,
                  vision: 3,
                  armor: 0,
                  morale: 40,
                  weaponRanges: { claws: 1 },
                  weaponPower: { claws: 8 },
                  weaponAccuracy: { claws: 0.55 }
                }
              },
              coordinate: { q: 1, r: 0 }
            }
          ]
        }
      ]
    });

    const processor = new TurnProcessor(state);
    const unitId = Array.from(state.sides.alliance.units.keys())[0];

    const result = processor.moveUnit({
      unitId,
      path: [
        { q: 1, r: 0 },
        { q: 2, r: 0 }
      ]
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Path collides with another unit');
  });
});

describe('TurnProcessor.attackUnit', () => {
  it('applies damage and logs combat events', () => {
    const state = createBattleState({
      ...baseSpec,
      sides: [
        baseSpec.sides[0],
        {
          faction: 'otherSide',
          units: [
            {
              definition: {
                id: 'orc',
                faction: 'otherSide',
                name: 'Orc',
                type: 'infantry',
                stats: {
                  maxHealth: 30,
                  mobility: 5,
                  vision: 3,
                  armor: 1,
                  morale: 40,
                  weaponRanges: { axe: 1 },
                  weaponPower: { axe: 10 },
                  weaponAccuracy: { axe: 0.65 }
                }
              },
              coordinate: { q: 1, r: 0 }
            }
          ]
        }
      ]
    });

    const processor = new TurnProcessor(state, { random: () => 0 });
    const attackerId = Array.from(state.sides.alliance.units.keys())[0];
    const defenderId = Array.from(state.sides.otherSide.units.keys())[0];

    const result = processor.attackUnit({
      attackerId,
      defenderId,
      weaponId: 'rifle'
    });

    expect(result.success).toBe(true);
    const defender = state.sides.otherSide.units.get(defenderId);
    expect(defender?.currentHealth).toBeLessThan(30);
    expect(defender?.stance === 'destroyed' || defender?.currentHealth).toBeDefined();

    const attacker = state.sides.alliance.units.get(attackerId);
    expect(attacker?.actionPoints).toBeLessThan(attacker?.maxActionPoints ?? 0);

    const attackEvent = state.timeline.find((event) => event.kind === 'unit:attacked');
    expect(attackEvent).toBeDefined();
    if (attackEvent?.kind === 'unit:attacked') {
      expect(attackEvent.hitChance).toBeGreaterThan(0);
      expect(attackEvent.roll).toBe(0);
    }
  });
});
