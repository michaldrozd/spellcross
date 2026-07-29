import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  createCampaign,
  evaluateBattleOutcome,
  isObjectiveMet,
  performObjectiveAction,
  processTacticalEvents,
  serializeCampaignState,
  startBattleForTerritory,
  type ActiveBattle
} from './campaign.js';
import { starterBundle } from '../../../data/src/index.js';
import {
  decideNextAIAction,
  type AIContextOptions,
  type AIImmediateAction
} from '../simulation/ai/baseline-ai.js';
import {
  findPathOnMapIso,
  planPathForUnitIso
} from '../simulation/pathfinding/iso-pathfinder.js';
import { TurnProcessor } from '../simulation/systems/turn-processor.js';
import type {
  FactionId,
  TacticalBattleState
} from '../simulation/types.js';
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

const SCALED_RESCUES = [
  ['sector-brussels', 1_620, 14],
  ['sector-lantern-vault', 2_160, 18],
  ['sector-quiet-meridian', 2_160, 18]
] as const;

const SCALED_OPERATION_IDS = [
  ...SCALED_CONVOYS.map(([territoryId]) => territoryId),
  ...SCALED_BRIDGEHEADS.map(([territoryId]) => territoryId),
  ...SCALED_HOLD_LINES.map(([territoryId]) => territoryId),
  ...SCALED_SIMPLE_ASSAULTS.map(([territoryId]) => territoryId),
  ...SCALED_RESCUES.map(([territoryId]) => territoryId)
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

function visibleEnemyIds(state: TacticalBattleState, faction: FactionId = 'otherSide') {
  const opponent = faction === 'alliance' ? 'otherSide' : 'alliance';
  const visible = state.vision[faction].visibleTiles;
  return new Set(
    Array.from(state.sides[opponent].units.values())
      .filter((unit) => (
        unit.stance !== 'destroyed'
        && !unit.embarkedOn
        && visible.has(unit.coordinate.r * state.map.width + unit.coordinate.q)
      ))
      .map((unit) => unit.id)
  );
}

function runAiPhase(
  battle: ActiveBattle,
  faction: FactionId,
  options: AIContextOptions
) {
  const processor = new TurnProcessor(battle.state, { random: () => 0.5 });
  const failedUnitIds = new Set<string>();
  const visitedTiles = new Map<string, Set<string>>();
  let executedActions = 0;

  for (let decision = 0; decision < 80; decision += 1) {
    const action = decideNextAIAction(battle.state, faction, {
      ...options,
      excludeUnitIds: failedUnitIds,
      visibleEnemyIds: visibleEnemyIds(battle.state, faction)
    });
    if (action.type === 'endTurn') break;

    if (action.type === 'move') {
      const mover = battle.state.sides[faction].units.get(action.unitId);
      const destination = action.path[action.path.length - 1];
      const visited = visitedTiles.get(action.unitId) ?? new Set<string>();
      if (mover) visited.add(`${mover.coordinate.q},${mover.coordinate.r}`);
      if (destination && visited.has(`${destination.q},${destination.r}`)) {
        failedUnitIds.add(action.unitId);
        continue;
      }
      if (destination) visited.add(`${destination.q},${destination.r}`);
      visitedTiles.set(action.unitId, visited);
    }

    const execution = executeAiAction(processor, action);
    if (!execution.success) {
      if ('unitId' in action) failedUnitIds.add(action.unitId);
      else if ('attackerId' in action) failedUnitIds.add(action.attackerId);
      else if ('supplierId' in action) failedUnitIds.add(action.supplierId);
      else if ('medicId' in action) failedUnitIds.add(action.medicId);
      continue;
    }
    executedActions += 1;
    if (evaluateBattleOutcome(battle) === 'defeat') break;
  }

  if (battle.state.activeFaction === faction) processor.endTurn();
  return executedActions;
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

  it.each(SCALED_RESCUES)(
    'keeps %s approach and extraction routes viable in depth',
    (territoryId, cells, enemyCount) => {
      const { battle } = openBattle(territoryId);
      const rescueRosterId = `${territoryId}-pilot`;
      const rescue = battle.state.sides.alliance.units.get(battle.deployment[rescueRosterId]);
      const reach = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-reach`
      ));
      const protect = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-protect`
      ));
      if (!rescue || !reach?.target || !protect) {
        throw new Error(`missing rescue objectives for ${territoryId}`);
      }

      const approachRoutes = Array.from(battle.state.sides.alliance.units.values())
        .filter((unit) => unit.id !== rescue.id)
        .flatMap((unit) => {
          const actionPoints = unit.actionPoints;
          unit.actionPoints = 10_000;
          const routes = battle.state.map.tiles.flatMap((_tile, index) => {
            const coordinate = {
              q: index % battle.state.map.width,
              r: Math.floor(index / battle.state.map.width)
            };
            if (isoDistance(coordinate, rescue.coordinate) > 1) return [];
            const route = planPathForUnitIso(battle.state, unit.id, coordinate);
            return route.success ? [route] : [];
          });
          unit.actionPoints = actionPoints;
          return routes;
        })
        .sort((left, right) => left.cost - right.cost);
      const extractionRoute = findPathOnMapIso(
        battle.state.map,
        rescue.coordinate,
        reach.target,
        { unitType: rescue.unitType }
      );

      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(battle.state.sides.otherSide.units.size).toBe(enemyCount);
      expect(approachRoutes[0]?.path.length).toBeGreaterThan(18);
      expect(extractionRoute.success).toBe(true);
      expect(extractionRoute.path.length).toBeGreaterThanOrEqual(20);
      expect(reach).toMatchObject({
        kind: 'reach',
        unitIds: [rescueRosterId]
      });
      expect(protect).toMatchObject({
        kind: 'protect',
        unitIds: [rescueRosterId]
      });
      expect(reach.turnLimit).toBeUndefined();
      expect(reach.deadlineRound).toBeUndefined();

      const interaction = battle.scenario.objectives.find((objective) => (
        objective.kind === 'interact' && !objective.optional
      ));
      if (territoryId === 'sector-lantern-vault') {
        expect(interaction).toMatchObject({
          unitIds: [rescueRosterId],
          essential: true,
          deadlineRound: 7,
          actionPoints: 2
        });
      } else {
        expect(interaction).toBeUndefined();
      }
    }
  );

  it.each(SCALED_RESCUES)(
    'lets %s complete its rescue objectives while defenders remain',
    (territoryId) => {
      const sourceScenario = starterBundle.scenarios.find((scenario) => (
        scenario.id === `city-${territoryId}`
      ));
      const scenarioBefore = JSON.stringify(sourceScenario);
      const { battle } = openBattle(territoryId);
      const rescueRosterId = `${territoryId}-pilot`;
      const rescue = battle.state.sides.alliance.units.get(battle.deployment[rescueRosterId]);
      const reach = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-reach`
      ));
      if (!rescue || !reach?.target) throw new Error(`missing rescue team for ${territoryId}`);

      const interaction = battle.scenario.objectives.find((objective) => (
        objective.kind === 'interact' && !objective.optional
      ));
      if (interaction?.target) {
        rescue.coordinate = { ...interaction.target };
        expect(performObjectiveAction(battle, rescue.id, interaction.id).success).toBe(true);
      }

      rescue.coordinate = { ...reach.target };
      const defendersBefore = Array.from(battle.state.sides.otherSide.units.values())
        .filter((unit) => unit.stance !== 'destroyed').length;
      expect(evaluateBattleOutcome(battle)).toBe('ongoing');
      const processor = new TurnProcessor(battle.state, { random: () => 0.5 });
      processor.endTurn();
      processor.endTurn();

      expect(evaluateBattleOutcome(battle)).toBe('victory');
      expect(isObjectiveMet(reach, battle)).toBe(true);
      expect(Array.from(battle.state.sides.otherSide.units.values())
        .filter((unit) => unit.stance !== 'destroyed')).toHaveLength(defendersBefore);
      expect(JSON.stringify(sourceScenario)).toBe(scenarioBefore);
    }
  );

  it.each(SCALED_RESCUES)(
    'fails %s when its protected rescue team is lost',
    (territoryId) => {
      const { battle } = openBattle(territoryId);
      const rescue = battle.state.sides.alliance.units.get(
        battle.deployment[`${territoryId}-pilot`]
      );
      if (!rescue) throw new Error(`missing rescue team for ${territoryId}`);

      rescue.currentHealth = 0;
      rescue.stance = 'destroyed';
      expect(evaluateBattleOutcome(battle)).toBe('defeat');
    }
  );

  it('preserves the Lantern Vault specialist deadline on the enlarged map', () => {
    const { battle } = openBattle('sector-lantern-vault');
    const objective = battle.scenario.objectives.find((candidate) => (
      candidate.id === 'sector-lantern-vault-calibrate-prism'
    ));
    if (!objective?.deadlineRound) throw new Error('missing Lantern Vault deadline');

    battle.state.round = objective.deadlineRound + 1;
    expect(evaluateBattleOutcome(battle)).toBe('defeat');
  });

  it('keeps the Brussels rescue team alive through a complete Veteran operation', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const territoryId = 'sector-brussels';
    const { state, battle } = openBattle(territoryId);
    const rescue = battle.state.sides.alliance.units.get(
      battle.deployment[`${territoryId}-pilot`]
    );
    const reach = battle.scenario.objectives.find((objective) => (
      objective.id === `${territoryId}-reach`
    ));
    if (!rescue || !reach?.target) throw new Error('missing Brussels rescue team');

    for (let round = 0; round < 24; round += 1) {
      runAiPhase(battle, 'alliance', {
        objectiveTargets: [reach.target],
        reachTargets: [reach.target],
        objectiveUnitIds: new Set([rescue.id]),
        defendBias: false,
        aggression: 0.85,
        difficulty: 'hard',
        allowDemolition: false
      });
      if (evaluateBattleOutcome(battle) === 'defeat') break;

      runAiPhase(battle, 'otherSide', {
        objectiveTargets: [reach.target],
        defendBias: true,
        aggression: 0.6,
        difficulty: 'hard',
        allowDemolition: true
      });
      processTacticalEvents(state, starterBundle);
      if (evaluateBattleOutcome(battle) !== 'ongoing') break;
    }

    expect(evaluateBattleOutcome(battle)).toBe('victory');
    expect(rescue.stance).not.toBe('destroyed');
    expect(rescue.currentHealth).toBeGreaterThan(0);

    for (let travelRound = 0; travelRound < 8; travelRound += 1) {
      if (
        rescue.coordinate.q === reach.target.q
        && rescue.coordinate.r === reach.target.r
      ) break;

      const actionPoints = rescue.actionPoints;
      rescue.actionPoints = 10_000;
      const fullRoute = planPathForUnitIso(battle.state, rescue.id, reach.target);
      rescue.actionPoints = actionPoints;
      expect(fullRoute.success).toBe(true);

      let routeCost = 0;
      const affordablePath = [];
      for (const coordinate of fullRoute.path) {
        const tile = battle.state.map.tiles[
          coordinate.r * battle.state.map.width + coordinate.q
        ];
        if (routeCost + tile.movementCostModifier > rescue.actionPoints + Number.EPSILON) {
          break;
        }
        routeCost += tile.movementCostModifier;
        affordablePath.push(coordinate);
      }
      expect(affordablePath.length).toBeGreaterThan(0);
      const processor = new TurnProcessor(battle.state, { random: () => 0.5 });
      expect(processor.moveUnit({
        unitId: rescue.id,
        path: affordablePath
      }).success).toBe(true);

      if (
        rescue.coordinate.q !== reach.target.q
        || rescue.coordinate.r !== reach.target.r
      ) {
        processor.endTurn();
        processor.endTurn();
      }
    }

    expect(rescue.coordinate).toEqual(reach.target);
    evaluateBattleOutcome(battle);
    const processor = new TurnProcessor(battle.state, { random: () => 0.5 });
    processor.endTurn();
    processor.endTurn();
    expect(isObjectiveMet(reach, battle)).toBe(true);
    expect(evaluateBattleOutcome(battle)).toBe('victory');
    expect(rescue.stance).not.toBe('destroyed');
    random.mockRestore();
  }, 15_000);

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
        expect(
          execution.success,
          `${territoryId} rejected ${JSON.stringify(action)} with ${JSON.stringify(execution)}`
        ).toBe(true);
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
