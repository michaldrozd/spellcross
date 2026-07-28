import { describe, expect, it } from 'vitest';

import {
  createCampaign,
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
  ['sector-ash-compass', 3_200, 18]
] as const;

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

describe('scaled convoy battlefields', () => {
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

  it.each(SCALED_CONVOYS)(
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

  it('keeps the densest scaled operation inside one third of the storage origin', () => {
    const { state, battle } = openBattle('sector-ash-compass');
    const payloadLength = JSON.stringify(serializeCampaignState(state)).length;

    expect(battle.state.map.tiles).toHaveLength(3_200);
    expect(payloadLength).toBeLessThanOrEqual(1_734_351);
  });
});
