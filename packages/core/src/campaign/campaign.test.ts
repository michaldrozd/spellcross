import { starterBundle } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  applyBattleOutcome,
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
  recruitUnit,
  retreatFromBattle,
  serializeCampaignState,
  startBattleForTerritory,
  hydrateCampaignState,
  isUnitUnlocked,
  processTacticalEvents
} from './campaign.js';
import { TurnProcessor } from '../simulation/systems/turn-processor.js';

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
      expect(operations).toBe(campaignSectorIds.size);
      expect(state.turn).toBe(operations);
      expect(state.globalTimer).toBeGreaterThan(0);
    }
  );

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
    expect(restoredBattle.holdProgress['hold-square']).toBe(2);
    expect(restoredBattle.triggeredEventIds).toEqual(['sector-lyon-reserve-wave']);
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
});
