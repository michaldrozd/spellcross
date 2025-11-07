import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plain = {
  terrain: 'plain',
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

const makeMap = (w: number, h: number) => ({ id: 'm', width: w, height: h, tiles: Array.from({ length: w * h }, () => plain) });

const base: CreateBattleStateOptions = {
  map: makeMap(7, 3),
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: {
            id: 'ally', faction: 'alliance', name: 'Ally', type: 'infantry',
            stats: {
              maxHealth: 40, mobility: 6, vision: 4, armor: 0, morale: 50,
              weaponRanges: { rifle: 3 }, weaponPower: { rifle: 10 }, weaponAccuracy: { rifle: 0.8 }
            }
          },
          coordinate: { q: 0, r: 1 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        {
          definition: {
            id: 'archer', faction: 'otherSide', name: 'Archer', type: 'infantry',
            stats: {
              maxHealth: 40, mobility: 5, vision: 4, armor: 0, morale: 50,
              weaponRanges: { bow: 4 }, weaponPower: { bow: 12 }, weaponAccuracy: { bow: 0.9 }
            }
          },
          coordinate: { q: 5, r: 1 }
        }
      ]
    }
  ]
};

describe('Overwatch (reaction fire)', () => {
  it('triggers reaction fire when moving into enemy LoS/range', () => {
    const state = createBattleState(base);
    // deterministic hit
    const processor = new TurnProcessor(state, { random: () => 0 });
    const moverId = Array.from(state.sides.alliance.units.keys())[0];

    const result = processor.moveUnit({
      unitId: moverId,
      path: [ { q:1, r:1 }, { q:2, r:1 }, { q:3, r:1 } ]
    });

    expect(result.success).toBe(true);
    const ally = state.sides.alliance.units.get(moverId)!;
    // took some damage due to reaction fire
    expect(ally.currentHealth).toBeLessThan(40);

    const shot = state.timeline.find(e => e.kind==='unit:attacked');
    expect(shot).toBeDefined();
  });

  it('stops movement if the unit is destroyed by reaction fire and does not log unit:moved', () => {
    const lethal = structuredClone(base);
    // make enemy bow lethal to ensure kill in a single shot
    lethal.sides = base.sides.map(s => ({
      ...s,
      units: s.units.map(u => u.definition.id==='archer' ? {
        ...u,
        definition: {
          ...u.definition,
          stats: { ...u.definition.stats, weaponPower: { bow: 999 }, weaponAccuracy: { bow: 1 } }
        }
      } : u)
    }));

    const state = createBattleState(lethal);
    const processor = new TurnProcessor(state, { random: () => 0 });
    const moverId = Array.from(state.sides.alliance.units.keys())[0];

    const beforeAP = state.sides.alliance.units.get(moverId)!.actionPoints;

    const res = processor.moveUnit({ unitId: moverId, path: [ { q:1, r:1 }, { q:2, r:1 } ] });
    expect(res.success).toBe(true);

    const ally = state.sides.alliance.units.get(moverId)!;
    expect(ally.stance).toBe('destroyed');

    // only the first step was paid before destruction
    expect(ally.actionPoints).toBeCloseTo(beforeAP - 1);

    // ensure no consolidated unit:moved event was logged
    const movedEvent = state.timeline.find(e => e.kind==='unit:moved');
    expect(movedEvent).toBeUndefined();
  });
});

