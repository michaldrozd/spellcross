import { describe, expect, it } from 'vitest';

import {
  createCampaign,
  evaluateBattleOutcome,
  serializeCampaignState,
  startBattleForTerritory
} from './campaign.js';
import { starterBundle } from '../../../data/src/index.js';
import {
  decideNextAIAction,
  type AIImmediateAction
} from '../simulation/ai/baseline-ai.js';
import { planPathForUnitIso } from '../simulation/pathfinding/iso-pathfinder.js';
import { TurnProcessor } from '../simulation/systems/turn-processor.js';
import type { TacticalBattleState } from '../simulation/types.js';
import { isoDistance } from '../simulation/utils/grid-iso.js';

const SCALED_CONVOYS = [
  ['sector-amsterdam', 1_620, 12],
  ['sector-ashen-confluence', 2_160, 15],
  ['sector-ash-compass', 4_200, 22]
] as const;

const SCALED_BRIDGEHEADS = [
  ['sector-strasbourg', 1_620, 14],
  ['sector-vienna', 1_620, 14],
  ['sector-warsaw', 2_160, 18],
  ['sector-blacksea', 2_160, 18],
  ['sector-sable-causeway', 4_200, 35],
  ['sector-glass-wake', 4_200, 35]
] as const;

const SCALED_HOLD_LINES = [
  ['sector-lyon', 1_620, 14],
  ['sector-zurich', 1_620, 14],
  ['sector-copenhagen', 1_620, 14],
  ['sector-carpathian', 2_160, 18],
  ['sector-thorn-engine', 4_200, 35],
  ['sector-dawn-anchor', 4_200, 35]
] as const;

const SCALED_SIMPLE_ASSAULTS = [
  ['sector-munich', 1_620, 14],
  ['sector-prague', 1_620, 14],
  ['sector-berlin', 2_160, 18],
  ['sector-krakow', 2_160, 18],
  ['sector-kyiv', 2_160, 18],
  ['sector-cinder-gate', 2_160, 18],
  ['sector-hollow-tide', 2_160, 18],
  ['sector-veil-heart', 2_160, 18]
] as const;

const SCALED_OPERATION_IDS = [
  ...SCALED_CONVOYS.map(([territoryId]) => territoryId),
  ...SCALED_BRIDGEHEADS.map(([territoryId]) => territoryId),
  ...SCALED_HOLD_LINES.map(([territoryId]) => territoryId),
  ...SCALED_SIMPLE_ASSAULTS.map(([territoryId]) => territoryId)
];

function openBattle(territoryId: string) {
  const state = createCampaign(starterBundle, undefined, 'veteran');
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (!territory) throw new Error(`missing ${territoryId}`);
  territory.status = 'available';
  const selectedUnitIds = state.army
    .filter((unit) => (unit.availableOnTurn ?? 0) <= state.turn)
    .slice(0, 8)
    .map((unit) => unit.id);
  const battle = startBattleForTerritory(state, starterBundle, territoryId, selectedUnitIds);
  battle.deployed = true;
  return { state, battle };
}

function executeAiAction(processor: TurnProcessor, action: AIImmediateAction) {
  switch (action.type) {
    case 'move':
      return processor.moveUnit(action);
    case 'attack':
      return processor.attackUnit(action);
    case 'suppress':
      return processor.suppressUnit(action);
    case 'attackTile':
      return processor.attackTile({
        attackerId: action.unitId,
        target: action.target,
        weaponId: action.weaponId
      });
    case 'supply':
      return processor.supply({ supplierId: action.supplierId, targetId: action.targetId });
    case 'heal':
      return processor.heal({ medicId: action.medicId, targetId: action.targetId });
    case 'digIn':
      return processor.digIn(action.unitId);
    case 'rally':
      return processor.rally(action.unitId);
    case 'endTurn':
      return { success: true, events: [] };
  }
}

function visibleEnemyIds(state: TacticalBattleState) {
  const visible = state.vision.otherSide.visibleTiles;
  return new Set(
    Array.from(state.sides.alliance.units.values())
      .filter((unit) => (
        unit.stance !== 'destroyed'
        && !unit.embarkedOn
        && visible.has(unit.coordinate.r * state.map.width + unit.coordinate.q)
      ))
      .map((unit) => unit.id)
  );
}

