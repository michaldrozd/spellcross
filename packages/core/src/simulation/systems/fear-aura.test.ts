import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor } from './turn-processor.js';

const t = (terrain: any) => ({ terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false });

const byDef = (state: any, faction: 'alliance' | 'otherSide', defId: string) =>
  Array.from(state.sides[faction].units.values() as Iterable<any>).find((u) => u.definitionId === defId)!;

const infantry = (id: string, faction: 'alliance' | 'otherSide', extra: Record<string, unknown> = {}) => ({
  id, faction, name: id, type: 'infantry' as const,
  stats: { maxHealth: 10, mobility: 4, vision: 3, armor: 0, morale: 40, weaponRanges: { r: 1 }, weaponPower: { r: 1 }, weaponAccuracy: { r: 1 }, ...extra }
});

describe('Fear aura', () => {
  it('saps the morale of a mundane unit within 2 hexes but spares one out of range', () => {
    // q: 0 .. 6; demon at q=2, near ally at q=0 (dist 2), far ally at q=6 (dist 4)
    const map = { id: 'm', width: 7, height: 1, tiles: Array.from({ length: 7 }, () => t('plain')) } as const;

    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: infantry('near', 'alliance'), coordinate: { q: 0, r: 0 } },
          { definition: infantry('far', 'alliance'), coordinate: { q: 6, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: infantry('lich', 'otherSide', { morale: 90, fear: 2 }), coordinate: { q: 2, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const near = byDef(state, 'alliance', 'near');
    const far = byDef(state, 'alliance', 'far');

    tp.endTurn(); // alliance ends: entrench +1, base recovery +4

    // near: 40 + 4 base − (fear 2 × 2) = 40 → suppressed
    expect(near.currentMorale).toBe(40);
    expect(near.stance).toBe('suppressed');

    // far: 40 + 4 base = 44, no fear in range → ready
    expect(far.currentMorale).toBe(44);
    expect(far.stance).toBe('ready');
  });

  it('leaves a fearless unit (one that projects fear itself) unaffected', () => {
    const map = { id: 'm', width: 3, height: 1, tiles: [t('plain'), t('plain'), t('plain')] } as const;

    const spec: CreateBattleStateOptions = {
      map,
      sides: [
        { faction: 'alliance', units: [
          { definition: infantry('human', 'alliance'), coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          // a fearless undead standing next to a terror source takes no dread
          { definition: infantry('ghoul', 'otherSide', { morale: 40, fear: 1 }), coordinate: { q: 1, r: 0 } },
          { definition: infantry('lich', 'otherSide', { morale: 90, fear: 3 }), coordinate: { q: 2, r: 0 } }
        ] }
      ]
    };

    const state = createBattleState(spec);
    const tp = new TurnProcessor(state, { random: () => 0 });
    const ghoul = byDef(state, 'otherSide', 'ghoul');

    tp.endTurn(); // alliance ends (no otherSide morale processed)
    tp.endTurn(); // otherSide ends: ghoul recovers; its own/lich fear must not touch it

    // ghoul: 40 + 3 base + 1 entrench − 2 (human adjacent) = 42, untouched by the lich's fear
    expect(ghoul.stats.fear).toBe(1);
    expect(ghoul.currentMorale).toBe(42);
  });
});
