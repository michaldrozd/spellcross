import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const t = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

describe('Commander aura', () => {
  it('adds +2 morale when a friendly hero is within 2 hexes (non-stacking)', () => {
    const map = { id: 'm', width: 3, height: 1, tiles: [t('plain'), t('plain'), t('plain')] } as const;

    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: { id: 'ally', faction: 'alliance', name: 'A', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 40, weaponRanges: { r: 2 }, weaponPower: { r: 2 }, weaponAccuracy: { r: 1 } } }, coordinate: { q: 0, r: 0 } },
          { definition: { id: 'hero', faction: 'alliance', name: 'H', type: 'hero',     stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { s: 1 }, weaponPower: { s: 1 }, weaponAccuracy: { s: 1 } } }, coordinate: { q: 1, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: { id: 'orc', faction: 'otherSide', name: 'O', type: 'infantry', stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 50, weaponRanges: { a: 1 }, weaponPower: { a: 1 }, weaponAccuracy: { a: 1 } } }, coordinate: { q: 2, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });

    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    const ally = state.sides.alliance.units.get(allyId)!;

    // End alliance turn: entrench +1; morale +3 base +1 entrench +2 aura = +6 -> 46
    tp.endTurn();
    expect(ally.entrench).toBe(1);
    expect(ally.currentMorale).toBe(46);

    // Add a second hero; aura should not stack
    state.sides.alliance.units.set('hero2', {
      ...state.sides.alliance.units.get(Array.from(state.sides.alliance.units.keys())[1])!,
      id: 'hero2', coordinate: { q: 0, r: 0 }
    });

    tp.endTurn(); // otherSide ends
    tp.endTurn(); // alliance ends again

    // Previous morale 46 -> +3 base +2 entrench +2 aura = +7 -> 53 (not +9)
    expect(ally.entrench).toBe(2);
    expect(ally.currentMorale).toBe(53);
  });
});

