import { describe, expect, it } from 'vitest';

import { weaponFireMode } from './combat-resolver.js';
import { bestEnemyShotThreat, decideNextAIAction } from '../ai/baseline-ai.js';
import { createBattleState } from '../game-state.js';
import { reactionAttackers, TurnProcessor } from '../systems/turn-processor.js';
import type { BattlefieldMap, FactionId, UnitDefinition } from '../types.js';
import { tileIndex } from '../utils/grid.js';

const coordinate = {
  shooter: { q: 0, r: 1 },
  blocker: { q: 1, r: 1 },
  target: { q: 2, r: 1 },
  spotter: { q: 2, r: 0 }
} as const;

function battlefield(destructibleTarget = false): BattlefieldMap {
  const tiles = Array.from({ length: 12 }, () => ({
    terrain: 'plain' as const,
    elevation: 0,
    cover: 0,
    movementCostModifier: 1,
    passable: true,
    providesVisionBoost: false
  }));
  tiles[tileIndex({ width: 4, height: 3, tiles, id: 'line-of-fire' }, coordinate.blocker)] = {
    ...tiles[0],
    terrain: 'urban',
    cover: 3,
    blocksVision: true
  };
  if (destructibleTarget) {
    tiles[tileIndex({ width: 4, height: 3, tiles, id: 'line-of-fire' }, coordinate.target)] = {
      ...tiles[0],
      terrain: 'rubble',
      cover: 2,
      destructible: true,
      hp: 20
    };
  }
  return { id: 'line-of-fire', width: 4, height: 3, tiles };
}

function combatant(
  id: string,
  faction: FactionId,
  weapons: Record<string, number>,
  indirect: string[] = []
): UnitDefinition {
  return {
    id,
    faction,
    name: id,
    type: indirect.length ? 'artillery' : 'infantry',
    stats: {
      maxHealth: 100,
      mobility: 5,
      vision: 4,
      armor: 0,
      morale: 70,
      ammoCapacity: 8,
      weaponRanges: Object.fromEntries(Object.keys(weapons).map((weaponId) => [weaponId, 5])),
      weaponPower: weapons,
      weaponAccuracy: Object.fromEntries(Object.keys(weapons).map((weaponId) => [weaponId, 1])),
      weaponFireModes: Object.fromEntries(indirect.map((weaponId) => [weaponId, 'indirect' as const]))
    }
  };
}

const observer = (id: string, faction: FactionId): UnitDefinition => combatant(id, faction, {});

function unitIdByDefinition(state: ReturnType<typeof createBattleState>, faction: FactionId, definitionId: string) {
  return Array.from(state.sides[faction].units.values()).find((unit) => unit.definitionId === definitionId)!.id;
}

