import { starterBundle, type ContentBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  checkObjectiveAction,
  createCampaign,
  evaluateBattleOutcome,
  getOperationDeploymentPlan,
  hydrateCampaignState,
  performObjectiveAction,
  processTacticalEvents,
  serializeCampaignState,
  startBattleForTerritory,
  type ActiveBattle,
  type CampaignDifficulty,
  type CampaignState
} from './campaign.js';
import { planPathForUnitIso } from '../simulation/pathfinding/iso-pathfinder.js';
import { isoDistance } from '../simulation/utils/grid-iso.js';

function openBattle(
  territoryId: string,
  difficulty: CampaignDifficulty = 'commander',
  bundle: ContentBundle = structuredClone(starterBundle)
): { state: CampaignState; battle: ActiveBattle; bundle: ContentBundle } {
  const state = createCampaign(bundle, undefined, difficulty);
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (!territory) throw new Error(`missing territory ${territoryId}`);
  territory.status = 'available';
  const selected = state.army.find((unit) => (unit.availableOnTurn ?? 0) <= state.turn);
  if (!selected) throw new Error('expected a ready roster unit');
  const battle = startBattleForTerritory(state, bundle, territoryId, [selected.id]);
  battle.deployed = true;
  return { state, battle, bundle };
}

function essentialObjective(battle: ActiveBattle) {
  const objective = battle.scenario.objectives.find((candidate) => candidate.essential);
  if (!objective?.target || !objective.unitIds?.[0]) throw new Error('expected essential specialist objective');
  return objective;
}

function specialistFor(battle: ActiveBattle) {
  const objective = essentialObjective(battle);
  const specialist = battle.state.sides.alliance.units.get(battle.deployment[objective.unitIds![0]]);
  if (!specialist) throw new Error('expected attached specialist');
  return specialist;
}

