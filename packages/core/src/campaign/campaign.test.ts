import { starterBundle } from '@spellcross/data';
import type { ContentBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  applyBattleOutcome,
  CAMPAIGN_DIFFICULTY_RULES,
  convertStrategicToMoney,
  convertStrategicToResearch,
  createCampaign,
  dismissUnit,
  endStrategicTurn,
  evaluateBattleOutcome,
  getBattleRetreatForecast,
  getEnemyActionBudget,
  getEnemyDecisionBudget,
  getEnemyDifficultyTier,
  minimumExperienceForTier,
  pauseResearch,
  progressResearch,
  projectUnitService,
  recruitUnit,
  rearmUnit,
  refillUnit,
  retreatFromBattle,
  serializeCampaignState,
  startResearch,
  startBattleForTerritory,
  hydrateCampaignState,
  isUnitUnlocked,
  unitTierForExperience,
  processTacticalEvents
} from './campaign.js';
import type { CampaignDifficulty } from './campaign.js';
import { TurnProcessor } from '../simulation/systems/turn-processor.js';

const definitionsReachableInCampaign = (
  bundle: typeof starterBundle,
  difficulty: CampaignDifficulty
) => {
  const campaign = bundle.campaigns[0];
  const reachableResearchIds = new Set(campaign.startingResearch);
  for (let discovered = true; discovered;) {
    discovered = false;
    for (const topic of bundle.research) {
      if (reachableResearchIds.has(topic.id)) continue;
      if (!(topic.requires ?? []).every((requirement) => reachableResearchIds.has(requirement))) continue;
      reachableResearchIds.add(topic.id);
      discovered = true;
    }
  }

  const alliance = new Set([
    ...campaign.startingUnits.map((unit) => unit.definitionId),
    ...bundle.research
      .filter((topic) => reachableResearchIds.has(topic.id))
      .flatMap((topic) => topic.unlocks)
  ]);
  const hostile = new Set<string>();

  // Launch every territory through the campaign engine so hostile events are truncated by the
  // selected difficulty exactly as they are for players. Demo and QA scenarios are never launched.
  for (const territory of campaign.territories) {
    const state = createCampaign(bundle, undefined, difficulty);
    const campaignTerritory = state.territories.find((candidate) => candidate.id === territory.id);
    if (!campaignTerritory) throw new Error(`expected campaign territory ${territory.id}`);
    campaignTerritory.status = 'available';
    const battle = startBattleForTerritory(state, bundle, territory.id);
    battle.state.round = Number.MAX_SAFE_INTEGER;

    for (const unit of battle.state.sides.otherSide.units.values()) {
      hostile.add(unit.definitionId);
    }
    for (let pass = 0; pass <= (battle.scenario.events?.length ?? 0); pass += 1) {
      // Empty the map before each wave so spawn crowding cannot masquerade as difficulty truncation.
      for (const unit of battle.state.sides.otherSide.units.values()) {
        unit.stance = 'destroyed';
        unit.currentHealth = 0;
      }
      processTacticalEvents(state, bundle);
      for (const unit of battle.state.sides.otherSide.units.values()) {
        hostile.add(unit.definitionId);
      }
    }
  }

  return { alliance, hostile };
};

const makeOutcomeRouteBundle = (): ContentBundle => {
  const bundle = structuredClone(starterBundle);
  const campaign = bundle.campaigns[0];
  const source = campaign.territories.find((territory) => territory.id === 'sector-paris');
  const victory = campaign.territories.find((territory) => territory.id === 'sector-lyon');
  const defeat = campaign.territories.find((territory) => territory.id === 'sector-brussels');
  if (!source || !victory || !defeat) throw new Error('expected route test territories');

  source.requires = undefined;
  victory.requires = undefined;
  victory.route = { territoryId: source.id, result: 'victory' };
  defeat.requires = undefined;
  defeat.route = { territoryId: source.id, result: 'defeat' };
  campaign.territories = [source, victory, defeat];
  campaign.actTimeBonuses = undefined;
  return bundle;
};

const makeTimedOutcomeRouteBundle = (): ContentBundle => {
  const bundle = makeOutcomeRouteBundle();
  const campaign = bundle.campaigns[0];
  for (const territory of campaign.territories.filter((candidate) => candidate.route)) {
    territory.act = 2;
  }
  campaign.actTimeBonuses = [{
    act: 2,
    turns: { story: 2, commander: 2, veteran: 2 }
  }];
  return bundle;
};

