import { describe, expect, it } from 'vitest';

import { createBattleState } from '../game-state.js';
import type { CreateBattleStateOptions } from '../game-state.js';
import { TurnProcessor, reactionThreats } from './turn-processor.js';

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
    // The shot is recorded at the path tile the mover was crossing when it entered range (q1, distance 4),
    // NOT the destination (q3) — so the UI can anchor the muzzle to the glide instead of the end tile.
    expect(shot?.kind === 'unit:attacked' ? shot.defenderAt : undefined).toEqual({ q: 1, r: 1 });
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

  it('reactionThreats previews who would punish a position and the damage they would deal', () => {
    const state = createBattleState(base);
    const ally = Array.from(state.sides.alliance.units.values())[0];

    // standing at q3 is within the archer's bow range (distance 2 <= 4)
    ally.coordinate = { q: 3, r: 1 };
    const threats = reactionThreats(state, ally);
    expect(threats.length).toBe(1);
    expect(threats[0].attackerId).toBe(Array.from(state.sides.otherSide.units.keys())[0]);
    expect(threats[0].potentialDamage).toBe(14); // bow power 12 × arrow-vs-infantry 1.15 ≈ 14, no armor/cover
    expect(threats[0].hitChance).toBeGreaterThan(0);

    // out of range -> no threat
    ally.coordinate = { q: 0, r: 1 }; // distance 5 > bow range 4
    expect(reactionThreats(state, ally).length).toBe(0);
  });

  it('keeps overwatch on the resting side so it can react during the enemy turn', () => {
    const state = createBattleState(base);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    proc.setOverwatch(allyId);
    expect(state.sides.alliance.units.get(allyId)!.statusEffects.has('overwatch')).toBe(true);
    proc.endTurn(); // alliance -> otherSide; the alliance unit's reaction window is the enemy turn
    expect(state.sides.alliance.units.get(allyId)!.statusEffects.has('overwatch')).toBe(true);
  });

  it('reaction fire that destroys a transport also kills its embarked passengers', () => {
    const spec: CreateBattleStateOptions = {
      map: makeMap(7, 3),
      sides: [
        {
          faction: 'alliance',
          units: [
            {
              definition: {
                id: 'apc', faction: 'alliance', name: 'APC', type: 'vehicle',
                stats: { maxHealth: 40, mobility: 8, vision: 4, armor: 0, morale: 50, transportCapacity: 2,
                  weaponRanges: { gun: 3 }, weaponPower: { gun: 6 }, weaponAccuracy: { gun: 0.7 } }
              },
              coordinate: { q: 0, r: 1 }
            },
            {
              definition: {
                id: 'rider', faction: 'alliance', name: 'Rider', type: 'infantry',
                stats: { maxHealth: 30, mobility: 6, vision: 4, armor: 0, morale: 50,
                  weaponRanges: { rifle: 3 }, weaponPower: { rifle: 8 }, weaponAccuracy: { rifle: 0.7 } }
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
                id: 'archer', faction: 'otherSide', name: 'Archer', type: 'infantry',
                stats: { maxHealth: 40, mobility: 5, vision: 4, armor: 0, morale: 50,
                  weaponRanges: { bow: 5 }, weaponPower: { bow: 999 }, weaponAccuracy: { bow: 1 } }
              },
              coordinate: { q: 5, r: 1 }
            }
          ]
        }
      ]
    };
    const state = createBattleState(spec);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const apcId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'vehicle')!.id;
    const riderId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'infantry')!.id;
    expect(proc.embark({ carrierId: apcId, passengerId: riderId }).success).toBe(true);
    // loaded APC drives into the archer's range; the lethal reaction shot destroys it mid-move
    proc.moveUnit({ unitId: apcId, path: [{ q: 1, r: 1 }, { q: 2, r: 1 }] });
    expect(state.sides.alliance.units.get(apcId)!.stance).toBe('destroyed');
    // the passenger must die with the carrier, not be orphaned alive on a dead transport
    const rider = state.sides.alliance.units.get(riderId)!;
    expect(rider.stance).toBe('destroyed');
    expect(rider.embarkedOn).toBeUndefined();
  });

  it('refreshes AP only for the side whose turn is starting', () => {
    const state = createBattleState(base);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const allyId = Array.from(state.sides.alliance.units.keys())[0];
    state.sides.alliance.units.get(allyId)!.actionPoints = 0;
    proc.endTurn(); // alliance ends -> otherSide active; the resting alliance unit keeps its AP
    expect(state.sides.alliance.units.get(allyId)!.actionPoints).toBe(0);
  });

  it('a supply unit refills an adjacent ally to full ammo for AP', () => {
    const spec: CreateBattleStateOptions = {
      map: makeMap(5, 3),
      sides: [
        {
          faction: 'alliance',
          units: [
            {
              definition: {
                id: 'truck', faction: 'alliance', name: 'Truck', type: 'support',
                stats: { maxHealth: 70, mobility: 8, vision: 4, armor: 1, morale: 60, ammoCapacity: 0,
                  weaponRanges: { smg: 3 }, weaponPower: { smg: 8 }, weaponAccuracy: { smg: 0.55 } }
              },
              coordinate: { q: 1, r: 1 }
            },
            {
              definition: {
                id: 'rifleman', faction: 'alliance', name: 'Rifleman', type: 'infantry',
                stats: { maxHealth: 40, mobility: 6, vision: 4, armor: 0, morale: 50, ammoCapacity: 8,
                  weaponRanges: { rifle: 4 }, weaponPower: { rifle: 10 }, weaponAccuracy: { rifle: 0.7 } }
              },
              coordinate: { q: 2, r: 1 }
            }
          ]
        },
        { faction: 'otherSide', units: [] }
      ]
    };
    const state = createBattleState(spec);
    const proc = new TurnProcessor(state, { random: () => 0 });
    const truckId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'support')!.id;
    const rifleId = Array.from(state.sides.alliance.units.values()).find((u) => u.unitType === 'infantry')!.id;
    state.sides.alliance.units.get(rifleId)!.currentAmmo = 2; // depleted
    const apBefore = state.sides.alliance.units.get(truckId)!.actionPoints;

    const res = proc.supply({ supplierId: truckId, targetId: rifleId });
    expect(res.success).toBe(true);
    expect(state.sides.alliance.units.get(rifleId)!.currentAmmo).toBe(8); // refilled to capacity
    expect(state.sides.alliance.units.get(truckId)!.actionPoints).toBe(apBefore - 2);

    // a non-supply unit cannot resupply
    expect(proc.supply({ supplierId: rifleId, targetId: truckId }).success).toBe(false);
  });
});