describe('specialist deadline objectives', () => {
  it('discloses attached specialists, rejects an empty roster, and always deploys support beside the selected force', () => {
    const state = createCampaign(starterBundle);
    const territory = state.territories.find((candidate) => candidate.id === 'sector-sable-causeway');
    if (!territory) throw new Error('missing Sable Causeway');
    territory.status = 'available';
    const plan = getOperationDeploymentPlan(state, starterBundle, territory.id);
    const selected = state.army.find((unit) => plan.availableUnitIds.includes(unit.id));
    if (!selected) throw new Error('expected a ready roster unit');

    expect(plan.canDeployWithoutRoster).toBe(false);
    expect(plan.missionSupport).toContainEqual({
      id: 'sector-sable-causeway-wardbreaker',
      definitionId: 'commando-team',
      specialist: true
    });
    expect(() => startBattleForTerritory(state, starterBundle, territory.id, [])).toThrow(/No deployable units/);

    const battle = startBattleForTerritory(state, starterBundle, territory.id, [selected.id]);
    expect(battle.deployment['sector-sable-causeway-wardbreaker']).toBeDefined();
    expect(battle.state.sides.alliance.units.get(
      battle.deployment['sector-sable-causeway-wardbreaker']
    )?.definitionId).toBe('commando-team');
  });

  it('requires the named specialist and prevents an enemy wipe from bypassing the critical action', () => {
    const { state, battle, bundle } = openBattle('sector-sable-causeway', 'story');
    const objective = essentialObjective(battle);
    const specialist = specialistFor(battle);
    const regular = Array.from(battle.state.sides.alliance.units.values())
      .find((unit) => unit.id !== specialist.id);
    if (!regular) throw new Error('expected a regular squad');
    specialist.coordinate = { ...objective.target! };
    regular.coordinate = { ...objective.target! };

    expect(checkObjectiveAction(battle, regular.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionUnitRestricted'
    });

    for (const enemy of battle.state.sides.otherSide.units.values()) {
      enemy.stance = 'destroyed';
      enemy.currentHealth = 0;
    }
    expect(evaluateBattleOutcome(battle)).toBe('ongoing');

    expect(performObjectiveAction(battle, specialist.id, objective.id).success).toBe(true);
    const transformed = battle.scenario.events?.find((event) => (
      event.triggerObjectiveId === objective.id
      && event.effects?.some((effect) => effect.kind === 'transformTerrain')
    ));
    const terrainEffect = transformed?.effects?.find((effect) => effect.kind === 'transformTerrain');
    if (!terrainEffect || terrainEffect.kind !== 'transformTerrain') {
      throw new Error('expected objective-triggered terrain effect');
    }
    const changed = terrainEffect.tiles[0];
    const before = battle.state.map.tiles[changed.coordinate.r * battle.state.map.width + changed.coordinate.q];
    expect(before.terrain).not.toBe(changed.tile.terrain);

    const triggered = processTacticalEvents(state, bundle);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.effects.map((effect) => effect.kind)).toEqual(['transformTerrain']);
    expect(evaluateBattleOutcome(battle)).toBe('victory');

    const restored = hydrateCampaignState(
      bundle,
      JSON.parse(JSON.stringify(serializeCampaignState(state)))
    );
    const restoredBattle = restored.activeBattle;
    if (!restoredBattle) throw new Error('expected restored battle');
    expect(restoredBattle.state.map.tiles[
      changed.coordinate.r * restoredBattle.state.map.width + changed.coordinate.q
    ]).toMatchObject(changed.tile);
    expect(processTacticalEvents(restored, bundle)).toEqual([]);
  });

  it('allows the specialist action through its deadline and rejects it one round later', () => {
    const onTime = openBattle('sector-mnemonic-orchard');
    const onTimeObjective = essentialObjective(onTime.battle);
    const onTimeSpecialist = specialistFor(onTime.battle);
    onTimeSpecialist.coordinate = { ...onTimeObjective.target! };
    onTimeSpecialist.actionPoints = onTimeSpecialist.maxActionPoints;
    onTime.battle.state.round = onTimeObjective.deadlineRound!;
    expect(performObjectiveAction(onTime.battle, onTimeSpecialist.id, onTimeObjective.id).success).toBe(true);

    const late = openBattle('sector-mnemonic-orchard');
    const lateObjective = essentialObjective(late.battle);
    const lateSpecialist = specialistFor(late.battle);
    lateSpecialist.coordinate = { ...lateObjective.target! };
    lateSpecialist.actionPoints = lateSpecialist.maxActionPoints;
    late.battle.state.round = lateObjective.deadlineRound! + 1;
    for (const enemy of late.battle.state.sides.otherSide.units.values()) {
      enemy.stance = 'destroyed';
      enemy.currentHealth = 0;
    }

    expect(checkObjectiveAction(late.battle, lateSpecialist.id, lateObjective.id)).toEqual({
      success: false,
      errorKey: 'objectiveActionDeadlineExpired'
    });
    expect(evaluateBattleOutcome(late.battle)).toBe('defeat');
  });

  it('keeps every Veteran specialist route inside its deadline with measured movement margin', () => {
    const margins = [
      'sector-lantern-vault',
      'sector-sable-causeway',
      'sector-mnemonic-orchard'
    ].map((territoryId) => {
      const { battle } = openBattle(territoryId, 'veteran');
      const objective = essentialObjective(battle);
      const specialist = specialistFor(battle);
      specialist.actionPoints = 10_000;
      const routes = battle.state.map.tiles.flatMap((_tile, index) => {
        const coordinate = {
          q: index % battle.state.map.width,
          r: Math.floor(index / battle.state.map.width)
        };
        if (isoDistance(coordinate, objective.target!) > 1) return [];
        const route = planPathForUnitIso(battle.state, specialist.id, coordinate);
        return route.success ? [{ coordinate, route }] : [];
      }).sort((left, right) => (
        left.route.cost - right.route.cost
        || left.route.path.length - right.route.path.length
      ));
      const shortest = routes[0];
      if (!shortest) throw new Error(`expected a reachable action tile in ${territoryId}`);

      const weatherMultiplier = battle.state.weather === 'fog'
        ? 1.2
        : battle.state.weather === 'night' ? 1.1 : 1;
      let earliestCompletionRound = 1;
      let remainingAp = specialist.maxActionPoints;
      for (const step of shortest.route.path) {
        const tile = battle.state.map.tiles[step.r * battle.state.map.width + step.q];
        const stepCost = tile.movementCostModifier * weatherMultiplier;
        if (stepCost > remainingAp + Number.EPSILON) {
          earliestCompletionRound += 1;
          remainingAp = specialist.maxActionPoints;
        }
        remainingAp -= stepCost;
      }
      if (objective.actionPoints! > remainingAp + Number.EPSILON) {
        earliestCompletionRound += 1;
      }

      return {
        territoryId,
        pathSteps: shortest.route.path.length,
        pathCost: Number(shortest.route.cost.toFixed(2)),
        earliestCompletionRound,
        deadlineRound: objective.deadlineRound,
        marginRounds: objective.deadlineRound! - earliestCompletionRound
      };
    });

    expect(margins).toEqual([
      {
        territoryId: 'sector-lantern-vault',
        pathSteps: 5,
        pathCost: 4.4,
        earliestCompletionRound: 1,
        deadlineRound: 7,
        marginRounds: 6
      },
      {
        territoryId: 'sector-sable-causeway',
        pathSteps: 22,
        pathCost: 16,
        earliestCompletionRound: 3,
        deadlineRound: 10,
        marginRounds: 7
      },
      {
        territoryId: 'sector-mnemonic-orchard',
        pathSteps: 9,
        pathCost: 9.9,
        earliestCompletionRound: 3,
        deadlineRound: 9,
        marginRounds: 6
      }
    ]);
  });

  it.each([
    'sector-lantern-vault',
    'sector-sable-causeway',
    'sector-mnemonic-orchard'
  ])('fails %s immediately when its attached specialist is lost', (territoryId) => {
    const { battle } = openBattle(territoryId);
    const specialist = specialistFor(battle);
    specialist.stance = 'destroyed';
    specialist.currentHealth = 0;

    expect(evaluateBattleOutcome(battle)).toBe('defeat');
    expect(battle.scenario.objectives.some((objective) => (
      objective.kind === 'protect'
      && objective.unitIds?.some((unitId) => battle.deployment[unitId] === specialist.id)
    ))).toBe(true);
  });
});
