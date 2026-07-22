import { describe, expect, it } from 'vitest';

import { attackOrderValues, decideNextAIAction } from '../ai/baseline-ai.js';
import {
  estimateHitDamage,
  SUPPRESSIVE_HIT_MORALE_FLOOR,
  SUPPRESSIVE_MISS_MORALE_DAMAGE
} from '../combat/combat-resolver.js';
import { createBattleState } from '../game-state.js';
import type { BattlefieldMap, FactionId, UnitDefinition, UnitInstance } from '../types.js';
import { ENTRENCHED_IDLE_MORALE_PENALTY } from './morale.js';
import { TurnProcessor } from './turn-processor.js';
import { tileIndex } from '../utils/grid.js';

function battlefield(width = 5, height = 3): BattlefieldMap {
  return {
    id: 'morale-depth',
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: 'plain' as const,
      elevation: 0,
      cover: 0,
      movementCostModifier: 1,
      passable: true,
      providesVisionBoost: false
    }))
  };
}

function combatant(
  id: string,
  faction: FactionId,
  overrides: Partial<UnitDefinition['stats']> = {},
  type: UnitDefinition['type'] = 'infantry'
): UnitDefinition {
  return {
    id,
    faction,
    name: id,
    type,
    stats: {
      maxHealth: 60,
      mobility: 4,
      vision: 6,
      armor: 0,
      morale: 60,
      ammoCapacity: 8,
      weaponRanges: { rifle: 4 },
      weaponPower: { rifle: 10 },
      weaponAccuracy: { rifle: 1 },
      ...overrides
    }
  };
}

function unitByDefinition(
  state: ReturnType<typeof createBattleState>,
  faction: FactionId,
  definitionId: string
): UnitInstance {
  return Array.from(state.sides[faction].units.values()).find(
    (unit) => unit.definitionId === definitionId
  )!;
}

