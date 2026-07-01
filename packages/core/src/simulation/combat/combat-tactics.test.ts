import { describe, it, expect } from 'vitest';
import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { calculateHitChance } from './combat-resolver.js';
import { isoDirectionIndex } from '../utils/grid-iso.js';
import { decideNextAIAction } from '../ai/baseline-ai.js';

const plain = { terrain: 'plain', elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false } as const;

const gunner = (id: string, faction: 'alliance' | 'otherSide', q: number, r: number) => ({
  definition: { id, faction, name: id, type: 'infantry' as const,
    stats: { maxHealth: 40, mobility: 4, vision: 6, armor: 0, morale: 60,
      weaponRanges: { rifle: 6 }, weaponPower: { rifle: 12 }, weaponAccuracy: { rifle: 0.7 } } },
  coordinate: { q, r }
});

function state5() {
  const spec: CreateBattleStateOptions = {
    map: { id: 'm', width: 5, height: 5, tiles: Array.from({ length: 25 }, () => plain) },
    sides: [
      { faction: 'alliance', units: [gunner('front', 'alliance', 2, 0), gunner('rear', 'alliance', 2, 4)] },
      { faction: 'otherSide', units: [gunner('foe', 'otherSide', 2, 2)] }
    ]
  };
  return createBattleState(spec);
}

describe('flanking / rear attacks', () => {
  it('a rear attack lands more often than a frontal one', () => {
    const state = state5();
    const foe = Array.from(state.sides.otherSide.units.values())[0];
    const front = Array.from(state.sides.alliance.units.values()).find((u) => u.id.startsWith('front'))!;
    const rear = Array.from(state.sides.alliance.units.values()).find((u) => u.id.startsWith('rear'))!;
    // point the defender AT the frontal attacker → the rear attacker hits its exposed back
    foe.orientation = isoDirectionIndex(foe.coordinate, front.coordinate);
    const frontal = calculateHitChance({ attacker: front, defender: foe, weaponId: 'rifle', map: state.map });
    const flanked = calculateHitChance({ attacker: rear, defender: foe, weaponId: 'rifle', map: state.map });
    expect(flanked).toBeGreaterThan(frontal);
  });
});

describe('weapon selection by effective damage (counters express)', () => {
  // a trooper carrying BOTH a small-arms MG (accurate, anti-infantry) and an AT gun (anti-armour)
  const trooper = (q: number, foeType: 'vehicle' | 'infantry') => ({
    definition: { id: 'trooper', faction: 'alliance' as const, name: 'T', type: 'infantry' as const,
      stats: { maxHealth: 40, mobility: 4, vision: 6, armor: 0, morale: 60,
        weaponRanges: { mg: 4, at: 4 }, weaponPower: { mg: 16, at: 22 }, weaponAccuracy: { mg: 0.9, at: 0.7 } } },
    coordinate: { q, r: 0 }
  });
  const foe = (q: number, type: 'vehicle' | 'infantry', armor: number, id: string) => ({
    definition: { id, faction: 'otherSide' as const, name: id, type,
      stats: { maxHealth: 80, mobility: 4, vision: 4, armor, morale: 60, weaponRanges: { x: 1 }, weaponPower: { x: 1 }, weaponAccuracy: { x: 1 } } },
    coordinate: { q, r: 0 }
  });
  function pick(foeType: 'vehicle' | 'infantry', armor: number, foeId: string) {
    const state = createBattleState({
      map: { id: 'm', width: 6, height: 1, tiles: Array.from({ length: 6 }, () => plain) },
      sides: [
        { faction: 'alliance', units: [trooper(1, foeType)] },
        { faction: 'otherSide', units: [foe(3, foeType, armor, foeId)] }
      ]
    });
    const foeUnit = Array.from(state.sides.otherSide.units.values())[0];
    const action = decideNextAIAction(state, 'alliance', { aggression: 0.9, difficulty: 'hard', visibleEnemyIds: new Set([foeUnit.id]) });
    return action.type === 'attack' ? action.weaponId : `(no attack: ${action.type})`;
  }
  it('fires the AT gun at a heavy tank, not the more-accurate MG', () => {
    expect(pick('vehicle', 6, 'leopard-2')).toBe('at');
  });
  it('fires the MG at infantry, not the AT gun', () => {
    expect(pick('infantry', 0, 'foot')).toBe('mg');
  });
});

describe('weather', () => {
  it('night and fog reduce hit chance vs clear', () => {
    const state = state5();
    const foe = Array.from(state.sides.otherSide.units.values())[0];
    const front = Array.from(state.sides.alliance.units.values()).find((u) => u.id.startsWith('front'))!;
    const base = { attacker: front, defender: foe, weaponId: 'rifle', map: state.map } as const;
    const clear = calculateHitChance({ ...base, weather: 'clear' });
    const night = calculateHitChance({ ...base, weather: 'night' });
    const fog = calculateHitChance({ ...base, weather: 'fog' });
    expect(night).toBeLessThan(clear);
    expect(fog).toBeLessThan(clear);
  });
});
