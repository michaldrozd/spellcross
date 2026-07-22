import type { ContentBundle, TacticalObjective } from '@spellcross/data';
import { starterBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  checkObjectiveAction,
  createCampaign,
  evaluateBattleOutcome,
  hydrateCampaignState,
  performObjectiveAction,
  processTacticalEvents,
  serializeCampaignState,
  startBattleForTerritory
} from './campaign.js';

const openTerritory = (
  territoryId: string,
  difficulty: 'story' | 'commander' | 'veteran' = 'commander',
  bundle: ContentBundle = starterBundle
) => {
  const state = createCampaign(bundle, undefined, difficulty);
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (!territory) throw new Error(`expected ${territoryId}`);
  territory.status = 'available';
  return state;
};

describe('mission objective actions', () => {
  it('uses stable rejection reasons and spends the exact authored AP once', () => {
    const state = openTerritory('sector-strasbourg');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-strasbourg');
    const objective = battle.scenario.objectives.find((candidate) => candidate.kind === 'interact');
    const ally = Array.from(battle.state.sides.alliance.units.values())[0];
    const enemy = Array.from(battle.state.sides.otherSide.units.values())[0];
    if (!objective?.target || !ally || !enemy) throw new Error('expected interaction combatants');

    expect(checkObjectiveAction(battle, ally.id, 'missing')).toMatchObject({
      success: false,
      errorKey: 'objectiveActionNotFound'
    });
    expect(checkObjectiveAction(battle, ally.id, battle.scenario.objectives[0].id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionInvalid'
    });
    expect(checkObjectiveAction(battle, undefined, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionSelectUnit'
    });
    expect(checkObjectiveAction(battle, enemy.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionWrongFaction'
    });

    battle.state.activeFaction = 'otherSide';
    expect(checkObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionWrongTurn'
    });
    battle.state.activeFaction = 'alliance';

    ally.stance = 'routed';
    expect(checkObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionUnitUnavailable'
    });
    ally.stance = 'ready';

    const alternateRosterId = Object.entries(battle.deployment)
      .find(([, tacticalId]) => tacticalId !== ally.id)?.[0];
    if (!alternateRosterId) throw new Error('expected a second deployed roster unit');
    objective.optional = true;
    objective.unitIds = [alternateRosterId];
    expect(checkObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionUnitRestricted'
    });
    delete objective.unitIds;
    delete objective.optional;

    ally.coordinate = { q: 0, r: 0 };
    expect(checkObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionOutOfRange'
    });

    ally.coordinate = { ...objective.target };
    ally.actionPoints = objective.actionPoints! - 1;
    expect(checkObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionNotEnoughAp'
    });

    ally.actionPoints = 5;
    expect(performObjectiveAction(battle, ally.id, objective.id)).toEqual({ success: true, actionPoints: 2 });
    expect(ally.actionPoints).toBe(3);
    expect(battle.completedObjectiveIds).toEqual([objective.id]);
    expect(battle.state.timeline.at(-1)).toEqual({
      kind: 'objective:completed',
      objectiveId: objective.id,
      unitId: ally.id,
      actionKey: 'plantCharges'
    });
    expect(evaluateBattleOutcome(battle)).toBe('victory');

    expect(performObjectiveAction(battle, ally.id, objective.id)).toMatchObject({
      success: false,
      errorKey: 'objectiveActionCompleted'
    });
    expect(ally.actionPoints).toBe(3);
    expect(battle.state.timeline.filter((event) => event.kind === 'objective:completed')).toHaveLength(1);
  });

  it('does not let optional specialist actions block victory when their unit is dead or never deployed', () => {
    const bundle = structuredClone(starterBundle);
    const state = openTerritory('sector-rift', 'commander', bundle);
    const battle = startBattleForTerritory(state, bundle, 'sector-rift');
    const captainId = battle.deployment.captain;
    const deadEntry = Object.entries(battle.deployment).find(([rosterId]) => rosterId !== 'captain');
    const deadUnit = deadEntry ? battle.state.sides.alliance.units.get(deadEntry[1]) : undefined;
    if (!captainId || !deadEntry || !deadUnit) throw new Error('expected deployed campaign units');
    deadUnit.stance = 'destroyed';
    deadUnit.currentHealth = 0;

    battle.scenario.objectives = [
      { id: 'keep-captain', kind: 'protect', description: 'Keep the captain alive.', unitIds: ['captain'] },
      {
        id: 'dead-specialist',
        kind: 'interact',
        description: 'Optional specialist action.',
        target: { q: 2, r: 2 },
        unitIds: [deadEntry[0]],
        optional: true,
        actionKey: 'disruptWard',
        actionPoints: 2
      },
      {
        id: 'absent-specialist',
        kind: 'interact',
        description: 'Optional reserve action.',
        target: { q: 3, r: 2 },
        unitIds: ['never-deployed'],
        optional: true,
        actionKey: 'disruptWard',
        actionPoints: 2
      }
    ];
    battle.scenario.events = [];

    expect(checkObjectiveAction(battle, deadUnit.id, 'dead-specialist')).toMatchObject({
      success: false,
      errorKey: 'objectiveActionUnitUnavailable'
    });
    expect(evaluateBattleOutcome(battle)).toBe('victory');
  });

  it.each(['story', 'commander', 'veteran'] as const)(
    'delivers the complete authored Alliance reward on %s difficulty and never repeats it',
    (difficulty) => {
      const state = openTerritory('sector-rift', difficulty);
      const battle = startBattleForTerritory(state, starterBundle, 'sector-rift');
      const objective = battle.scenario.objectives.find((candidate) => candidate.id === 'sector-rift-disrupt-ward');
      const reward = battle.scenario.events?.find((event) => event.triggerObjectiveId === objective?.id);
      const [actor, blocker] = Array.from(battle.state.sides.alliance.units.values());
      if (!objective?.target || !reward || !actor || !blocker) throw new Error('expected Rift ward action');

      expect(processTacticalEvents(state, starterBundle)).toEqual([]);
      actor.coordinate = { ...objective.target };
      actor.actionPoints = 4;
      blocker.coordinate = { ...reward.reinforcements[0].coordinate };
      const allianceBefore = battle.state.sides.alliance.units.size;

      expect(performObjectiveAction(battle, actor.id, objective.id).success).toBe(true);
      const arrivals = processTacticalEvents(state, starterBundle);
      expect(arrivals).toHaveLength(1);
      expect(arrivals[0]?.messageKey).toBe('wardBeaconSecured');
      expect(arrivals[0]?.units).toHaveLength(reward.reinforcements.length);
      expect(arrivals[0]?.units[0]?.coordinate).not.toEqual(reward.reinforcements[0].coordinate);
      expect(battle.state.sides.alliance.units.size - allianceBefore).toBe(reward.reinforcements.length);
      expect(processTacticalEvents(state, starterBundle)).toEqual([]);
    }
  );

  it('defers dependent objective rewards until the following event pass', () => {
    const bundle = structuredClone(starterBundle);
    const state = openTerritory('sector-rift', 'commander', bundle);
    const battle = startBattleForTerritory(state, bundle, 'sector-rift');
    const objective = battle.scenario.objectives.find((candidate) => candidate.id === 'sector-rift-disrupt-ward');
    const reward = battle.scenario.events?.find((event) => event.triggerObjectiveId === objective?.id);
    const actor = Array.from(battle.state.sides.alliance.units.values())[0];
    if (!objective?.target || !reward || !actor) throw new Error('expected Rift ward action');
    battle.scenario.events = [reward, {
      id: 'ward-follow-up',
      triggerObjectiveId: objective.id,
      triggerAfterEventId: reward.id,
      messageKey: 'wardBeaconSecured',
      faction: 'alliance',
      reinforcements: [{ id: 'follow-up-rangers', definitionId: 'rangers', coordinate: { q: 1, r: 1 } }]
    }];
    actor.coordinate = { ...objective.target };
    actor.actionPoints = 4;
    performObjectiveAction(battle, actor.id, objective.id);

    expect(processTacticalEvents(state, bundle).map((event) => event.id)).toEqual([reward.id]);
    expect(processTacticalEvents(state, bundle).map((event) => event.id)).toEqual(['ward-follow-up']);
    expect(processTacticalEvents(state, bundle)).toEqual([]);
  });

  it('round-trips completed actions and fired events without duplicating either', () => {
    const state = openTerritory('sector-rift');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-rift');
    const objective = battle.scenario.objectives.find((candidate) => candidate.id === 'sector-rift-disrupt-ward');
    const actor = Array.from(battle.state.sides.alliance.units.values())[0];
    if (!objective?.target || !actor) throw new Error('expected Rift ward action');
    actor.coordinate = { ...objective.target };
    actor.actionPoints = 4;
    performObjectiveAction(battle, actor.id, objective.id);
    processTacticalEvents(state, starterBundle);

    const restored = hydrateCampaignState(
      starterBundle,
      JSON.parse(JSON.stringify(serializeCampaignState(state)))
    );
    const restoredBattle = restored.activeBattle;
    if (!restoredBattle) throw new Error('expected restored battle');
    expect(restoredBattle.completedObjectiveIds).toEqual([objective.id]);
    expect(restoredBattle.triggeredEventIds).toContain('sector-rift-ward-corridor-reserve');
    expect(restoredBattle.state.timeline.filter((event) => event.kind === 'objective:completed')).toHaveLength(1);
    expect(processTacticalEvents(restored, starterBundle)).toEqual([]);
  });

  it('preserves a snapshotted legacy reach objective while new bridgeheads use actions', () => {
    const legacyState = openTerritory('sector-strasbourg', 'story');
    startBattleForTerritory(legacyState, starterBundle, 'sector-strasbourg');
    const snapshot = serializeCampaignState(legacyState);
    const encodedBattle = snapshot.activeBattle as {
      scenario: { objectives: TacticalObjective[] };
      completedObjectiveIds?: string[];
    };
    const legacyObjective = encodedBattle.scenario.objectives.find((candidate) => candidate.kind === 'interact');
    if (!legacyObjective) throw new Error('expected encoded bridge objective');
    legacyObjective.kind = 'reach';
    delete legacyObjective.actionKey;
    delete legacyObjective.actionPoints;
    delete encodedBattle.completedObjectiveIds;

    const restored = hydrateCampaignState(starterBundle, snapshot);
    const restoredBattle = restored.activeBattle;
    const restoredObjective = restoredBattle?.scenario.objectives.find((candidate) => candidate.id === legacyObjective.id);
    const actor = restoredBattle ? Array.from(restoredBattle.state.sides.alliance.units.values())[0] : undefined;
    if (!restoredBattle || !restoredObjective?.target || !actor) throw new Error('expected restored legacy battle');
    expect(restoredObjective.kind).toBe('reach');
    expect(restoredBattle.completedObjectiveIds).toEqual([]);
    actor.coordinate = { ...restoredObjective.target };
    expect(evaluateBattleOutcome(restoredBattle)).toBe('victory');

    const freshState = openTerritory('sector-strasbourg', 'story');
    const freshBattle = startBattleForTerritory(freshState, starterBundle, 'sector-strasbourg');
    expect(freshBattle.scenario.objectives.find((candidate) => candidate.id === legacyObjective.id)).toMatchObject({
      kind: 'interact',
      actionKey: 'plantCharges',
      actionPoints: 2
    });
  });

  it('pins a named optional-action specialist into an overflowing deployment zone', () => {
    const bundle = structuredClone(starterBundle);
    const riftScenario = bundle.scenarios.find((scenario) => scenario.id === 'city-sector-rift');
    const ward = riftScenario?.objectives.find((objective) => objective.id === 'sector-rift-disrupt-ward');
    if (!ward) throw new Error('expected Rift ward objective');
    ward.unitIds = ['captain'];

    const state = createCampaign(bundle);
    const rift = state.territories.find((territory) => territory.id === 'sector-rift');
    if (!rift) throw new Error('expected Rift territory');
    rift.status = 'available';
    for (let index = 0; index < 30; index += 1) {
      state.army.push({ id: `transport-${index}`, definitionId: 'm113', tier: 'rookie', experience: 0 });
    }

    const battle = startBattleForTerritory(state, bundle, 'sector-rift');
    expect(battle.deployment.captain).toBeDefined();
  });
});