describe('suppression orders', () => {
  it('uses weapon spotting and line-of-fire rules for direct and indirect shots', () => {
    const map = battlefield();
    map.tiles[tileIndex(map, { q: 1, r: 1 })] = {
      ...map.tiles[0],
      terrain: 'urban',
      cover: 3,
      blocksVision: true
    };
    const state = createBattleState({
      map,
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('battery', 'alliance', {
            weaponRanges: { rifle: 4, mortar: 4 },
            weaponPower: { rifle: 10, mortar: 10 },
            weaponAccuracy: { rifle: 1, mortar: 1 },
            weaponFireModes: { mortar: 'indirect' },
            weaponTargets: { mortar: ['infantry'] }
          }, 'artillery'), coordinate: { q: 0, r: 1 } },
          { definition: combatant('spotter', 'alliance', {
            weaponRanges: {}, weaponPower: {}, weaponAccuracy: {}
          }), coordinate: { q: 2, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('target', 'otherSide'), coordinate: { q: 2, r: 1 } }
        ] }
      ]
    });
    const battery = unitByDefinition(state, 'alliance', 'battery');
    const target = unitByDefinition(state, 'otherSide', 'target');
    const processor = new TurnProcessor(state, { random: () => 0 });

    expect(processor.suppressUnit({ attackerId: battery.id, defenderId: target.id, weaponId: 'rifle' }))
      .toMatchObject({ success: false, errorKey: 'directFireBlocked' });
    expect(processor.suppressUnit({ attackerId: battery.id, defenderId: target.id, weaponId: 'mortar' }).success)
      .toBe(true);

    const air = {
      ...target,
      id: 'air-target',
      unitType: 'air' as const,
      coordinate: { q: 3, r: 0 },
      currentHealth: 60,
      stance: 'ready' as const
    };
    state.sides.otherSide.units.set(air.id, air);
    battery.actionPoints = battery.maxActionPoints;
    expect(processor.suppressUnit({ attackerId: battery.id, defenderId: air.id, weaponId: 'mortar' }))
      .toMatchObject({ success: false, errorKey: 'weaponCannotTarget' });
  });

  it('rattles heavy armor on a hit and applies only near-miss morale without XP on a miss', () => {
    const state = createBattleState({
      map: battlefield(),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('shooter', 'alliance', { weaponPower: { rifle: 4 } }), coordinate: { q: 0, r: 1 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('armor', 'otherSide', { armor: 20 }), coordinate: { q: 2, r: 1 } }
        ] }
      ]
    });
    const shooter = unitByDefinition(state, 'alliance', 'shooter');
    const armor = unitByDefinition(state, 'otherSide', 'armor');
    const hitProcessor = new TurnProcessor(state, { random: () => 0 });

    expect(estimateHitDamage(shooter, armor, 'rifle', state.map)).toBe(0);
    const hit = hitProcessor.suppressUnit({ attackerId: shooter.id, defenderId: armor.id, weaponId: 'rifle' });
    expect(hit.success).toBe(true);
    expect(armor.currentHealth).toBe(armor.stats.maxHealth);
    expect(armor.currentMorale).toBe(60 - SUPPRESSIVE_HIT_MORALE_FLOOR);
    expect(shooter.experience).toBe(5);
    expect(hit.events?.find((event) => event.kind === 'unit:attacked')).toMatchObject({
      attackMode: 'suppressive',
      damage: 0,
      moraleDamage: SUPPRESSIVE_HIT_MORALE_FLOOR,
      hit: true
    });

    shooter.actionPoints = shooter.maxActionPoints;
    expect(hitProcessor.suppressUnit({ attackerId: shooter.id, defenderId: armor.id, weaponId: 'rifle' }))
      .toMatchObject({ success: false, errorKey: 'suppressionAlreadyUsed' });
    shooter.statusEffects.delete('suppression-used');
    const experienceBeforeMiss = shooter.experience;
    const moraleBeforeMiss = armor.currentMorale;
    const missProcessor = new TurnProcessor(state, { random: () => 1 });
    expect(missProcessor.suppressUnit({ attackerId: shooter.id, defenderId: armor.id, weaponId: 'rifle' }).success)
      .toBe(true);
    expect(armor.currentMorale).toBe(moraleBeforeMiss - SUPPRESSIVE_MISS_MORALE_DAMAGE);
    expect(shooter.experience).toBe(experienceBeforeMiss);
  });

  it('keeps a good normal shot more valuable than one shooter suppressing', () => {
    const state = createBattleState({
      map: battlefield(),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('shooter', 'alliance'), coordinate: { q: 0, r: 1 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('soft-target', 'otherSide'), coordinate: { q: 2, r: 1 } }
        ] }
      ]
    });
    const shooter = unitByDefinition(state, 'alliance', 'shooter');
    const target = unitByDefinition(state, 'otherSide', 'soft-target');
    const values = attackOrderValues(state, shooter, target, 'rifle');

    expect(values.normalDamage).toBeGreaterThan(2);
    expect(values.normal).toBeGreaterThan(values.suppressive);
    expect(decideNextAIAction(state, 'alliance')).toMatchObject({ type: 'attack', weaponId: 'rifle' });
  });

  it('requires sustained multi-unit ammo and allows morale to recover when pressure stops', () => {
    const state = createBattleState({
      map: battlefield(6, 3),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [0, 1, 2].map((index) => ({
          definition: combatant(`rifle-${index}`, 'alliance', { weaponPower: { rifle: 4 } }),
          coordinate: { q: 0, r: index }
        })) },
        { faction: 'otherSide', units: [
          { definition: combatant('high-value', 'otherSide', { armor: 20, morale: 50 }), coordinate: { q: 3, r: 1 } }
        ] }
      ]
    });
    const target = unitByDefinition(state, 'otherSide', 'high-value');
    const shooters = Array.from(state.sides.alliance.units.values());
    const processor = new TurnProcessor(state, { random: () => 0 });

    for (const shooter of shooters) {
      expect(processor.suppressUnit({ attackerId: shooter.id, defenderId: target.id, weaponId: 'rifle' }).success)
        .toBe(true);
      expect(shooter.actionPoints).toBe(shooter.maxActionPoints - 2);
      expect(shooter.currentAmmo).toBe(7);
    }
    expect(target.currentMorale).toBe(38);
    expect(target.stance).toBe('suppressed');

    processor.endTurn();
    processor.endTurn();
    expect(target.currentMorale).toBe(43);
    expect(target.stance).toBe('ready');
  });
});

