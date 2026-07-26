import { starterBundle, type ContentBundle, type TacticalScenarioEventEffect } from '@spellcross/data';
import { describe, expect, it } from 'vitest';

import {
  createCampaign,
  evaluateBattleOutcome,
  hydrateCampaignState,
  performObjectiveAction,
  processTacticalEvents,
  serializeCampaignState,
  startBattleForTerritory,
  type ActiveBattle,
  type CampaignDifficulty,
  type CampaignState
} from './campaign.js';
import type { MapTile } from '../simulation/types.js';
import { updateAllFactionsVision } from '../simulation/visibility/vision.js';

const roadTile = (tile: MapTile): MapTile => ({
  terrain: 'road',
  elevation: tile.elevation,
  cover: 1,
  movementCostModifier: 0.8,
  passable: true,
  providesVisionBoost: false,
  blocksVision: false,
  destructible: false
});

function openBattle(
  territoryId = 'sector-strasbourg',
  difficulty: CampaignDifficulty = 'commander',
  bundle: ContentBundle = structuredClone(starterBundle),
  selectedDefinitionIds: string[] = [starterBundle.campaigns[0].startingUnits[0].definitionId]
): { state: CampaignState; battle: ActiveBattle; bundle: ContentBundle } {
  const state = createCampaign(bundle, undefined, difficulty);
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (!territory) throw new Error(`missing territory ${territoryId}`);
  territory.status = 'available';
  const selectedUnitIds = selectedDefinitionIds.map((definitionId) => {
    const unit = state.army.find((candidate) => candidate.definitionId === definitionId);
    if (!unit) throw new Error(`missing army definition ${definitionId}`);
    return unit.id;
  });
  const battle = startBattleForTerritory(state, bundle, territoryId, selectedUnitIds);
  battle.deployed = true;
  return { state, battle, bundle };
}

function setEffectOnlyEvent(
  battle: ActiveBattle,
  effects: TacticalScenarioEventEffect[],
  id = 'effect-only'
) {
  battle.scenario.events = [{
    id,
    triggerRound: 1,
    messageKey: 'lanternArchiveRevealed',
    faction: 'otherSide',
    reinforcements: [],
    effects
  }];
  battle.triggeredEventIds = [];
}