describe('direct and indirect fire', () => {
  it('blocks a direct shot but permits an indirect shot at the same faction-spotted target', () => {
    const state = createBattleState({
      map: battlefield(),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('battery', 'alliance', { rifle: 8, mortar: 8 }, ['mortar']), coordinate: coordinate.shooter },
          { definition: observer('alliance-spotter', 'alliance'), coordinate: coordinate.spotter }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('target', 'otherSide', { claws: 1 }), coordinate: coordinate.target }
        ] }
      ],
      startingFaction: 'alliance'
    });
    const attackerId = unitIdByDefinition(state, 'alliance', 'battery');
    const defenderId = unitIdByDefinition(state, 'otherSide', 'target');
    const attacker = state.sides.alliance.units.get(attackerId)!;
    const processor = new TurnProcessor(state, { random: () => 0 });

    expect(state.vision.alliance.visibleTiles.has(tileIndex(state.map, coordinate.target))).toBe(true);
    expect(weaponFireMode(attacker, 'rifle')).toBe('direct');
    const apBefore = attacker.actionPoints;
    const ammoBefore = attacker.currentAmmo;
    expect(processor.attackUnit({ attackerId, defenderId, weaponId: 'rifle' })).toMatchObject({
      success: false,
      errorKey: 'directFireBlocked'
    });
    expect(attacker.actionPoints).toBe(apBefore);
    expect(attacker.currentAmmo).toBe(ammoBefore);

    expect(processor.attackUnit({ attackerId, defenderId, weaponId: 'mortar' }).success).toBe(true);
    expect(attacker.actionPoints).toBeLessThan(apBefore);
    expect(attacker.currentAmmo).toBeLessThan(ammoBefore);
  });

  it('uses the same line-of-fire rule for destructible tiles', () => {
    const state = createBattleState({
      map: battlefield(true),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('battery', 'alliance', { rifle: 8, mortar: 8 }, ['mortar']), coordinate: coordinate.shooter },
          { definition: observer('alliance-spotter', 'alliance'), coordinate: coordinate.spotter }
        ] },
        { faction: 'otherSide', units: [] }
      ],
      startingFaction: 'alliance'
    });
    const attackerId = unitIdByDefinition(state, 'alliance', 'battery');
    const processor = new TurnProcessor(state, { random: () => 0 });

    expect(processor.attackTile({ attackerId, target: coordinate.target, weaponId: 'rifle' })).toMatchObject({
      success: false,
      errorKey: 'noLineOfSightTile'
    });
    expect(processor.attackTile({ attackerId, target: coordinate.target, weaponId: 'mortar' }).success).toBe(true);
    expect(state.map.tiles[tileIndex(state.map, coordinate.target)].hp).toBe(12);
  });

  it('allows a spotted indirect reaction shot across a blocker but not a direct one', () => {
    const makeState = (indirect: boolean) => createBattleState({
      map: battlefield(),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('mover', 'alliance', { rifle: 4 }), coordinate: coordinate.target }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('guard', 'otherSide', { shell: 7 }, indirect ? ['shell'] : []), coordinate: coordinate.shooter },
          { definition: observer('enemy-spotter', 'otherSide'), coordinate: coordinate.spotter }
        ] }
      ],
      startingFaction: 'alliance'
    });

    const directState = makeState(false);
    const directMover = Array.from(directState.sides.alliance.units.values())[0];
    expect(reactionAttackers(directState, directMover)).toHaveLength(0);

    const indirectState = makeState(true);
    const indirectMover = Array.from(indirectState.sides.alliance.units.values())[0];
    expect(reactionAttackers(indirectState, indirectMover)).toMatchObject([
      { weaponId: 'shell' }
    ]);
  });

  it('keeps AI attack proposals acceptable to the executor', () => {
    const makeState = (indirect: boolean) => createBattleState({
      map: battlefield(),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('target', 'alliance', { rifle: 4 }), coordinate: coordinate.target }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('shooter', 'otherSide', { shell: 7 }, indirect ? ['shell'] : []), coordinate: coordinate.shooter },
          { definition: observer('enemy-spotter', 'otherSide'), coordinate: coordinate.spotter }
        ] }
      ],
      startingFaction: 'otherSide'
    });

    const directState = makeState(false);
    const directTargetId = unitIdByDefinition(directState, 'alliance', 'target');
    const directAction = decideNextAIAction(directState, 'otherSide', { visibleEnemyIds: new Set([directTargetId]) });
    expect(directAction.type).not.toBe('attack');

    const indirectState = makeState(true);
    const indirectTargetId = unitIdByDefinition(indirectState, 'alliance', 'target');
    const indirectAction = decideNextAIAction(indirectState, 'otherSide', { visibleEnemyIds: new Set([indirectTargetId]) });
    expect(indirectAction).toMatchObject({ type: 'attack', defenderId: indirectTargetId, weaponId: 'shell' });
    if (indirectAction.type !== 'attack') throw new Error('Expected an indirect attack');
    expect(new TurnProcessor(indirectState, { random: () => 0 }).attackUnit(indirectAction).success).toBe(true);
  });

  it('counts spotted indirect fire when AI evaluates movement danger', () => {
    const makeState = (indirect: boolean) => createBattleState({
      map: battlefield(),
      sides: [
        { faction: 'alliance', units: [
          { definition: combatant('mover', 'alliance', { rifle: 4 }), coordinate: coordinate.target }
        ] },
        { faction: 'otherSide', units: [
          { definition: combatant('threat', 'otherSide', { shell: 7 }, indirect ? ['shell'] : []), coordinate: coordinate.shooter },
          { definition: observer('enemy-spotter', 'otherSide'), coordinate: coordinate.spotter }
        ] }
      ]
    });

    const directState = makeState(false);
    expect(bestEnemyShotThreat(
      directState,
      Array.from(directState.sides.otherSide.units.values())[0],
      Array.from(directState.sides.alliance.units.values())[0]
    )).toBe(0);

    const indirectState = makeState(true);
    expect(bestEnemyShotThreat(
      indirectState,
      Array.from(indirectState.sides.otherSide.units.values())[0],
      Array.from(indirectState.sides.alliance.units.values())[0]
    )).toBeGreaterThan(0);
  });
});