describe('entrenchment commitment', () => {
  it('digs in immediately by unit type without double-counting at end turn', () => {
    const state = createBattleState({
      map: battlefield(),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('infantry', 'alliance'), coordinate: { q: 0, r: 0 } },
          { definition: combatant('vehicle', 'alliance', {}, 'vehicle'), coordinate: { q: 0, r: 2 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('enemy', 'otherSide'), coordinate: { q: 4, r: 1 } }
        ] }
      ]
    });
    const infantry = unitByDefinition(state, 'alliance', 'infantry');
    const vehicle = unitByDefinition(state, 'alliance', 'vehicle');
    const processor = new TurnProcessor(state);

    expect(processor.digIn(infantry.id).success).toBe(true);
    expect(infantry.entrench).toBe(2);
    expect(infantry.actionPoints).toBe(0);
    expect(processor.digIn(vehicle.id).success).toBe(true);
    expect(vehicle.entrench).toBe(1);
    processor.endTurn();
    expect(infantry.entrench).toBe(2);
    expect(vehicle.entrench).toBe(1);
  });

  it('does not grant passive cover after AP spending and pins the safe bunker steady state', () => {
    const state = createBattleState({
      map: battlefield(),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('camper', 'alliance', { morale: 80 }), coordinate: { q: 0, r: 0 } },
          { definition: combatant('worker', 'alliance'), coordinate: { q: 0, r: 2 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('enemy', 'otherSide'), coordinate: { q: 4, r: 2 } }
        ] }
      ]
    });
    const camper = unitByDefinition(state, 'alliance', 'camper');
    const worker = unitByDefinition(state, 'alliance', 'worker');
    const enemy = unitByDefinition(state, 'otherSide', 'enemy');
    const processor = new TurnProcessor(state, { random: () => 1 });

    expect(processor.attackUnit({ attackerId: worker.id, defenderId: enemy.id, weaponId: 'rifle' }).success)
      .toBe(true);
    processor.endTurn();
    expect(worker.entrench).toBe(0);
    expect(camper.entrench).toBe(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      processor.endTurn();
      processor.endTurn();
    }
    expect(camper.entrench).toBe(3);
    expect(camper.idleEntrenchedTurns).toBeGreaterThanOrEqual(2);
    expect(ENTRENCHED_IDLE_MORALE_PENALTY).toBe(6);
    expect(camper.currentMorale).toBe(91);
  });
});

describe('rout and rally', () => {
  it('accepts only retreating routed paths and rallies outside contact', () => {
    const state = createBattleState({
      map: battlefield(4, 3),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('routed', 'alliance'), coordinate: { q: 1, r: 1 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('enemy', 'otherSide'), coordinate: { q: 0, r: 1 } }
        ] }
      ]
    });
    const routed = unitByDefinition(state, 'alliance', 'routed');
    const enemy = unitByDefinition(state, 'otherSide', 'enemy');
    routed.currentMorale = 20;
    routed.stance = 'routed';
    enemy.actionPoints = 0;
    const processor = new TurnProcessor(state);

    expect(processor.moveUnit({ unitId: routed.id, path: [{ q: 1, r: 0 }] }))
      .toMatchObject({ success: false, errorKey: 'routedMustRetreat' });
    expect(processor.moveUnit({ unitId: routed.id, path: [{ q: 2, r: 1 }] }).success).toBe(true);
    expect(processor.rally(routed.id).success).toBe(true);
    expect(routed.currentMorale).toBe(28);
    expect(routed.stance).toBe('suppressed');
    expect(routed.actionPoints).toBe(0);
  });

  it('treats a cornered routed unit as a clean terminal AI state', () => {
    const state = createBattleState({
      map: battlefield(2, 2),
      startingFaction: 'alliance',
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('cornered', 'alliance'), coordinate: { q: 0, r: 0 } }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('enemy', 'otherSide'), coordinate: { q: 1, r: 0 } }
        ] }
      ]
    });
    const cornered = unitByDefinition(state, 'alliance', 'cornered');
    const enemy = unitByDefinition(state, 'otherSide', 'enemy');
    cornered.currentMorale = 20;
    cornered.stance = 'routed';
    const processor = new TurnProcessor(state);

    expect(processor.moveUnit({ unitId: cornered.id, path: [{ q: 0, r: 1 }] }))
      .toMatchObject({ success: false, errorKey: 'routedMustRetreat' });
    expect(processor.rally(cornered.id)).toMatchObject({ success: false, errorKey: 'enemyTooCloseToRally' });
    expect(processor.attackUnit({ attackerId: cornered.id, defenderId: enemy.id, weaponId: 'rifle' }))
      .toMatchObject({ success: false, errorKey: 'routedCannotAttack' });
    expect(processor.setOverwatch(cornered.id))
      .toMatchObject({ success: false, errorKey: 'routedCannotOverwatch' });
    expect(processor.digIn(cornered.id))
      .toMatchObject({ success: false, errorKey: 'routedCannotDigIn' });
    expect(decideNextAIAction(state, 'alliance')).toEqual({ type: 'endTurn' });
  });
});
