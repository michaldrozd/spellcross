import { starterBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  createCampaign,
  endStrategicTurn,
  getOperationDeploymentPlan,
  getRearmLockReason,
  getUnitRearmOptions,
  hydrateCampaignState,
  pauseResearch,
  projectUnitService,
  rearmUnit,
  refillUnit,
  serializeCampaignState,
  setUnitFormation,
  startBattleForTerritory,
  startResearch
} from './campaign.js';

describe('strategic HQ depth', () => {
  it('deploys the selected roster exactly and protects mission-critical units', () => {
    const state = createCampaign(starterBundle);
    const plan = getOperationDeploymentPlan(state, starterBundle, 'sector-paris');

    expect(plan.capacity).toBeGreaterThanOrEqual(2);
    expect(plan.availableUnitIds).toEqual(state.army.map((unit) => unit.id));
    expect(plan.requiredUnitIds).toContain('captain');
    expect(() => startBattleForTerritory(state, starterBundle, 'sector-paris', ['lance-1']))
      .toThrow(/mission-critical unit/i);

    const selectedUnitIds = ['captain', 'lance-1'];
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris', selectedUnitIds);
    expect(Object.keys(battle.deployment)).toEqual(selectedUnitIds);
  });

  it('rejects empty, duplicate, unavailable, and over-capacity deployment selections', () => {
    const makeState = () => createCampaign(starterBundle);
    expect(() => startBattleForTerritory(makeState(), starterBundle, 'sector-paris', []))
      .toThrow(/No deployable units/i);
    expect(() => startBattleForTerritory(makeState(), starterBundle, 'sector-paris', ['captain', 'captain']))
      .toThrow(/selected once/i);

    const unavailable = makeState();
    unavailable.army.find((unit) => unit.id === 'lance-1')!.availableOnTurn = unavailable.turn + 1;
    expect(() => startBattleForTerritory(unavailable, starterBundle, 'sector-paris', ['captain', 'lance-1']))
      .toThrow(/not ready/i);

    const crowded = makeState();
    const capacity = getOperationDeploymentPlan(crowded, starterBundle, 'sector-paris').capacity;
    while (crowded.army.length <= capacity) {
      crowded.army.push({
        ...structuredClone(crowded.army[1]),
        id: `extra-${crowded.army.length}`
      });
    }
    expect(() => startBattleForTerritory(
      crowded,
      starterBundle,
      'sector-paris',
      crowded.army.slice(0, capacity + 1).map((unit) => unit.id)
    )).toThrow(/exceeds deployment capacity/i);
  });

  it('marks an optional objective specialist without making that unit mandatory', () => {
    const bundle = structuredClone(starterBundle);
    const territory = bundle.campaigns[0].territories.find((candidate) => candidate.id === 'sector-rift')!;
    territory.requires = [];
    const scenario = bundle.scenarios.find((candidate) => candidate.id === territory.scenarioId)!;
    const optionalInteraction = scenario.objectives.find((objective) => objective.optional && objective.kind === 'interact')!;
    optionalInteraction.unitIds = ['recon-1'];
    const state = createCampaign(bundle);
    const plan = getOperationDeploymentPlan(state, bundle, territory.id);

    expect(plan.specialistUnitIds).toEqual(['recon-1']);
    expect(plan.requiredUnitIds).not.toContain('recon-1');
    expect(() => startBattleForTerritory(state, bundle, territory.id, ['captain', 'lance-1'])).not.toThrow();
  });

  it('assigns formation membership exclusively and restores normalized legacy formations', () => {
    const state = createCampaign(starterBundle);
    expect(state.formations.map((formation) => formation.id)).toEqual(['alpha', 'bravo', 'charlie']);

    setUnitFormation(state, 'lance-1', 'bravo');
    expect(state.formations.find((formation) => formation.id === 'alpha')?.units).not.toContain('lance-1');
    expect(state.formations.find((formation) => formation.id === 'bravo')?.units).toContain('lance-1');

    const snapshot = serializeCampaignState(state);
    snapshot.formations = [
      { ...structuredClone(state.formations[0]), units: ['captain', 'missing-unit'] },
      { ...structuredClone(state.formations[1]), units: ['captain', 'lance-1'] }
    ];
    const restored = hydrateCampaignState(starterBundle, snapshot);
    expect(restored.formations.find((formation) => formation.id === 'alpha')?.units).toEqual(['captain']);
    expect(restored.formations.find((formation) => formation.id === 'bravo')?.units).toEqual(['lance-1']);
    expect(restored.formations.find((formation) => formation.id === 'charlie')).toBeDefined();

    const legacySnapshot = serializeCampaignState(createCampaign(starterBundle));
    delete legacySnapshot.formations;
    const legacy = hydrateCampaignState(starterBundle, legacySnapshot);
    expect(legacy.formations[0].units).toEqual(legacy.army.map((unit) => unit.id));
  });

  it('removes formation bonuses from the next deployment when a unit is unassigned', () => {
    const grouped = createCampaign(starterBundle);
    const ungrouped = createCampaign(starterBundle);
    setUnitFormation(ungrouped, 'captain');

    const groupedBattle = startBattleForTerritory(grouped, starterBundle, 'sector-paris', ['captain']);
    const ungroupedBattle = startBattleForTerritory(ungrouped, starterBundle, 'sector-paris', ['captain']);
    const groupedCaptain = groupedBattle.state.sides.alliance.units.get(groupedBattle.deployment.captain)!;
    const ungroupedCaptain = ungroupedBattle.state.sides.alliance.units.get(ungroupedBattle.deployment.captain)!;

    expect(groupedCaptain.stats.armor - ungroupedCaptain.stats.armor).toBe(1);
    expect(groupedCaptain.stats.morale - ungroupedCaptain.stats.morale).toBe(3);
    for (const weaponId of Object.keys(groupedCaptain.stats.weaponPower)) {
      expect(groupedCaptain.stats.weaponPower[weaponId] - ungroupedCaptain.stats.weaponPower[weaponId]).toBe(1);
    }
  });

  it('uses exact refill quotes and never charges a full-strength or unaffordable unit', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    unit.currentHealth = 1;
    state.resources.money = 10_000;

    for (const quality of ['rookie', 'veteran', 'elite'] as const) {
      unit.currentHealth = 1;
      unit.experience = 60;
      unit.tier = 'elite';
      const quote = projectUnitService(state, starterBundle, unit.id, { kind: 'refill', quality });
      const moneyBefore = state.resources.money;
      refillUnit(state, starterBundle, unit.id, quality);
      expect(moneyBefore - state.resources.money).toBe(quote.cost);
      expect(unit.experience).toBe(quote.experienceAfter);
      expect(unit.tier).toBe(quote.tierAfter);
    }

    const moneyAtFullStrength = state.resources.money;
    expect(() => refillUnit(state, starterBundle, unit.id, 'rookie')).toThrow(/full strength/i);
    expect(state.resources.money).toBe(moneyAtFullStrength);

    unit.currentHealth = 1;
    state.resources.money = 0;
    expect(() => refillUnit(state, starterBundle, unit.id, 'elite')).toThrow(/Not enough money/i);
    expect(state.resources.money).toBe(0);
    expect(unit.currentHealth).toBe(1);
  });

  it('enforces same-category rearm and executes the projected quote', () => {
    const state = createCampaign(starterBundle);
    const unit = state.army.find((candidate) => candidate.id === 'lance-1')!;
    state.resources.money = 10_000;
    unit.experience = 60;
    unit.tier = 'elite';
    const quote = projectUnitService(state, starterBundle, unit.id, { kind: 'rearm', definitionId: 'rangers' });
    const moneyBefore = state.resources.money;

    rearmUnit(state, starterBundle, unit.id, 'rangers');
    expect(unit.definitionId).toBe('rangers');
    expect(unit.experience).toBe(quote.experienceAfter);
    expect(unit.tier).toBe(quote.tierAfter);
    expect(moneyBefore - state.resources.money).toBe(quote.cost);

    const moneyBeforeRejectedRearm = state.resources.money;
    expect(() => rearmUnit(state, starterBundle, unit.id, 'm113')).toThrow(/combat category/i);
    expect(unit.definitionId).toBe('rangers');
    expect(state.resources.money).toBe(moneyBeforeRejectedRearm);
  });

  it('defines rearm availability over the full unit catalogue', () => {
    const state = createCampaign(starterBundle);
    for (const definition of starterBundle.units.filter((candidate) => candidate.faction === 'alliance')) {
      state.research.known.add(definition.id);
    }

    expect(starterBundle.units.length).toBeGreaterThanOrEqual(80);
    for (const definition of starterBundle.units) {
      const lockReason = getRearmLockReason(starterBundle, definition.id);
      if (definition.faction !== 'alliance') {
        expect(lockReason, definition.id).toBe('nonAlliance');
        continue;
      }
      if (definition.type === 'hero') {
        expect(lockReason, definition.id).toBe('uniqueUnit');
        continue;
      }
      const testUnit = { ...structuredClone(state.army[1]), id: `test-${definition.id}`, definitionId: definition.id };
      state.army.push(testUnit);
      expect(lockReason, definition.id).toBeUndefined();
      expect(getUnitRearmOptions(state, starterBundle, testUnit.id).length, definition.id).toBeGreaterThan(0);
      state.army.pop();
    }
  });

  it('pauses, switches, serializes, and resumes research at the exact remaining cost', () => {
    const state = createCampaign(starterBundle);
    startResearch(state, starterBundle, 'armor-upfit');
    state.resources.research = 13;
    endStrategicTurn(state, starterBundle);
    expect(state.research.inProgress).toEqual({ topicId: 'armor-upfit', remaining: 67 });
    pauseResearch(state, starterBundle);
    expect(state.research.paused['armor-upfit']).toBe(67);

    startResearch(state, starterBundle, 'esprit-de-corps');
    pauseResearch(state, starterBundle);
    const restored = hydrateCampaignState(starterBundle, serializeCampaignState(state));
    startResearch(restored, starterBundle, 'armor-upfit');
    expect(restored.research.inProgress).toEqual({ topicId: 'armor-upfit', remaining: 67 });
    expect(restored.research.paused['armor-upfit']).toBeUndefined();
    expect(restored.research.paused['esprit-de-corps']).toBe(50);
  });

  it('applies research progress once per turn across rapid pause and resume switches', () => {
    const state = createCampaign(starterBundle);
    state.resources.research = 20;
    startResearch(state, starterBundle, 'armor-upfit');
    pauseResearch(state, starterBundle);
    startResearch(state, starterBundle, 'armor-upfit');
    pauseResearch(state, starterBundle);
    startResearch(state, starterBundle, 'esprit-de-corps');
    expect(state.research.inProgress?.topicId).toBe('esprit-de-corps');
    expect(() => startResearch(state, starterBundle, 'armor-upfit')).toThrow(/already in progress/i);
    pauseResearch(state, starterBundle);
    startResearch(state, starterBundle, 'armor-upfit');

    endStrategicTurn(state, starterBundle);
    expect(state.research.inProgress).toEqual({ topicId: 'armor-upfit', remaining: 60 });
    expect(state.research.paused['esprit-de-corps']).toBe(50);
  });

  it('restores exact paused progress after another project completes', () => {
    const state = createCampaign(starterBundle);
    startResearch(state, starterBundle, 'armor-upfit');
    state.research.inProgress!.remaining = 37;
    pauseResearch(state, starterBundle);
    startResearch(state, starterBundle, 'esprit-de-corps');
    state.resources.research = 50;
    endStrategicTurn(state, starterBundle);
    expect(state.research.completed.has('esprit-de-corps')).toBe(true);

    startResearch(state, starterBundle, 'armor-upfit');
    expect(state.research.inProgress).toEqual({ topicId: 'armor-upfit', remaining: 37 });
  });

  it('cleans stale research from forged old saves without blocking the slot', () => {
    const snapshot = serializeCampaignState(createCampaign(starterBundle));
    snapshot.research.paused = { removed: 12, 'armor-upfit': 999 };
    snapshot.research.inProgress = { topicId: 'also-removed', remaining: 10 };
    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.research.inProgress).toBeUndefined();
    expect(restored.research.paused).toEqual({ 'armor-upfit': 80 });
    expect(() => startResearch(restored, starterBundle, 'esprit-de-corps')).not.toThrow();
  });
});
