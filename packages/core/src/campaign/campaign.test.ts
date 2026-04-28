import { describe, expect, it } from 'vitest';

import { starterBundle } from '@spellcross/data';
import {
  applyBattleOutcome,
  createCampaign,
  endStrategicTurn,
  recruitUnit,
  retreatFromBattle,
  serializeCampaignState,
  startBattleForTerritory,
  hydrateCampaignState,
  isUnitUnlocked
} from './campaign.js';

describe('campaign core', () => {
  it('creates a starter campaign with available territories and formations', () => {
    const state = createCampaign(starterBundle);
    expect(state.territories.length).toBeGreaterThan(0);
    expect(state.territories[0].status).toBe('available');
    expect(state.formations[0]?.units.length).toBe(state.army.length);
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
    expect(state.log.some((entry) => /Enemy raid threatens Enemy Counterattack/i.test(entry))).toBe(false);
  });

  it('applies retreat losses for units off start tiles', () => {
    const state = createCampaign(starterBundle);
    const battle = startBattleForTerritory(state, starterBundle, 'sector-paris');
    const [firstUnit] = battle.state.sides.alliance.units.values();
    if (!firstUnit) throw new Error('expected deployed unit');
    // Move first unit off start tile to simulate overextension
    firstUnit.coordinate = { q: firstUnit.coordinate.q + 1, r: firstUnit.coordinate.r };
    retreatFromBattle(state);
    // Unit off the start tile should be lost
    const stillThere = state.army.find((u) => u.id === Object.keys(battle.deployment)[0]);
    expect(stillThere).toBeUndefined();
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

  it('blocks battles that have no deployable allied units', () => {
    const state = createCampaign(starterBundle);
    state.army = [];
    const territory = state.territories.find((t) => t.id === 'sector-strasbourg');
    if (!territory) throw new Error('expected Strasbourg territory');
    territory.status = 'available';
    expect(() => startBattleForTerritory(state, starterBundle, 'sector-strasbourg')).toThrow(/No deployable units/);
  });

  it('serializes and hydrates campaign state for persistence', () => {
    const state = createCampaign(starterBundle);
    state.resources.money = 321;
    state.turn = 3;
    state.research.inProgress = { topicId: 'armor-upfit', remaining: 15 };
    state.popups = [{ turn: 3, title: 'Report', body: 'Recovered report', kind: 'reward' }];

    const snapshot = serializeCampaignState(state);
    const restored = hydrateCampaignState(starterBundle, snapshot);

    expect(restored.resources.money).toBe(321);
    expect(restored.turn).toBe(3);
    expect(restored.research.inProgress?.topicId).toBe('armor-upfit');
    expect(restored.research.completed.has('optics-i')).toBe(true);
    expect(isUnitUnlocked(restored, starterBundle, 'rangers')).toBe(true);
    expect(restored.popups?.[0]?.title).toBe('Report');
  });
});