describe('tactical scenario effects', () => {
  it('applies authored effects in order, keeps occupants legal, and fires only once across save/load', () => {
    const { state, battle, bundle } = openBattle();
    const ally = Array.from(battle.state.sides.alliance.units.values())[0];
    const enemy = Array.from(battle.state.sides.otherSide.units.values())[0];
    if (!ally || !enemy) throw new Error('expected both factions');
    const allyCoordinate = { q: 2, r: 2 };
    const enemyCoordinate = { q: 4, r: 2 };
    ally.coordinate = { ...allyCoordinate };
    enemy.coordinate = { ...enemyCoordinate };
    ally.currentHealth = 8;
    ally.currentMorale = 25;

    const changes = [allyCoordinate, enemyCoordinate].map((coordinate) => ({
      coordinate,
      tile: roadTile(battle.state.map.tiles[coordinate.r * battle.state.map.width + coordinate.q])
    }));
    setEffectOnlyEvent(battle, [
      { kind: 'transformTerrain', tiles: changes },
      {
        kind: 'revealObjective',
        objective: {
          id: 'newly-revealed-cache',
          kind: 'reach',
          description: 'Secure the newly exposed cache.',
          target: enemyCoordinate,
          optional: true
        }
      },
      {
        kind: 'pressurePulse',
        coordinates: [allyCoordinate],
        targetFaction: 'alliance',
        healthDamage: 30,
        moraleDamage: 30
      }
    ]);

    const triggered = processTacticalEvents(state, bundle);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.units).toEqual([]);
    expect(triggered[0]?.effects.map((effect) => effect.kind)).toEqual([
      'transformTerrain',
      'revealObjective',
      'pressurePulse'
    ]);
    expect(battle.state.timeline.at(-1)).toMatchObject({
      kind: 'scenario:event',
      eventId: 'effect-only',
      effectKinds: ['transformTerrain', 'revealObjective', 'pressurePulse']
    });
    expect(battle.scenario.objectives.filter((objective) => objective.id === 'newly-revealed-cache')).toHaveLength(1);
    expect(ally.coordinate).toEqual(allyCoordinate);
    expect(enemy.coordinate).toEqual(enemyCoordinate);
    expect(changes.every((change) => (
      battle.state.map.tiles[change.coordinate.r * battle.state.map.width + change.coordinate.q].passable
    ))).toBe(true);
    expect(ally.currentHealth).toBe(1);
    expect(ally.currentMorale).toBe(0);
    expect(ally.stance).toBe('routed');
    expect(processTacticalEvents(state, bundle)).toEqual([]);

    const restored = hydrateCampaignState(
      bundle,
      JSON.parse(JSON.stringify(serializeCampaignState(state)))
    );
    const restoredBattle = restored.activeBattle;
    if (!restoredBattle) throw new Error('expected restored battle');
    expect(restoredBattle.scenario.objectives.filter((objective) => objective.id === 'newly-revealed-cache')).toHaveLength(1);
    expect(restoredBattle.state.map.tiles[allyCoordinate.r * restoredBattle.state.map.width + allyCoordinate.q]).toMatchObject({
      terrain: 'road',
      passable: true,
      blocksVision: false
    });
    expect(processTacticalEvents(restored, bundle)).toEqual([]);
    expect(restoredBattle.state.sides.alliance.units.get(ally.id)?.currentHealth).toBe(1);
  });

  it('recomputes faction vision after an event opens a sight line', () => {
    const { state, battle, bundle } = openBattle();
    const viewer = Array.from(battle.state.sides.alliance.units.values())[0];
    if (!viewer) throw new Error('expected Alliance viewer');
    for (const enemy of battle.state.sides.otherSide.units.values()) enemy.stance = 'destroyed';

    const from = { q: 1, r: 1 };
    const blocker = { q: 2, r: 1 };
    const beyond = { q: 3, r: 1 };
    viewer.coordinate = from;
    viewer.stats.vision = 5;
    battle.state.map.tiles[from.r * battle.state.map.width + from.q] = roadTile(
      battle.state.map.tiles[from.r * battle.state.map.width + from.q]
    );
    battle.state.map.tiles[beyond.r * battle.state.map.width + beyond.q] = roadTile(
      battle.state.map.tiles[beyond.r * battle.state.map.width + beyond.q]
    );
    battle.state.map.tiles[blocker.r * battle.state.map.width + blocker.q] = {
      terrain: 'forest',
      elevation: 0,
      cover: 3,
      movementCostModifier: 1.2,
      passable: true,
      providesVisionBoost: false,
      blocksVision: true
    };
    updateAllFactionsVision(battle.state);
    const beyondIndex = beyond.r * battle.state.map.width + beyond.q;
    expect(battle.state.vision.alliance.visibleTiles.has(beyondIndex)).toBe(false);

    setEffectOnlyEvent(battle, [{
      kind: 'transformTerrain',
      tiles: [{ coordinate: blocker, tile: roadTile(battle.state.map.tiles[blocker.r * battle.state.map.width + blocker.q]) }]
    }]);
    processTacticalEvents(state, bundle);

    expect(battle.state.vision.alliance.visibleTiles.has(beyondIndex)).toBe(true);
  });

  it('never damages an embarked passenger and cannot kill its carrier', () => {
    const { state, battle, bundle } = openBattle(
      'sector-strasbourg',
      'commander',
      structuredClone(starterBundle),
      ['m113', 'light-infantry']
    );
    const carrier = Array.from(battle.state.sides.alliance.units.values())
      .find((unit) => unit.definitionId === 'm113');
    const passenger = Array.from(battle.state.sides.alliance.units.values())
      .find((unit) => unit.definitionId === 'light-infantry');
    if (!carrier || !passenger) throw new Error('expected transport pair');
    passenger.embarkedOn = carrier.id;
    passenger.statusEffects.add('embarked');
    passenger.coordinate = { ...carrier.coordinate };
    carrier.carrying = [passenger.id];
    carrier.currentHealth = 5;
    const passengerHealth = passenger.currentHealth;
    const passengerMorale = passenger.currentMorale;

    setEffectOnlyEvent(battle, [{
      kind: 'pressurePulse',
      coordinates: [{ ...carrier.coordinate }],
      targetFaction: 'alliance',
      healthDamage: 30,
      moraleDamage: 30
    }]);
    const [event] = processTacticalEvents(state, bundle);

    expect(carrier.currentHealth).toBe(1);
    expect(carrier.stance).not.toBe('destroyed');
    expect(passenger.currentHealth).toBe(passengerHealth);
    expect(passenger.currentMorale).toBe(passengerMorale);
    expect(event?.effects[0]).toMatchObject({
      kind: 'pressurePulse',
      affectedUnitIds: [carrier.id]
    });
  });

  it('defers chained effect events until the next processing pass', () => {
    const { state, battle, bundle } = openBattle();
    const coordinate = { q: 3, r: 3 };
    battle.scenario.events = [
      {
        id: 'reveal-first',
        triggerRound: 1,
        messageKey: 'lanternArchiveRevealed',
        faction: 'alliance',
        reinforcements: [],
        effects: [{
          kind: 'revealObjective',
          objective: {
            id: 'chain-cache',
            kind: 'reach',
            description: 'Secure the cache.',
            target: coordinate,
            optional: true
          }
        }]
      },
      {
        id: 'open-second',
        triggerRound: 1,
        triggerAfterEventId: 'reveal-first',
        messageKey: 'causewayWardBreaks',
        faction: 'alliance',
        reinforcements: [],
        effects: [{
          kind: 'transformTerrain',
          tiles: [{
            coordinate,
            tile: roadTile(battle.state.map.tiles[coordinate.r * battle.state.map.width + coordinate.q])
          }]
        }]
      }
    ];

    expect(processTacticalEvents(state, bundle).map((event) => event.id)).toEqual(['reveal-first']);
    expect(processTacticalEvents(state, bundle).map((event) => event.id)).toEqual(['open-second']);
    expect(processTacticalEvents(state, bundle)).toEqual([]);
  });

  it('keeps victory stable when an optional objective is revealed after resolution', () => {
    const { state, battle, bundle } = openBattle();
    for (const enemy of battle.state.sides.otherSide.units.values()) {
      enemy.stance = 'destroyed';
      enemy.currentHealth = 0;
    }
    battle.scenario.events = [];
    expect(evaluateBattleOutcome(battle)).toBe('victory');
    battle.resolved = 'victory';

    setEffectOnlyEvent(battle, [{
      kind: 'revealObjective',
      objective: {
        id: 'post-victory-cache',
        kind: 'reach',
        description: 'Secure the cache.',
        target: { q: 3, r: 3 },
        optional: true
      }
    }]);
    processTacticalEvents(state, bundle);

    expect(battle.resolved).toBe('victory');
    expect(evaluateBattleOutcome(battle)).toBe('victory');
  });

  it.each([
    ['sector-lantern-vault', ['revealObjective']],
    ['sector-sable-causeway', ['transformTerrain']],
    ['sector-mnemonic-orchard', ['pressurePulse']],
    ['sector-thorn-engine', ['transformTerrain', 'revealObjective']]
  ] as const)('fires %s player-visible effects even when Story mode suppresses its reserve units', (territoryId, effectKinds) => {
    const { state, battle, bundle } = openBattle(territoryId, 'story');
    const event = battle.scenario.events?.find((candidate) => candidate.effects?.length);
    if (!event) throw new Error(`expected authored effects in ${territoryId}`);
    battle.state.round = event.triggerRound ?? 20;
    if (event.triggerObjectiveId) {
      const objective = battle.scenario.objectives.find((candidate) => (
        candidate.id === event.triggerObjectiveId
      ));
      const specialistRosterId = objective?.unitIds?.[0];
      const specialist = specialistRosterId
        ? battle.state.sides.alliance.units.get(battle.deployment[specialistRosterId])
        : undefined;
      if (!objective?.target || !specialist) throw new Error(`expected specialist trigger for ${territoryId}`);
      battle.state.round = Math.min(battle.state.round, objective.deadlineRound ?? battle.state.round);
      specialist.coordinate = { ...objective.target };
      specialist.actionPoints = specialist.maxActionPoints;
      expect(performObjectiveAction(battle, specialist.id, objective.id).success).toBe(true);
    }

    const triggered = processTacticalEvents(state, bundle);

    expect(triggered).toHaveLength(1);
    expect(triggered[0]?.id).toBe(event.id);
    expect(triggered[0]?.units).toEqual([]);
    expect(triggered[0]?.effects.map((effect) => effect.kind)).toEqual(effectKinds);
  });
});