describe('campaign core', () => {
  it('creates a starter campaign with available territories and formations', () => {
    const state = createCampaign(starterBundle);
    expect(state.difficulty).toBe('commander');
    expect(state.territories.length).toBeGreaterThan(0);
    expect(state.territories[0].status).toBe('available');
    expect(state.formations[0]?.units.length).toBe(state.army.length);
  });

  it('applies campaign difficulty to starting time and resources', () => {
    const story = createCampaign(starterBundle, undefined, 'story');
    const commander = createCampaign(starterBundle, undefined, 'commander');
    const veteran = createCampaign(starterBundle, undefined, 'veteran');

    expect(story.globalTimer).toBeGreaterThan(commander.globalTimer);
    expect(veteran.globalTimer).toBeLessThan(commander.globalTimer);
    expect(story.resources.money).toBeGreaterThan(commander.resources.money);
    expect(veteran.resources.money).toBeLessThan(commander.resources.money);
  });

  it('scales enemy decision quality and action economy with campaign difficulty', () => {
    expect(getEnemyDifficultyTier('story', 2)).toBe('easy');
    expect(getEnemyDifficultyTier('commander', 2)).toBe('normal');
    expect(getEnemyDifficultyTier('veteran', 2)).toBe('hard');
    expect(getEnemyDifficultyTier('veteran', 4)).toBe('brutal');

    expect(getEnemyActionBudget('story', 10)).toBe(4);
    expect(getEnemyActionBudget('commander', 10)).toBe(13);
    expect(getEnemyActionBudget('veteran', 10)).toBe(18);
  });

  it('leaves enough enemy decisions to spend a large Veteran attack budget', () => {
    const activeEnemies = 20;
    const attackBudget = getEnemyActionBudget('veteran', activeEnemies);
    const decisionBudget = getEnemyDecisionBudget('veteran', activeEnemies);

    expect(attackBudget).toBe(35);
    expect(decisionBudget).toBeGreaterThanOrEqual(activeEnemies + attackBudget + 10);
    expect(getEnemyDecisionBudget('story', 2)).toBe(50);
  });

  it('recruits units with tier modifiers and delays availability', () => {
    const state = createCampaign(starterBundle);
    const beforeMoney = state.resources.money;
    const recruit = recruitUnit(state, starterBundle, 'light-infantry', 'veteran');
    expect(state.resources.money).toBeLessThan(beforeMoney);
    expect(recruit.availableOnTurn).toBe(state.turn + 2);
    expect(state.reserves).toContain(recruit);
    expect(recruit.experience).toBe(minimumExperienceForTier('veteran'));

    state.resources.money = 10_000;
    const elite = recruitUnit(state, starterBundle, 'light-infantry', 'elite');
    expect(elite.experience).toBe(minimumExperienceForTier('elite'));
    expect(unitTierForExperience(elite.experience)).toBe('elite');
  });

  it('promotes earned veterans and deploys cumulative XP with real tier bonuses', () => {
    const state = createCampaign(starterBundle);
    const roster = state.army.find((unit) => unit.tier === 'rookie' && unit.definitionId === 'light-infantry');
    if (!roster) throw new Error('expected a rookie infantry unit');
    roster.experience = 20;

    const firstBattle = startBattleForTerritory(state, starterBundle, 'sector-paris', ['captain', roster.id]);
    const tactical = firstBattle.state.sides.alliance.units.get(firstBattle.deployment[roster.id]);
    if (!tactical) throw new Error('expected deployed infantry');
    expect(tactical.experience).toBe(20);
    expect(tactical.level).toBe(1);
    expect(tactical.careerProgression).toBe(true);
    expect(Array.from(firstBattle.state.sides.otherSide.units.values())
      .every((unit) => unit.careerProgression)).toBe(true);
    expect(firstBattle.deploymentExperience?.[roster.id]).toBe(20);

    tactical.experience = 25;
    tactical.level = 1;
    applyBattleOutcome(state, starterBundle, 'victory');

    expect(roster.experience).toBe(25);
    expect(roster.tier).toBe('veteran');
    expect(state.log.some((entry) => entry.key === 'unitPromoted'
      && entry.params?.unitId === roster.definitionId
      && entry.params?.tier === 'veteran')).toBe(true);
    expect(state.popups?.some((popup) => popup.key === 'unitPromoted'
      && popup.params?.unitId === roster.definitionId)).toBe(true);

    endStrategicTurn(state, starterBundle);
    const nextTerritory = state.territories.find((territory) => territory.status === 'available');
    if (!nextTerritory) throw new Error('expected an unlocked territory');
    const secondBattle = startBattleForTerritory(state, starterBundle, nextTerritory.id, ['captain', roster.id]);
    const redeployed = secondBattle.state.sides.alliance.units.get(secondBattle.deployment[roster.id]);
    const definition = starterBundle.units.find((unit) => unit.id === roster.definitionId);
    if (!redeployed || !definition) throw new Error('expected redeployed infantry definition');
    expect(redeployed.experience).toBe(25);
    expect(redeployed.level).toBe(1);
    for (const [weaponId, accuracy] of Object.entries(definition.stats.weaponAccuracy)) {
      expect(redeployed.stats.weaponAccuracy[weaponId]).toBeCloseTo(Math.min(0.98, accuracy + 0.08));
    }
  });

  it.each(['victory', 'defeat'] as const)('does not double-count deployment XP after %s', (result) => {
    const state = createCampaign(starterBundle);
    const roster = state.army.find((unit) => unit.id === 'captain');
    if (!roster) throw new Error('expected campaign captain');
    roster.experience = 60;
    roster.tier = 'elite';
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris', [roster.id]);
    const tactical = battle.state.sides.alliance.units.get(battle.deployment[roster.id]);
    if (!tactical) throw new Error('expected deployed captain');
    tactical.experience += 5;

    applyBattleOutcome(state, starterBundle, result);

    expect(state.army.find((unit) => unit.id === roster.id)?.experience).toBe(65);
  });

  it('preserves earned XP when a cut-off hero is recovered during retreat', () => {
    const state = createCampaign(starterBundle);
    const roster = state.army.find((unit) => unit.id === 'captain');
    if (!roster) throw new Error('expected campaign captain');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris', [roster.id]);
    const tactical = battle.state.sides.alliance.units.get(battle.deployment[roster.id]);
    if (!tactical) throw new Error('expected deployed captain');
    tactical.experience += 5;
    tactical.coordinate = { q: battle.state.map.width - 1, r: 0 };

    retreatFromBattle(state, starterBundle);

    const recovered = state.army.find((unit) => unit.id === roster.id);
    expect(recovered?.experience).toBe(65);
    expect(recovered?.currentHealth).toBe(1);
  });

  it('uses one projection for refill and rearm XP, tier and cost', () => {
    const refillState = createCampaign(starterBundle);
    const refillTarget = refillState.army.find((unit) => unit.id === 'captain');
    if (!refillTarget) throw new Error('expected refill target');
    refillTarget.experience = 60;
    refillTarget.tier = 'elite';
    refillTarget.currentHealth = 1;
    refillState.resources.money = 10_000;
    const refillQuote = projectUnitService(refillState, starterBundle, refillTarget.id, {
      kind: 'refill', quality: 'rookie'
    });
    expect(refillQuote).toMatchObject({ experienceAfter: 36, tierAfter: 'veteran' });
    const moneyBeforeRefill = refillState.resources.money;
    refillUnit(refillState, starterBundle, refillTarget.id, 'rookie');
    expect(refillTarget.experience).toBe(refillQuote.experienceAfter);
    expect(refillTarget.tier).toBe(refillQuote.tierAfter);
    expect(moneyBeforeRefill - refillState.resources.money).toBe(refillQuote.cost);

    const eliteState = createCampaign(starterBundle);
    const eliteTarget = eliteState.army.find((unit) => unit.id === 'captain');
    if (!eliteTarget) throw new Error('expected elite refill target');
    eliteTarget.currentHealth = 1;
    eliteState.resources.money = 10_000;
    const eliteQuote = projectUnitService(eliteState, starterBundle, eliteTarget.id, {
      kind: 'refill', quality: 'elite'
    });
    refillUnit(eliteState, starterBundle, eliteTarget.id, 'elite');
    expect(eliteQuote.experienceAfter).toBe(60);
    expect(eliteTarget.tier).toBe('elite');

    const rearmState = createCampaign(starterBundle);
    const rearmTarget = rearmState.army.find((unit) => unit.definitionId === 'light-infantry');
    if (!rearmTarget) throw new Error('expected rearm target');
    rearmTarget.experience = 70;
    rearmTarget.tier = 'elite';
    rearmState.resources.money = 10_000;
    const rearmQuote = projectUnitService(rearmState, starterBundle, rearmTarget.id, {
      kind: 'rearm', definitionId: 'rangers'
    });
    const moneyBeforeRearm = rearmState.resources.money;
    rearmUnit(rearmState, starterBundle, rearmTarget.id, 'rangers');
    expect(rearmTarget.experience).toBe(rearmQuote.experienceAfter);
    expect(rearmTarget.tier).toBe(rearmQuote.tierAfter);
    expect(moneyBeforeRearm - rearmState.resources.money).toBe(rearmQuote.cost);
  });

  it('pre-populates unlocks from starting research and blocks locked units', () => {
    const state = createCampaign(starterBundle);
    expect(state.research.known.has('rangers')).toBe(true);
    expect(() => recruitUnit(state, starterBundle, 'leopard-2', 'rookie')).toThrow();

    state.research.completed.add('armor-upfit');
    state.research.known.add('leopard-2');
    state.resources.money = 500;
    const tank = recruitUnit(state, starterBundle, 'leopard-2', 'rookie');
    expect(tank.definitionId).toBe('leopard-2');
  });

  it('advances research and completes topics', () => {
    const state = createCampaign(starterBundle);
    // Start a fresh topic
    const topicId = 'armor-upfit';
    state.resources.research = 200;
    state.research.inProgress = { topicId, remaining: 10 };
    endStrategicTurn(state, starterBundle);
    expect(state.research.completed.has(topicId)).toBe(true);
  });
  it('ticks war clock and applies upkeep', () => {
    const state = createCampaign(starterBundle);
    const before = state.globalTimer;
    const beforeMoney = state.resources.money;
    endStrategicTurn(state, starterBundle);
    expect(state.globalTimer).toBe(before - 1);
    expect(state.resources.money).toBeLessThanOrEqual(beforeMoney);
  });

  it('does not chain raids from generated counteroffensives', () => {
    const state = createCampaign(starterBundle);
    const base = state.territories[0];
    if (!base) throw new Error('expected starter territory');
    state.turn = 7;
    state.territories = [{
      ...base,
      id: 'counterattack',
      name: 'Enemy Counterattack',
      status: 'cleared'
    }];

    endStrategicTurn(state, starterBundle);

    expect(state.territories.some((territory) => territory.name === 'Enemy Raid near Enemy Counterattack')).toBe(false);
    expect(state.log.some((entry) => entry.key === 'raidThreatens' && entry.params?.target === 'Enemy Counterattack')).toBe(false);
  });

  it('applies retreat losses for units off start tiles', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const regularRoster = state.army.find((unit) => unit.id !== 'captain' && battle.deployment[unit.id]);
    if (!regularRoster) throw new Error('expected deployed regular unit');
    const firstUnit = battle.state.sides.alliance.units.get(battle.deployment[regularRoster.id]);
    if (!firstUnit) throw new Error('expected deployed regular unit');
    // Move first unit well clear of the (SW) alliance deploy zone to simulate overextension.
    firstUnit.coordinate = { q: battle.state.map.width - 1, r: 0 };
    retreatFromBattle(state, starterBundle);
    // Unit off the start tile should be lost
    const stillThere = state.army.find((u) => u.id === regularRoster.id);
    expect(stillThere).toBeUndefined();
  });

  it('recovers the campaign hero wounded when retreat cuts them off', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
    if (!captain) throw new Error('expected deployed campaign hero');
    captain.coordinate = { q: battle.state.map.width - 1, r: 0 };

    expect(getBattleRetreatForecast(state, starterBundle)).toEqual({
      lostUnitIds: [],
      recoveredHeroIds: ['captain']
    });

    retreatFromBattle(state, starterBundle);
    expect(state.army.find((unit) => unit.id === 'captain')?.currentHealth).toBe(1);
  });

  it('recovers the campaign hero wounded after a tactical defeat', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
    if (!captain) throw new Error('expected deployed campaign hero');
    captain.currentHealth = 0;
    captain.stance = 'destroyed';

    applyBattleOutcome(state, starterBundle, 'defeat');
    expect(state.army.find((unit) => unit.id === 'captain')?.currentHealth).toBe(1);
  });

  it('lets Optics II soften fog for the alliance only', () => {
    const sumVision = (battle: ReturnType<typeof startBattleForTerritory>, faction: 'alliance' | 'otherSide') =>
      Array.from(battle.state.sides[faction].units.values()).reduce((sum, u) => sum + u.stats.vision, 0);

    const unlockFog = (state: ReturnType<typeof createCampaign>) => {
      const fog = state.territories.find((t) => t.id === 'sector-amsterdam');
      if (fog) fog.status = 'available';
    };

    const plain = createCampaign(starterBundle);
    unlockFog(plain);
    const fogged = startBattleForTerritory(plain, starterBundle, 'sector-amsterdam'); // fog scenario

    const teched = createCampaign(starterBundle);
    unlockFog(teched);
    teched.research.completed.add('optics-ii');
    const foggedWithOptics = startBattleForTerritory(teched, starterBundle, 'sector-amsterdam');

    // Optics II restores a point of alliance vision in fog; the enemy gets no such relief.
    expect(sumVision(foggedWithOptics, 'alliance')).toBeGreaterThan(sumVision(fogged, 'alliance'));
    expect(sumVision(foggedWithOptics, 'otherSide')).toBe(sumVision(fogged, 'otherSide'));
  });

  it('applies research stat bonuses to fielded units', () => {
    const infantry = (battle: ReturnType<typeof startBattleForTerritory>) =>
      Array.from(battle.state.sides.alliance.units.values()).filter((u) => u.unitType === 'infantry');

    const plain = createCampaign(starterBundle);
    const before = startBattleForTerritory(plain, starterBundle, 'sector-paris');

    const teched = createCampaign(starterBundle);
    teched.research.completed.add('field-fortification'); // +1 armor to infantry/hero
    const after = startBattleForTerritory(teched, starterBundle, 'sector-paris');

    const beforeInf = infantry(before);
    const afterInf = infantry(after);
    expect(afterInf.length).toBe(beforeInf.length);
    expect(afterInf.length).toBeGreaterThan(0);
    const armorGain = afterInf.reduce((s, u) => s + u.stats.armor, 0) - beforeInf.reduce((s, u) => s + u.stats.armor, 0);
    expect(armorGain).toBe(beforeInf.length); // exactly +1 armor per infantry
  });

  it('stores casualties and rewards after a victory', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    // wipe enemies to force victory
    for (const enemy of battle.state.sides.otherSide.units.values()) {
      enemy.stance = 'destroyed';
    }
    applyBattleOutcome(state, starterBundle, 'victory');
    const territory = state.territories.find((t) => t.id === 'sector-lyon');
    expect(territory?.status).toBe('cleared');
  });

  it('does not permanently fail a timed territory when its relief window expires', () => {
    const state = createCampaign(starterBundle);
    const timed = state.territories.find((t) => t.status === 'available' && t.remainingTimer != null);
    expect(timed).toBeDefined();
    const turns = (timed!.remainingTimer ?? 0) + 2; // well under the global war clock (25)
    for (let i = 0; i < turns; i++) endStrategicTurn(state, starterBundle);
    const after = state.territories.find((t) => t.id === timed!.id)!;
    // expiry costs the relief window but must keep the sector clearable (was a campaign soft-lock)
    expect(after.status).not.toBe('failed');
    expect(after.status).toBe('available');
  });

  it('preserves never-deployed (benched) army units after a victory', () => {
    const state = createCampaign(starterBundle);
    // Grow the army well beyond any scenario's start-tile count so several units are guaranteed benched.
    for (let i = 0; i < 24; i++) state.army.push({ ...structuredClone(state.army[0]), id: `benched-unit-${i}` });
    const armyBefore = state.army.length;
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const deployedIds = new Set(Object.keys(battle.deployment));
    const benchedIds = state.army.filter((u) => !deployedIds.has(u.id)).map((u) => u.id);
    expect(benchedIds.length).toBeGreaterThan(0); // the scenario has fewer start tiles than the army
    for (const enemy of battle.state.sides.otherSide.units.values()) enemy.stance = 'destroyed';
    applyBattleOutcome(state, starterBundle, 'victory');
    // benched units never fought, so they must still be on the roster
    for (const id of benchedIds) {
      expect(state.army.find((u) => u.id === id)).toBeDefined();
    }
    // a clean win with no deployed casualties must not shrink the roster
    expect(state.army.length).toBe(armyBefore);
  });

  it('blocks battles that have no deployable allied units', () => {
    const state = createCampaign(starterBundle);
    state.army = [];
    const territory = state.territories.find((t) => t.id === 'sector-strasbourg');
    if (!territory) throw new Error('expected Strasbourg territory');
    territory.status = 'available';
    expect(() => startBattleForTerritory(state, starterBundle, 'sector-strasbourg')).toThrow(/No deployable units/);
  });

  it('allows only one operation per strategic turn', () => {
    const state = createCampaign(starterBundle);
    startBattleForTerritory(state, starterBundle, 'sector-paris');
    retreatFromBattle(state, starterBundle);

    const nextTerritory = state.territories.find((territory) => territory.id === 'sector-lyon');
    if (!nextTerritory) throw new Error('expected Lyon territory');
    nextTerritory.status = 'available';
    expect(() => startBattleForTerritory(state, starterBundle, nextTerritory.id)).toThrow(/already been launched this turn/);

    endStrategicTurn(state, starterBundle);
    expect(() => startBattleForTerritory(state, starterBundle, nextTerritory.id)).not.toThrow();
  });

  it.each(['story', 'commander', 'veteran'] as const)(
    'keeps the full %s campaign winnable while advancing the war clock',
    (difficulty) => {
      const state = createCampaign(starterBundle, undefined, difficulty);
      const campaignSectorIds = new Set(starterBundle.campaigns[0]?.territories.map((territory) => territory.id));
      let operations = 0;

      while (!state.outcome) {
        const territory = state.territories.find(
          (candidate) => campaignSectorIds.has(candidate.id) && candidate.status === 'available'
        );
        if (!territory) throw new Error('expected an available campaign sector');

        startBattleForTerritory(state, starterBundle, territory.id);
        applyBattleOutcome(state, starterBundle, 'victory');
        operations += 1;
        if (!state.outcome) endStrategicTurn(state, starterBundle);
      }

      expect(state.outcome).toBe('victory');
      const bypassed = state.territories.filter(
        (territory) => campaignSectorIds.has(territory.id) && territory.status === 'bypassed'
      );
      expect(operations + bypassed.length).toBe(campaignSectorIds.size);
      expect(state.turn).toBe(operations);
      expect(state.globalTimer).toBeGreaterThan(0);
    }
  );

  it('a campaign completes when the unchosen branch is bypassed', () => {
    const bundle = makeOutcomeRouteBundle();
    const state = createCampaign(bundle);

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.territories.find((territory) => territory.id === 'sector-lyon')?.status).toBe('available');
    expect(state.territories.find((territory) => territory.id === 'sector-brussels')?.status).toBe('bypassed');
    endStrategicTurn(state, bundle);

    startBattleForTerritory(state, bundle, 'sector-lyon');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.outcome).toBe('victory');
    expect(state.territories.map(({ id, status }) => [id, status])).toEqual([
      ['sector-paris', 'cleared'],
      ['sector-lyon', 'cleared'],
      ['sector-brussels', 'bypassed']
    ]);
  });

  it('keeps the first route result after a failed operation is retried and won', () => {
    const bundle = makeOutcomeRouteBundle();
    const state = createCampaign(bundle);

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'defeat');

    expect(state.operationResults['sector-paris']).toBe('defeat');
    expect(state.territories.find((territory) => territory.id === 'sector-paris')?.status).toBe('failed');
    expect(state.territories.find((territory) => territory.id === 'sector-lyon')?.status).toBe('bypassed');
    expect(state.territories.find((territory) => territory.id === 'sector-brussels')?.status).toBe('available');

    endStrategicTurn(state, bundle);
    expect(state.territories.find((territory) => territory.id === 'sector-paris')?.status).toBe('available');

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.operationResults['sector-paris']).toBe('defeat');
    expect(state.territories.find((territory) => territory.id === 'sector-paris')?.status).toBe('cleared');
    expect(state.territories.find((territory) => territory.id === 'sector-lyon')?.status).toBe('bypassed');
    expect(state.territories.find((territory) => territory.id === 'sector-brussels')?.status).toBe('available');

    const restored = hydrateCampaignState(bundle, JSON.parse(JSON.stringify(serializeCampaignState(state))));
    expect(restored.operationResults['sector-paris']).toBe('defeat');
    expect(restored.territories.find((territory) => territory.id === 'sector-lyon')?.status).toBe('bypassed');
    expect(restored.territories.find((territory) => territory.id === 'sector-brussels')?.status).toBe('available');
  });

  it('completes a defeat-selected route without awarding the failed source operation', () => {
    const bundle = makeOutcomeRouteBundle();
    const state = createCampaign(bundle);
    const startingResources = { ...state.resources };

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'defeat');
    expect(state.resources).toEqual(startingResources);
    endStrategicTurn(state, bundle);

    startBattleForTerritory(state, bundle, 'sector-brussels');
    expect(state.territories.find((territory) => territory.id === 'sector-paris')?.status).toBe('resolved');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.outcome).toBe('victory');
    expect(state.territories.map(({ id, status }) => [id, status])).toEqual([
      ['sector-paris', 'resolved'],
      ['sector-lyon', 'bypassed'],
      ['sector-brussels', 'cleared']
    ]);
  });

  it.each(['victory', 'defeat'] as const)(
    'converges the %s consequence route and waits for both parallel fronts',
    (result) => {
      const bundle = structuredClone(starterBundle);
      const campaignIds = new Set(bundle.campaigns[0].territories.map((territory) => territory.id));
      const state = createCampaign(bundle);
      for (const territory of state.territories) {
        if (campaignIds.has(territory.id)) territory.status = 'cleared';
      }
      const resetIds = [
        'sector-cinder-gate',
        'sector-lantern-vault',
        'sector-hollow-tide',
        'sector-ashen-confluence',
        'sector-sable-causeway',
        'sector-mnemonic-orchard',
        'sector-thorn-engine',
        'sector-veil-heart'
      ];
      for (const id of resetIds) {
        const territory = state.territories.find((candidate) => candidate.id === id);
        if (!territory) throw new Error(`expected ${id}`);
        territory.status = id === 'sector-cinder-gate' ? 'available' : 'locked';
      }

      startBattleForTerritory(state, bundle, 'sector-cinder-gate');
      applyBattleOutcome(state, bundle, result);
      const selectedRouteId = result === 'victory' ? 'sector-lantern-vault' : 'sector-hollow-tide';
      const bypassedRouteId = result === 'victory' ? 'sector-hollow-tide' : 'sector-lantern-vault';
      expect(state.territories.find((territory) => territory.id === selectedRouteId)?.status).toBe('available');
      expect(state.territories.find((territory) => territory.id === bypassedRouteId)?.status).toBe('bypassed');
      expect(state.territories.find((territory) => territory.id === 'sector-ashen-confluence')?.status).toBe('locked');

      endStrategicTurn(state, bundle);
      startBattleForTerritory(state, bundle, selectedRouteId);
      applyBattleOutcome(state, bundle, 'victory');
      expect(state.territories.find((territory) => territory.id === 'sector-ashen-confluence')?.status).toBe('available');

      const restored = hydrateCampaignState(bundle, serializeCampaignState(state));
      expect(restored.territories.find((territory) => territory.id === 'sector-ashen-confluence')?.status).toBe('available');
      endStrategicTurn(restored, bundle);
      startBattleForTerritory(restored, bundle, 'sector-ashen-confluence');
      applyBattleOutcome(restored, bundle, 'victory');
      expect(restored.territories.find((territory) => territory.id === 'sector-sable-causeway')?.status).toBe('available');
      expect(restored.territories.find((territory) => territory.id === 'sector-mnemonic-orchard')?.status).toBe('available');

      endStrategicTurn(restored, bundle);
      startBattleForTerritory(restored, bundle, 'sector-sable-causeway');
      applyBattleOutcome(restored, bundle, 'victory');
      expect(restored.territories.find((territory) => territory.id === 'sector-thorn-engine')?.status).toBe('locked');

      endStrategicTurn(restored, bundle);
      startBattleForTerritory(restored, bundle, 'sector-mnemonic-orchard');
      applyBattleOutcome(restored, bundle, 'victory');
      expect(restored.territories.find((territory) => territory.id === 'sector-thorn-engine')?.status).toBe('available');
    }
  );

  it('keeps an any-of convergence retryable until every predecessor is bypassed', () => {
    const state = createCampaign(starterBundle);
    const lantern = state.territories.find((territory) => territory.id === 'sector-lantern-vault');
    const hollow = state.territories.find((territory) => territory.id === 'sector-hollow-tide');
    if (!lantern || !hollow) throw new Error('expected Act II route states');
    lantern.status = 'bypassed';
    hollow.status = 'failed';

    const retryable = hydrateCampaignState(starterBundle, serializeCampaignState(state));
    expect(retryable.territories.find((territory) => territory.id === 'sector-ashen-confluence')?.status)
      .toBe('locked');

    const retryableHollow = retryable.territories.find((territory) => territory.id === 'sector-hollow-tide');
    if (!retryableHollow) throw new Error('expected restored Hollow Tide');
    retryableHollow.status = 'bypassed';
    const exhausted = hydrateCampaignState(starterBundle, serializeCampaignState(retryable));
    expect(exhausted.territories.find((territory) => territory.id === 'sector-ashen-confluence')?.status)
      .toBe('bypassed');
  });

  it('grants an act time credit before the transition turn can expire', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    state.globalTimer = 1;

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.globalTimer).toBe(3);
    expect(state.actTimeBonusesApplied['2']).toBe(2);
    endStrategicTurn(state, bundle);
    expect(state.globalTimer).toBe(2);
    expect(state.outcome).toBeUndefined();
  });

  it('does not repeat the critical clock warning after an act time credit', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    state.globalTimer = 4;
    state.log.push({ key: 'warClockCritical' });

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');
    endStrategicTurn(state, bundle);

    expect(state.globalTimer).toBe(5);
    expect(state.log.filter((entry) => entry.key === 'warClockCritical')).toHaveLength(1);
  });

  it('relieves clock-driven counterattack pressure when a new act opens', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    state.globalTimer = 5;

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');
    endStrategicTurn(state, bundle);

    expect(state.globalTimer).toBe(6);
    expect(state.territories.some((territory) => territory.id === 'counterattack')).toBe(false);
  });

  it('persists act time credit once and grants only a later target increase', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');
    const creditedTimer = state.globalTimer;

    const restored = hydrateCampaignState(bundle, JSON.parse(JSON.stringify(serializeCampaignState(state))));
    expect(restored.globalTimer).toBe(creditedTimer);
    expect(restored.actTimeBonusesApplied['2']).toBe(2);

    const expanded = structuredClone(bundle);
    expanded.campaigns[0].actTimeBonuses![0].turns = { story: 5, commander: 5, veteran: 5 };
    const toppedUp = hydrateCampaignState(expanded, serializeCampaignState(restored));
    expect(toppedUp.globalTimer).toBe(creditedTimer + 3);
    expect(toppedUp.actTimeBonusesApplied['2']).toBe(5);

    const reloaded = hydrateCampaignState(expanded, serializeCampaignState(toppedUp));
    expect(reloaded.globalTimer).toBe(toppedUp.globalTimer);
  });

  it('does not pay act time credit twice when the route source is retried', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'defeat');
    const creditedTimer = state.globalTimer;
    endStrategicTurn(state, bundle);

    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');

    expect(state.globalTimer).toBe(creditedTimer - 1);
    expect(state.actTimeBonusesApplied['2']).toBe(2);
    expect(state.operationResults['sector-paris']).toBe('defeat');
  });

  it('applies but does not overstate the credit for a pre-clock legacy save', () => {
    const bundle = makeTimedOutcomeRouteBundle();
    const state = createCampaign(bundle);
    startBattleForTerritory(state, bundle, 'sector-paris');
    applyBattleOutcome(state, bundle, 'victory');
    const snapshot = serializeCampaignState(state);
    delete (snapshot as Partial<typeof snapshot>).globalTimer;
    delete snapshot.actTimeBonusesApplied;

    const restored = hydrateCampaignState(bundle, snapshot);

    expect(restored.globalTimer).toBe(17);
    expect(restored.actTimeBonusesApplied['2']).toBe(2);
  });

  it('merges newly authored territories into a legacy save without dropping its active battle', () => {
    const state = createCampaign(starterBundle);
    startBattleForTerritory(state, starterBundle, 'sector-paris');
    applyBattleOutcome(state, starterBundle, 'victory');
    endStrategicTurn(state, starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const [unit] = battle.state.sides.alliance.units.values();
    if (!unit) throw new Error('expected deployed unit');
    unit.statusEffects.add('suppressed');
    const armyIds = state.army.map((armyUnit) => armyUnit.id);
    const researchIds = Array.from(state.research.completed);
    const resources = { ...state.resources };

    const legacySnapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    expect(legacySnapshot).not.toHaveProperty('operationResults');

    const expandedBundle = structuredClone(starterBundle);
    const newTerritory = structuredClone(expandedBundle.campaigns[0].territories.at(-1)!);
    newTerritory.id = 'sector-aftershock';
    newTerritory.name = 'Aftershock';
    newTerritory.requires = ['sector-paris'];
    newTerritory.route = undefined;
    newTerritory.act = undefined;
    expandedBundle.campaigns[0].territories.push(newTerritory);

    const restored = hydrateCampaignState(expandedBundle, legacySnapshot);

    expect(restored.territories).toHaveLength(state.territories.length + 1);
    expect(restored.territories.find((territory) => territory.id === 'sector-paris')?.status).toBe('cleared');
    expect(restored.territories.find((territory) => territory.id === 'sector-aftershock')?.status).toBe('available');
    expect(restored.army.map((armyUnit) => armyUnit.id)).toEqual(armyIds);
    expect(Array.from(restored.research.completed)).toEqual(researchIds);
    expect(restored.resources).toEqual(resources);
    expect(restored.activeBattle?.territoryId).toBe('sector-lyon');
    expect(restored.activeBattle?.state.sides.alliance.units.get(unit.id)?.statusEffects.has('suppressed')).toBe(true);
  });

  it('preserves old known unlocks plus exact active and paused research investment', () => {
    const state = createCampaign(starterBundle);
    state.resources.research = 13;
    startResearch(state, starterBundle, 'esprit-de-corps');
    progressResearch(state, starterBundle);
    pauseResearch(state, starterBundle);
    state.resources.research = 12;
    startResearch(state, starterBundle, 'armor-upfit');
    progressResearch(state, starterBundle);
    const snapshot = serializeCampaignState(state);
    const knownBefore = Array.from(state.research.known).sort();

    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.research.inProgress).toEqual({ topicId: 'armor-upfit', remaining: 68 });
    expect(restored.research.paused['esprit-de-corps']).toBe(37);
    expect(Array.from(restored.research.known).sort()).toEqual(knownBefore);
    expect(Array.from(restored.research.known)).toEqual(expect.arrayContaining([
      'rangers',
      'gepard-aa',
      'humvee-scout'
    ]));
  });

  it('a save completed under the old campaign, migrated into the expanded one, still reports victory', () => {
    const legacyBundle = structuredClone(starterBundle);
    legacyBundle.campaigns[0].territories = [
      legacyBundle.campaigns[0].territories.find((territory) => territory.id === 'sector-paris')!
    ];
    const legacyState = createCampaign(legacyBundle);
    startBattleForTerritory(legacyState, legacyBundle, 'sector-paris');
    applyBattleOutcome(legacyState, legacyBundle, 'victory');
    const legacySnapshot = JSON.parse(JSON.stringify(serializeCampaignState(legacyState)));

    expect(legacySnapshot.outcome).toBe('victory');
    expect(legacySnapshot).not.toHaveProperty('operationResults');

    const restored = hydrateCampaignState(makeOutcomeRouteBundle(), legacySnapshot);

    expect(restored.operationResults['sector-paris']).toBe('victory');
    expect(restored.outcome).toBe('victory');
    expect(restored.territories.find((territory) => territory.id === 'sector-lyon')?.status).toBe('available');
    expect(restored.territories.find((territory) => territory.id === 'sector-brussels')?.status).toBe('bypassed');
  });

  it('keeps every shipped campaign route inside each difficulty clock', () => {
    const routeSourceIds = Array.from(new Set(starterBundle.campaigns[0].territories.flatMap((territory) => (
      territory.route ? [territory.route.territoryId] : []
    ))));
    const expectedSlack: Record<CampaignDifficulty, number> = {
      story: 13,
      commander: 8,
      veteran: 3
    };

    for (const difficulty of ['story', 'commander', 'veteran'] as const) {
      for (let routeState = 0; routeState < 2 ** routeSourceIds.length; routeState += 1) {
        const selectedResults = new Map(routeSourceIds.map((territoryId, index) => [
          territoryId,
          routeState & (2 ** index) ? 'defeat' as const : 'victory' as const
        ]));
        const campaignTerritoryIds = new Set(starterBundle.campaigns[0].territories.map((territory) => territory.id));
        const state = createCampaign(starterBundle, undefined, difficulty);
        let operations = 0;

        while (!state.outcome && operations <= campaignTerritoryIds.size * 2) {
          const territory = state.territories
            .filter((candidate) => campaignTerritoryIds.has(candidate.id) && candidate.status === 'available')
            .sort((left, right) => Number(Boolean(right.route)) - Number(Boolean(left.route)))[0];
          if (!territory) break;

          startBattleForTerritory(state, starterBundle, territory.id);
          applyBattleOutcome(state, starterBundle, selectedResults.get(territory.id) ?? 'victory');
          operations += 1;
          if (!state.outcome) endStrategicTurn(state, starterBundle);
        }

        const routeDescription = `${difficulty} ${JSON.stringify(Object.fromEntries(selectedResults))}`;
        const timeCredit = state.actTimeBonusesApplied['2'] ?? 0;
        const effectiveBudget = CAMPAIGN_DIFFICULTY_RULES[difficulty].globalTimer + timeCredit;
        expect(state.outcome, routeDescription).toBe('victory');
        expect(operations, routeDescription).toBeLessThanOrEqual(effectiveBudget);
        expect(effectiveBudget - operations, routeDescription).toBe(expectedSlack[difficulty]);
        expect(state.territories.filter((territory) => (
          campaignTerritoryIds.has(territory.id)
          && territory.status !== 'cleared'
          && territory.status !== 'resolved'
          && territory.status !== 'bypassed'
        )), routeDescription).toHaveLength(0);
      }
    }
  });

  it('serializes and hydrates campaign state for persistence', () => {
    const state = createCampaign(starterBundle, undefined, 'veteran');
    state.resources.money = 321;
    state.turn = 3;
    state.lastOperationTurn = 3;
    state.research.inProgress = { topicId: 'armor-upfit', remaining: 15 };
    state.popups = [{ turn: 3, key: 'testReport', params: { note: 'Recovered report' }, kind: 'reward' }];

    const snapshot = serializeCampaignState(state);
    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.resources.money).toBe(321);
    expect(restored.difficulty).toBe('veteran');
    expect(restored.turn).toBe(3);
    expect(restored.lastOperationTurn).toBe(3);
    expect(restored.research.inProgress?.topicId).toBe('armor-upfit');
    expect(restored.research.completed.has('optics-i')).toBe(true);
    expect(isUnitUnlocked(restored, starterBundle, 'rangers')).toBe(true);
    expect(restored.popups?.[0]?.key).toBe('testReport');
    expect(restored.popups?.[0]?.params?.note).toBe('Recovered report');
  });

  it.each(['victory', 'retreat'] as const)(
    'migrates low-XP legacy tiers and in-flight battle deltas through %s',
    (exit) => {
      const state = createCampaign(starterBundle);
      const roster = state.army.find((unit) => unit.id === 'captain');
      if (!roster) throw new Error('expected campaign captain');
      roster.tier = 'elite';
      roster.experience = 37;
      const battle = startBattleForTerritory(state, starterBundle, 'sector-paris', [roster.id]);
      const tacticalId = battle.deployment[roster.id];
      const tactical = battle.state.sides.alliance.units.get(tacticalId);
      if (!tactical) throw new Error('expected deployed captain');
      tactical.experience = 5;
      tactical.level = 1;
      if (exit === 'retreat') tactical.coordinate = { q: battle.state.map.width - 1, r: 0 };

      const snapshot = serializeCampaignState(state);
      const encodedBattle = snapshot.activeBattle as any;
      delete encodedBattle.deploymentExperience;
      const encodedTactical = encodedBattle.state.sides.alliance.units.v
        .find(([unitId]: [string]) => unitId === tacticalId)?.[1];
      if (!encodedTactical) throw new Error('expected encoded tactical unit');
      encodedTactical.experience = 5;
      encodedTactical.level = 1;

      const restored = hydrateCampaignState(starterBundle, snapshot);
      const restoredRoster = restored.army.find((unit) => unit.id === roster.id);
      const restoredTactical = restored.activeBattle?.state.sides.alliance.units.get(tacticalId);
      expect(restoredRoster?.tier).toBe('elite');
      expect(restoredRoster?.experience).toBe(60);
      expect(restoredTactical?.experience).toBe(65);
      expect(restoredTactical?.level).toBe(1);

      if (exit === 'victory') applyBattleOutcome(restored, starterBundle, 'victory');
      else retreatFromBattle(restored, starterBundle);

      expect(restored.army.find((unit) => unit.id === roster.id)?.experience).toBe(65);
    }
  );

  it('loads pre-difficulty saves as Commander campaigns', () => {
    const snapshot = serializeCampaignState(createCampaign(starterBundle, undefined, 'story'));
    delete snapshot.difficulty;

    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.difficulty).toBe('commander');
  });

  it('hydrates pre-i18n saves whose log entries and popups are raw strings', () => {
    const snapshot = JSON.parse(JSON.stringify(serializeCampaignState(createCampaign(starterBundle))));
    snapshot.log = ['Campaign First Contact initialized', 'Research completed: Optics I'];
    snapshot.popups = [{ turn: 1, title: 'Intel: Sorcerers', body: 'Enemy sorcerers sighted.', kind: 'briefing' }];

    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.log[0]).toEqual({ key: 'legacy', params: { text: 'Campaign First Contact initialized' } });
    expect(restored.log[1]).toEqual({ key: 'legacy', params: { text: 'Research completed: Optics I' } });
    expect(restored.popups?.[0]).toEqual({
      turn: 1,
      key: 'legacy',
      params: { title: 'Intel: Sorcerers', body: 'Enemy sorcerers sighted.' },
      kind: 'briefing'
    });
  });

  it('credits hold objectives once per round and wins after the turn limit', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const [unit] = battle.state.sides.alliance.units.values();
    if (!unit) throw new Error('expected deployed unit');
    const target = { q: 3, r: 2 };
    battle.scenario.objectives = [
      { id: 'hold-square', kind: 'hold', description: 'Hold the square.', target, turnLimit: 3 }
    ];
    battle.holdProgress = {};
    battle.holdCountedRound = {};
    unit.coordinate = { ...target };

    // Re-evaluating within the same round must not over-count.
    expect(evaluateBattleOutcome(battle)).toBe('ongoing');
    evaluateBattleOutcome(battle);
    evaluateBattleOutcome(battle);
    expect(battle.holdProgress['hold-square']).toBe(1);

    battle.state.round += 1;
    expect(evaluateBattleOutcome(battle)).toBe('ongoing');
    expect(battle.holdProgress['hold-square']).toBe(2);

    battle.state.round += 1;
    expect(evaluateBattleOutcome(battle)).toBe('victory');
    expect(battle.holdProgress['hold-square']).toBe(3);
  });

  it('requires Commander reach objectives to survive the enemy phase', () => {
    const state = createCampaign(starterBundle, undefined, 'commander');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const objective = battle.scenario.objectives.find((candidate) => candidate.kind === 'reach');
    const captainId = battle.deployment.captain;
    const captain = battle.state.sides.alliance.units.get(captainId);
    if (!objective?.target || !captain) throw new Error('expected Captain reach objective');
    captain.coordinate = { ...objective.target };

    expect(evaluateBattleOutcome(battle)).toBe('ongoing');
    expect(battle.reachClaimedRound[objective.id]).toBe(1);

    const processor = new TurnProcessor(battle.state);
    processor.endTurn();
    expect(evaluateBattleOutcome(battle)).toBe('ongoing');
    processor.endTurn();
    expect(evaluateBattleOutcome(battle)).toBe('victory');
  });

  it('resets reach progress when the required unit is driven off the objective', () => {
    const state = createCampaign(starterBundle, undefined, 'commander');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const objective = battle.scenario.objectives.find((candidate) => candidate.kind === 'reach');
    const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
    if (!objective?.target || !captain) throw new Error('expected Captain reach objective');
    const origin = { ...captain.coordinate };
    captain.coordinate = { ...objective.target };
    evaluateBattleOutcome(battle);
    captain.coordinate = origin;

    expect(evaluateBattleOutcome(battle)).toBe('ongoing');
    expect(battle.reachClaimedRound[objective.id]).toBeUndefined();
  });

  it('keeps reach objectives immediate on Story difficulty', () => {
    const state = createCampaign(starterBundle, undefined, 'story');
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const objective = battle.scenario.objectives.find((candidate) => candidate.kind === 'reach');
    const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
    if (!objective?.target || !captain) throw new Error('expected Captain reach objective');
    captain.coordinate = { ...objective.target };

    expect(evaluateBattleOutcome(battle)).toBe('victory');
  });

  it('holds difficulty-scaled reserve waves off-map until their tactical event fires', () => {
    const storyState = createCampaign(starterBundle, undefined, 'story');
    const commanderState = createCampaign(starterBundle, undefined, 'commander');
    const veteranState = createCampaign(starterBundle, undefined, 'veteran');
    const storyBattle = startBattleForTerritory(storyState, starterBundle, 'sector-paris');
    const commanderBattle = startBattleForTerritory(commanderState, starterBundle, 'sector-paris');
    const veteranBattle = startBattleForTerritory(veteranState, starterBundle, 'sector-paris');

    const storyEnemyCount = storyBattle.state.sides.otherSide.units.size;
    expect(commanderBattle.state.sides.otherSide.units.size).toBe(storyEnemyCount);
    expect(veteranBattle.state.sides.otherSide.units.size).toBe(storyEnemyCount);

    for (const unit of commanderBattle.state.sides.otherSide.units.values()) {
      unit.stance = 'destroyed';
      unit.currentHealth = 0;
    }
    expect(evaluateBattleOutcome(commanderBattle)).toBe('ongoing');
    const commanderArrivals = processTacticalEvents(commanderState, starterBundle);
    expect(commanderArrivals).toHaveLength(1);
    expect(commanderArrivals[0]?.units).toHaveLength(2);
    expect(Array.from(commanderBattle.state.sides.otherSide.units.values()).filter((unit) => unit.stance !== 'destroyed')).toHaveLength(2);
    expect(processTacticalEvents(commanderState, starterBundle)).toEqual([]);

    for (const unit of veteranBattle.state.sides.otherSide.units.values()) {
      unit.stance = 'destroyed';
      unit.currentHealth = 0;
    }
    expect(processTacticalEvents(veteranState, starterBundle)[0]?.units).toHaveLength(3);

    for (const unit of storyBattle.state.sides.otherSide.units.values()) {
      unit.stance = 'destroyed';
      unit.currentHealth = 0;
    }
    expect(processTacticalEvents(storyState, starterBundle)).toEqual([]);
    expect(evaluateBattleOutcome(storyBattle)).toBe('victory');

    const lateVeteranState = createCampaign(starterBundle, undefined, 'veteran');
    const rift = lateVeteranState.territories.find((territory) => territory.id === 'sector-rift');
    if (!rift) throw new Error('expected Rift territory');
    rift.status = 'available';
    const lateVeteranBattle = startBattleForTerritory(lateVeteranState, starterBundle, rift.id);
    for (const unit of lateVeteranBattle.state.sides.otherSide.units.values()) {
      unit.stance = 'destroyed';
      unit.currentHealth = 0;
    }
    expect(processTacticalEvents(lateVeteranState, starterBundle)[0]?.units).toHaveLength(4);
  });

  it('keeps the authored roster reachable at each supported campaign difficulty', () => {
    const hostileIds = starterBundle.units
      .filter((unit) => unit.faction === 'otherSide')
      .map((unit) => unit.id);
    const allianceIds = starterBundle.units
      .filter((unit) => unit.faction === 'alliance')
      .map((unit) => unit.id);
    const missingFrom = (reachable: Set<string>, definitions: string[]) => (
      definitions.filter((definitionId) => !reachable.has(definitionId)).sort()
    );

    const story = definitionsReachableInCampaign(starterBundle, 'story');
    const commander = definitionsReachableInCampaign(starterBundle, 'commander');
    const veteran = definitionsReachableInCampaign(starterBundle, 'veteran');

    expect(starterBundle.units).toHaveLength(80);
    const artifactHint = 'After editing packages/data, rebuild it first: pnpm --filter @spellcross/data build';
    expect(missingFrom(veteran.hostile, hostileIds), artifactHint).toEqual([]);
    // The scaled late convoys field breorn-titan initially, making every hostile definition reachable on Commander.
    expect(missingFrom(commander.hostile, hostileIds), artifactHint).toEqual([]);
    expect(missingFrom(story.hostile, hostileIds)).toEqual([
      'ash-crown-sovereign',
      'glass-regent',
      'signal-eater',
      'winged-fiend'
    ]);
    expect(CAMPAIGN_DIFFICULTY_RULES.story.reinforcementBase).toBe(0);
    expect(missingFrom(commander.alliance, allianceIds)).toEqual([]);
  });

  it('does not let an unreferenced scenario hide a campaign-dead hostile definition', () => {
    const bundle = structuredClone(starterBundle);
    const campaignScenarioIds = new Set(bundle.campaigns[0].territories.map((territory) => territory.scenarioId));
    for (const scenario of bundle.scenarios.filter((candidate) => campaignScenarioIds.has(candidate.id))) {
      scenario.otherSideForces = scenario.otherSideForces.filter((unit) => unit.definitionId !== 'winged-fiend');
      for (const event of scenario.events ?? []) {
        event.reinforcements = event.reinforcements.filter((unit) => unit.definitionId !== 'winged-fiend');
      }
    }

    const unreferencedHostiles = new Set(bundle.scenarios
      .filter((scenario) => !campaignScenarioIds.has(scenario.id))
      .flatMap((scenario) => [
        ...scenario.otherSideForces,
        ...(scenario.events ?? []).flatMap((event) => event.reinforcements)
      ])
      .map((unit) => unit.definitionId));

    expect(unreferencedHostiles).toContain('winged-fiend');
    expect(definitionsReachableInCampaign(bundle, 'commander').hostile).not.toContain('winged-fiend');
  });

  it('stages a signature wave after its prerequisite event processing pass', () => {
    const state = createCampaign(starterBundle, undefined, 'veteran');
    const rift = state.territories.find((territory) => territory.id === 'sector-rift');
    if (!rift) throw new Error('expected Rift territory');
    rift.status = 'available';
    const battle = startBattleForTerritory(state, starterBundle, rift.id);
    battle.state.round = 10;

    const firstPhase = processTacticalEvents(state, starterBundle);
    expect(firstPhase).toHaveLength(1);
    expect(firstPhase[0]?.messageKey).toBe('portalSurge');

    const secondPhase = processTacticalEvents(state, starterBundle);
    expect(secondPhase).toHaveLength(1);
    expect(secondPhase[0]?.messageKey).toBe('ashCrownDescends');
    expect(processTacticalEvents(state, starterBundle)).toEqual([]);
  });

  it.each([
    ['sector-brussels', 'sector-brussels-pilot', 'rangers'],
    ['sector-amsterdam', 'sector-amsterdam-convoy', 'supply-truck']
  ] as const)('maps the scripted key unit into %s objectives', (territoryId, scenarioUnitId, definitionId) => {
    const state = createCampaign(starterBundle, undefined, 'story');
    const territory = state.territories.find((candidate) => candidate.id === territoryId);
    if (!territory) throw new Error(`expected ${territoryId}`);
    territory.status = 'available';
    const battle = startBattleForTerritory(state, starterBundle, territoryId);
    const tacticalId = battle.deployment[scenarioUnitId];
    const keyUnit = battle.state.sides.alliance.units.get(tacticalId);
    const objectiveKinds = battle.scenario.objectives
      .filter((objective) => objective.unitIds?.includes(scenarioUnitId))
      .map((objective) => objective.kind)
      .sort();

    expect(keyUnit?.definitionId).toBe(definitionId);
    expect(objectiveKinds).toEqual(['protect', 'reach']);
  });

  it('always deploys units required by reach objectives even when the start zone overflows', () => {
    const state = createCampaign(starterBundle, undefined, 'commander');
    // Flood the roster with transports: they sort to the front of deployment, so without the escort
    // pin the captain would be truncated out of the small evac start zone.
    for (let i = 0; i < 20; i += 1) {
      state.army.push({ id: `apc-${i}`, definitionId: 'm113', tier: 'rookie', experience: 0 });
    }
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    expect(battle.deployment.captain).toBeDefined();
  });

  it('refuses to dismiss the campaign hero but still dismisses regular units', () => {
    const state = createCampaign(starterBundle);
    dismissUnit(state, starterBundle, 'captain');
    expect(state.army.some((u) => u.id === 'captain')).toBe(true);

    const regular = state.army.find((u) => u.id !== 'captain');
    if (!regular) throw new Error('expected a non-hero unit in the starting army');
    dismissUnit(state, starterBundle, regular.id);
    expect(state.army.some((u) => u.id === regular.id)).toBe(false);
  });

  it('persists an in-progress battle through a full serialize/JSON/hydrate round-trip', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const [unit] = battle.state.sides.alliance.units.values();
    if (!unit) throw new Error('expected deployed unit');
    unit.statusEffects.add('suppressed');
    unit.currentAmmo = Infinity;
    unit.dugInThisRound = true;
    unit.idleEntrenchedTurns = 3;
    battle.holdProgress['hold-square'] = 2;
    battle.triggeredEventIds.push('sector-lyon-reserve-wave');

    // Mirror the app's persistence: serialize -> JSON string -> parse -> hydrate.
    const roundTripped = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    const restored = hydrateCampaignState(starterBundle, roundTripped);

    expect(restored.activeBattle).toBeTruthy();
    const restoredBattle = restored.activeBattle!;
    expect(restoredBattle.state.sides.alliance.units).toBeInstanceOf(Map);
    const restoredUnit = restoredBattle.state.sides.alliance.units.get(unit.id);
    expect(restoredUnit?.statusEffects).toBeInstanceOf(Set);
    expect(restoredUnit?.statusEffects.has('suppressed')).toBe(true);
    expect(restoredUnit?.currentAmmo).toBe(Infinity);
    expect(restoredUnit?.dugInThisRound).toBe(true);
    expect(restoredUnit?.idleEntrenchedTurns).toBe(3);
    expect(restoredBattle.holdProgress['hold-square']).toBe(2);
    expect(restoredBattle.triggeredEventIds).toEqual(['sector-lyon-reserve-wave']);
  });

  it('defaults morale-depth fields in legacy in-progress battles', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const [unit] = battle.state.sides.alliance.units.values();
    if (!unit) throw new Error('expected deployed unit');
    const snapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    const serializedUnit = snapshot.activeBattle.state.sides.alliance.units.v.find(
      ([id]: [string, unknown]) => id === unit.id
    )[1];
    delete serializedUnit.dugInThisRound;
    delete serializedUnit.idleEntrenchedTurns;

    const restored = hydrateCampaignState(starterBundle, snapshot);
    const restoredUnit = restored.activeBattle?.state.sides.alliance.units.get(unit.id);
    expect(restoredUnit?.dugInThisRound).toBe(false);
    expect(restoredUnit?.idleEntrenchedTurns).toBe(0);
  });

  it('adds radar deployment data to legacy in-progress battles', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-lyon');
    const [unit] = battle.state.sides.alliance.units.values();
    const radar = starterBundle.units.find((definition) => definition.id === 'horizon-radar');
    if (!unit || !radar) throw new Error('expected a deployed unit and radar definition');
    unit.definitionId = radar.id;
    unit.stats = structuredClone(radar.stats);

    const snapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    const serializedUnit = snapshot.activeBattle.state.sides.alliance.units.v.find(
      ([id]: [string, unknown]) => id === unit.id
    )[1];
    delete serializedUnit.stats.sensorDeployment;
    delete serializedUnit.sensorDeployed;

    const restored = hydrateCampaignState(starterBundle, snapshot);
    const restoredUnit = restored.activeBattle?.state.sides.alliance.units.get(unit.id);
    expect(restoredUnit?.stats.sensorDeployment).toEqual({ mobileVision: 5 });
    expect(restoredUnit?.sensorDeployed).toBe(false);
  });

  it('converts strategic points at the documented ratios', () => {
    const state = createCampaign(starterBundle);
    state.resources.strategic = 20;
    state.resources.money = 0;
    state.resources.research = 0;

    convertStrategicToMoney(state, 5);
    expect(state.resources.money).toBe(5); // 1:1
    expect(state.resources.strategic).toBe(15);

    convertStrategicToResearch(state, 3);
    expect(state.resources.research).toBe(9); // 1:3
    expect(state.resources.strategic).toBe(12);
  });

  it('restores a save that still carries a renamed unit definition id', () => {
    const state = createCampaign(starterBundle);
    const snapshot = JSON.parse(JSON.stringify(serializeCampaignState(state)));
    const commander = snapshot.army.find((unit: { definitionId: string }) => unit.definitionId === 'adam-halden');
    expect(commander).toBeDefined();
    commander.definitionId = 'john-alexander';

    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.army.map((unit) => unit.definitionId)).toContain('adam-halden');
    for (const unit of [...restored.army, ...restored.reserves]) {
      expect(starterBundle.units.some((definition) => definition.id === unit.definitionId)).toBe(true);
    }
  });
});