describe('scaled battlefields', () => {
  it.each(SCALED_CONVOYS)(
    'keeps %s travel meaningful and inside its authored deadline',
    (territoryId, cells, deadlineRound) => {
      const { battle } = openBattle(territoryId);
      const objective = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-reach`
      ));
      const convoyId = battle.deployment[`${territoryId}-convoy`];
      const convoy = battle.state.sides.alliance.units.get(convoyId);
      if (!objective?.target || !convoy) throw new Error(`missing convoy route for ${territoryId}`);

      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(objective.turnLimit).toBe(deadlineRound);
      expect(Math.min(...Array.from(battle.state.sides.otherSide.units.values()).map((enemy) => (
        isoDistance(convoy.coordinate, enemy.coordinate)
      )))).toBeLessThanOrEqual(convoy.maxActionPoints * 2);

      convoy.actionPoints = 10_000;
      const route = planPathForUnitIso(battle.state, convoy.id, objective.target);
      expect(route.success).toBe(true);

      const weatherMultiplier = battle.state.weather === 'fog'
        ? 1.2
        : battle.state.weather === 'night' ? 1.1 : 1;
      let earliestCompletionRound = 1;
      let remainingActionPoints = convoy.maxActionPoints;
      for (const coordinate of route.path) {
        const tile = battle.state.map.tiles[
          coordinate.r * battle.state.map.width + coordinate.q
        ];
        const stepCost = tile.movementCostModifier * weatherMultiplier;
        if (stepCost > remainingActionPoints + Number.EPSILON) {
          earliestCompletionRound += 1;
          remainingActionPoints = convoy.maxActionPoints;
        }
        remainingActionPoints -= stepCost;
      }

      expect(route.path.length).toBeGreaterThan(25);
      expect(deadlineRound - earliestCompletionRound).toBeGreaterThanOrEqual(4);
    }
  );

  it.each(SCALED_BRIDGEHEADS)(
    'keeps %s charge-point and elimination routes viable in depth',
    (territoryId, cells, enemyCount) => {
      const { battle } = openBattle(territoryId);
      const chargePoint = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-reach`
      ));
      const elimination = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-eliminate`
      ));
      if (!chargePoint?.target || !elimination) {
        throw new Error(`missing bridgehead objectives for ${territoryId}`);
      }

      const routes = Array.from(battle.state.sides.alliance.units.values())
        .filter((unit) => unit.stance !== 'destroyed' && !unit.embarkedOn)
        .map((unit) => {
          const actionPoints = unit.actionPoints;
          unit.actionPoints = 10_000;
          const route = planPathForUnitIso(battle.state, unit.id, chargePoint.target!);
          unit.actionPoints = actionPoints;
          return route;
        })
        .filter((route) => route.success)
        .sort((left, right) => left.cost - right.cost);

      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(battle.state.sides.otherSide.units.size).toBe(enemyCount);
      expect(routes[0]?.path.length).toBeGreaterThan(25);
      expect(chargePoint.deadlineRound).toBe(
        territoryId === 'sector-sable-causeway' ? 14 : undefined
      );
      expect(elimination.turnLimit).toBeUndefined();
      expect(elimination.deadlineRound).toBeUndefined();

      battle.scenario = {
        ...battle.scenario,
        events: battle.scenario.events?.filter((event) => event.faction !== 'otherSide')
      };
      for (const enemy of battle.state.sides.otherSide.units.values()) {
        enemy.stance = 'destroyed';
        enemy.currentHealth = 0;
      }
      expect(evaluateBattleOutcome(battle)).toBe(
        territoryId === 'sector-sable-causeway' ? 'ongoing' : 'victory'
      );
    }
  );

  it.each(SCALED_HOLD_LINES)(
    'keeps %s central strongpoint and captain protection viable in depth',
    (territoryId, cells, enemyCount) => {
      const { battle } = openBattle(territoryId);
      const hold = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-hold`
      ));
      const protect = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-protect`
      ));
      if (!hold?.target || !protect) {
        throw new Error(`missing hold objectives for ${territoryId}`);
      }

      const routes = Array.from(battle.state.sides.alliance.units.values())
        .filter((unit) => unit.stance !== 'destroyed' && !unit.embarkedOn)
        .map((unit) => {
          const actionPoints = unit.actionPoints;
          unit.actionPoints = 10_000;
          const route = planPathForUnitIso(battle.state, unit.id, hold.target!);
          unit.actionPoints = actionPoints;
          return route;
        })
        .filter((route) => route.success)
        .sort((left, right) => left.cost - right.cost);

      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(battle.state.sides.otherSide.units.size).toBe(enemyCount);
      expect(routes.length).toBeGreaterThanOrEqual(4);
      expect(routes[0]?.path.length).toBeGreaterThan(20);
      expect(hold).toMatchObject({
        kind: 'hold',
        turnLimit: 3
      });
      expect(hold.deadlineRound).toBeUndefined();
      expect(protect).toMatchObject({
        kind: 'protect',
        unitIds: ['captain']
      });
      expect(battle.scenario.objectives.some((objective) => (
        (objective.kind === 'reach' || objective.kind === 'interact')
        && objective.deadlineRound !== undefined
      ))).toBe(false);

      const captainId = battle.deployment.captain;
      const captain = battle.state.sides.alliance.units.get(captainId);
      if (!captain) throw new Error(`captain was not deployed in ${territoryId}`);
      captain.currentHealth = 0;
      captain.stance = 'destroyed';
      expect(evaluateBattleOutcome(battle)).toBe('defeat');
    }
  );

  it.each(SCALED_SIMPLE_ASSAULTS)(
    'keeps %s a deep assault without an instant-loss condition',
    (territoryId, cells, enemyCount) => {
      const { battle } = openBattle(territoryId);
      const hold = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-hold`
      ));
      const eliminate = battle.scenario.objectives.find((candidate) => (
        candidate.id === `${territoryId}-eliminate`
      ));
      if (!hold?.target || !eliminate) {
        throw new Error(`missing assault objectives for ${territoryId}`);
      }

      const routes = Array.from(battle.state.sides.alliance.units.values())
        .filter((unit) => unit.stance !== 'destroyed' && !unit.embarkedOn)
        .map((unit) => {
          const actionPoints = unit.actionPoints;
          unit.actionPoints = 10_000;
          const route = planPathForUnitIso(battle.state, unit.id, hold.target!);
          unit.actionPoints = actionPoints;
          return route;
        })
        .filter((route) => route.success)
        .sort((left, right) => left.cost - right.cost);

      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(battle.state.sides.otherSide.units.size).toBe(enemyCount);
      expect(routes.length).toBeGreaterThanOrEqual(4);
      expect(routes[0]?.path.length).toBeGreaterThan(20);
      expect(battle.scenario.objectives.map((objective) => objective.kind).sort())
        .toEqual(['eliminate', 'hold']);
      expect(hold).toMatchObject({ kind: 'hold', turnLimit: 3 });
      expect(eliminate).toMatchObject({ kind: 'eliminate' });
      expect(battle.scenario.objectives.some((objective) => (
        objective.kind === 'protect'
        || objective.essential
        || objective.deadlineRound !== undefined
        || (
          (objective.kind === 'reach' || objective.kind === 'interact')
          && objective.turnLimit !== undefined
        )
      ))).toBe(false);

      battle.scenario = {
        ...battle.scenario,
        events: battle.scenario.events?.filter((event) => event.faction !== 'otherSide')
      };
      for (const enemy of battle.state.sides.otherSide.units.values()) {
        enemy.stance = 'destroyed';
        enemy.currentHealth = 0;
      }
      expect(evaluateBattleOutcome(battle)).toBe('victory');
    }
  );

  it.each(SCALED_OPERATION_IDS)(
    'executes legal enemy decisions on %s without map-scale stalls',
    (territoryId) => {
      const { battle } = openBattle(territoryId);
      const processor = new TurnProcessor(battle.state, { random: () => 0 });
      processor.endTurn();
      const failedUnitIds = new Set<string>();
      let executedActions = 0;

      for (let decision = 0; decision < 80; decision += 1) {
        const objectiveTargets = battle.scenario.objectives
          .flatMap((objective) => objective.target ? [objective.target] : []);
        const action = decideNextAIAction(battle.state, 'otherSide', {
          objectiveTargets,
          holdTargets: battle.scenario.objectives
            .filter((objective) => objective.kind === 'hold')
            .flatMap((objective) => objective.target ? [objective.target] : []),
          reachTargets: battle.scenario.objectives
            .filter((objective) => objective.kind === 'reach')
            .flatMap((objective) => objective.target ? [objective.target] : []),
          defendBias: true,
          allowDemolition: true,
          difficulty: 'hard',
          excludeUnitIds: failedUnitIds,
          visibleEnemyIds: visibleEnemyIds(battle.state)
        });
        if (action.type === 'endTurn') break;

        const execution = executeAiAction(processor, action);
        expect(execution.success, `${territoryId} rejected ${JSON.stringify(action)}`).toBe(true);
        executedActions += 1;
      }

      expect(executedActions).toBeGreaterThan(0);
    }
  );

  it('keeps every largest scaled operation inside one third of the storage origin', () => {
    const payloads = SCALED_OPERATION_IDS.map((territoryId) => {
      const { state, battle } = openBattle(territoryId);
      return {
        territoryId,
        cells: battle.state.map.tiles.length,
        payloadLength: JSON.stringify(serializeCampaignState(state)).length
      };
    });
    const largestMaps = payloads.filter(({ cells }) => cells === Math.max(
      ...payloads.map((candidate) => candidate.cells)
    ));

    expect(largestMaps).toHaveLength(5);
    expect(largestMaps.every(({ cells }) => cells === 4_200)).toBe(true);
    expect(Math.max(...payloads.map(({ payloadLength }) => payloadLength)))
      .toBeLessThanOrEqual(1_734_351);
  });
});
