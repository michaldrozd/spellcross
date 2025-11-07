import { describe, expect, it } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const base: CreateBattleStateOptions = {
  map: { id: 'm', width: 3, height: 1, tiles: [plain, plain, plain] },
  sides: [
    {
      faction: 'alliance',
      units: [
        { definition: { id: 'ally', faction: 'alliance', name: 'Ally', type: 'infantry', stats: { maxHealth: 30, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { rifle: 2 }, weaponPower: { rifle: 8 }, weaponAccuracy: { rifle: 0.8 } } }, coordinate: { q: 0, r: 0 } }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        { definition: { id: 'e', faction: 'otherSide', name: 'E', type: 'infantry', stats: { maxHealth: 30, mobility: 4, vision: 3, armor: 0, morale: 40, weaponRanges: { pistol: 2 }, weaponPower: { pistol: 5 }, weaponAccuracy: { pistol: 1 } } }, coordinate: { q: 2, r: 0 } }
      ]
    }
  ]
};

describe('Entrenchment', () => {
  it('increments when stationary at endTurn and resets on move', () => {
    const state = createBattleState(base);
    const tp = new TurnProcessor(state);
    const id = Array.from(state.sides.alliance.units.keys())[0];

    // No movement this turn
    tp.endTurn();
    const unit = state.sides.alliance.units.get(id)!;
    expect(unit.entrench).toBe(1);

    // Move one step -> reset entrench
    tp.state.activeFaction = 'alliance';
    tp.moveUnit({ unitId: id, path: [{ q: 1, r: 0 }] });
    expect(unit.entrench).toBe(0);
  });

  it('is reduced by 1 on hit', () => {
    const state = createBattleState(base);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];

    // entrench the ally
    tp.endTurn();
    const ally = state.sides.alliance.units.get(allyId)!;
    expect(ally.entrench).toBe(1);

    // switch to enemy and attack
    tp.state.activeFaction = 'otherSide';
    const res = tp.attackUnit({ attackerId: enemyId, defenderId: allyId, weaponId: 'pistol' });
    expect(res.success).toBe(true);
    expect(ally.entrench).toBe(0);
  });
});

