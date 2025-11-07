import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const t = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Morale recovery at endTurn', () => {
  it('recovers morale with entrenchment and penalizes proximity to enemies', () => {
    const map = { id: 'm', width: 3, height: 1, tiles: [t('plain'), t('plain'), t('plain')] } as const;

    const base: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 40, weaponRanges: { r: 2 }, weaponPower: { r: 2 }, weaponAccuracy: { r: 1 } } }, coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: { id: 'orc', faction: 'otherSide', name: 'O', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { a: 1 }, weaponPower: { a: 1 }, weaponAccuracy: { a: 1 } } }, coordinate: { q: 2, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(base);
    const tp = new TurnProcessor(state, { random: () => 0 });

    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const ally = state.sides.alliance.units.get(allyId)!;

    // End alliance turn once: entrench +1, morale recovers base 3 + entrench 1 = +4 (no enemy within 2)
    tp.endTurn();
    expect(ally.entrench).toBe(1);
    expect(ally.currentMorale).toBe(44);

    // Move enemy near within distance 2 and end their turn to process alliance recovery again
    const enemyId = Array.from(state.sides.otherSide.units.keys())[0];
    state.sides.otherSide.units.get(enemyId)!.coordinate = { q: 1, r: 0 };

    tp.endTurn(); // otherSide ends -> alliance becomes active; then next endTurn applies to alliance
    tp.endTurn(); // now alliance ends, morale recovery applies with nearby enemy penalty (2)

    // +3 base + entrench (now 2) = +5, -2 proximity = net +3 from previous 44 -> 47
    expect(ally.entrench).toBe(2);
    expect(ally.currentMorale).toBe(47);
  });
});

