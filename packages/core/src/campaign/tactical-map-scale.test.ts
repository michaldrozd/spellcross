import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  CAMPAIGN_DIFFICULTY_RULES,
  createCampaign,
  evaluateBattleOutcome,
  getEnemyActionBudget,
  getEnemyDecisionBudget,
  getEnemyDifficultyTier,
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
import {
  canAffordMovementCost,
  movementMultiplierForStance
} from '../simulation/pathfinding/movement.js';
import { TurnProcessor } from '../simulation/systems/turn-processor.js';
import type {
  FactionId,
  TacticalBattleState
} from '../simulation/types.js';
import {
  isoDistance,
  isoNeighbors
} from '../simulation/utils/grid-iso.js';

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

const SCALED_EVACUATIONS = [
  ['sector-paris', 1_620, 14]
] as const;

const SCALED_OPERATION_IDS = [
  ...SCALED_EVACUATIONS.map(([territoryId]) => territoryId),
  ...SCALED_CONVOYS.map(([territoryId]) => territoryId),
  ...SCALED_BRIDGEHEADS.map(([territoryId]) => territoryId),
  ...SCALED_HOLD_LINES.map(([territoryId]) => territoryId),
  ...SCALED_SIMPLE_ASSAULTS.map(([territoryId]) => territoryId),
  ...SCALED_RESCUES.map(([territoryId]) => territoryId)
];

function openBattle(
  territoryId: string,
  difficulty: 'commander' | 'veteran' = 'veteran'
) {
  const state = createCampaign(starterBundle, undefined, difficulty);
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
  options: AIContextOptions,
  limits: {
    endTurn?: boolean;
    maxAttacks?: number;
    maxDecisions?: number;
    random?: () => number;
  } = {}
) {
  const processor = new TurnProcessor(battle.state, {
    random: limits.random ?? (() => 0.5)
  });
  const failedUnitIds = new Set<string>();
  const visitedTiles = new Map<string, Set<string>>();
  let executedActions = 0;
  let executedAttacks = 0;
  let outcome: ReturnType<typeof evaluateBattleOutcome> = 'ongoing';

  for (let decision = 0; decision < (limits.maxDecisions ?? 80); decision += 1) {
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
    if (action.type === 'attack' || action.type === 'suppress') {
      executedAttacks += 1;
    }
    outcome = evaluateBattleOutcome(battle);
    if (
      outcome !== 'ongoing'
      || (
        limits.maxAttacks !== undefined
        && executedAttacks >= limits.maxAttacks
      )
    ) break;
  }

  if (
    limits.endTurn !== false
    && outcome === 'ongoing'
    && battle.state.activeFaction === faction
  ) processor.endTurn();
  return executedActions;
}

describe('scaled battlefields', () => {
  it.each(SCALED_EVACUATIONS)(
    'keeps %s captain extraction viable in depth',
    (territoryId, cells, enemyCount) => {
      const { battle } = openBattle(territoryId);
      const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
      const reach = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-reach`
      ));
      const protect = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-protect`
      ));
      if (!captain || !reach?.target || !protect) {
        throw new Error(`missing evacuation objectives for ${territoryId}`);
      }

      const actionPoints = captain.actionPoints;
      captain.actionPoints = 10_000;
      const route = planPathForUnitIso(battle.state, captain.id, reach.target);
      captain.actionPoints = actionPoints;
      expect(battle.state.map.tiles).toHaveLength(cells);
      expect(battle.state.sides.otherSide.units.size).toBe(enemyCount);
      expect(route.success).toBe(true);
      expect(route.path.length).toBeGreaterThan(20);
      expect(battle.scenario.objectives.map((objective) => objective.kind).sort())
        .toEqual(['protect', 'reach']);
      expect(reach).toMatchObject({
        kind: 'reach',
        unitIds: ['captain']
      });
      expect(protect).toMatchObject({
        kind: 'protect',
        unitIds: ['captain']
      });
      expect(reach.essential).not.toBe(true);
      expect(reach.turnLimit).toBeUndefined();
      expect(reach.deadlineRound).toBeUndefined();
      expect(protect.essential).not.toBe(true);
      expect(protect.turnLimit).toBeUndefined();
      expect(protect.deadlineRound).toBeUndefined();
    }
  );

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
      if (evaluateBattleOutcome(battle) !== 'ongoing') break;

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
    expect(rescue.coordinate).toEqual(reach.target);
    expect(isObjectiveMet(reach, battle)).toBe(true);
    expect(Array.from(battle.state.sides.otherSide.units.values())
      .filter((unit) => unit.stance !== 'destroyed').length).toBeGreaterThan(0);
    random.mockRestore();
  }, 15_000);

  it.each(['commander', 'veteran'] as const)(
    'supports a complete escorted Paris evacuation on %s',
    (campaignDifficulty) => {
      let randomState = campaignDifficulty === 'veteran' ? 3 : 0x63d83595;
      const battleRandom = () => {
        randomState |= 0;
        randomState = (randomState + 0x6d2b79f5) | 0;
        let mixed = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
      };
      const random = vi.spyOn(Math, 'random').mockImplementation(battleRandom);
      const territoryId = 'sector-paris';
      const { state, battle } = openBattle(territoryId, campaignDifficulty);
      const difficultyRules = CAMPAIGN_DIFFICULTY_RULES[campaignDifficulty];
      const captain = battle.state.sides.alliance.units.get(battle.deployment.captain);
      const reach = battle.scenario.objectives.find((objective) => (
        objective.id === `${territoryId}-reach`
      ));
      if (!captain || !reach?.target) throw new Error('missing Paris captain');
      const escortRally = {
        q: reach.target.q - 4,
        r: reach.target.r - 4
      };

      let executedActions = 0;
      for (let round = 0; round < 24; round += 1) {
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;
        const targetOccupied = Object.values(battle.state.sides).some((side) => (
          Array.from(side.units.values()).some((unit) => (
            unit.id !== captain.id
            && unit.stance !== 'destroyed'
            && unit.coordinate.q === reach.target!.q
            && unit.coordinate.r === reach.target!.r
          ))
        ));
        if (
          captain.coordinate.q !== reach.target.q
          || captain.coordinate.r !== reach.target.r
        ) {
          const occupied = new Set(Object.values(battle.state.sides).flatMap((side) => (
            Array.from(side.units.values())
              .filter((unit) => unit.id !== captain.id && unit.stance !== 'destroyed')
              .map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`)
          )));
          const movementTargets = targetOccupied
            ? isoNeighbors(battle.state.map, reach.target).filter((coordinate) => (
                !occupied.has(`${coordinate.q},${coordinate.r}`)
              ))
            : [reach.target];
          const availableActionPoints = captain.actionPoints;
          captain.actionPoints = 10_000;
          const fullRoute = movementTargets
            .map((target) => planPathForUnitIso(battle.state, captain.id, target))
            .filter((route) => route.success)
            .sort((left, right) => left.cost - right.cost)[0];
          captain.actionPoints = availableActionPoints;
          expect(fullRoute?.success).toBe(true);
          if (!fullRoute) throw new Error('missing Paris escort route');

          const weatherMultiplier = battle.state.weather === 'fog'
            ? 1.2
            : battle.state.weather === 'night' ? 1.1 : 1;
          const movementMultiplier =
            movementMultiplierForStance(captain.stance) * weatherMultiplier;
          let routeCost = 0;
          const affordablePath: typeof fullRoute.path = [];
          for (const [index, coordinate] of fullRoute.path.entries()) {
            if (affordablePath.length >= 1) break;
            const tile = battle.state.map.tiles[
              coordinate.r * battle.state.map.width + coordinate.q
            ];
            const nextCost = routeCost + tile.movementCostModifier * movementMultiplier;
            if (!canAffordMovementCost(nextCost, availableActionPoints, index + 1)) {
              break;
            }
            routeCost = nextCost;
            affordablePath.push(coordinate);
          }
          if (affordablePath.length > 0) {
            const move = new TurnProcessor(battle.state, { random: battleRandom })
              .moveUnit({ unitId: captain.id, path: affordablePath });
            expect(move.success).toBe(true);
            executedActions += 1;
          }
        }
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;

        const contestProcessor = new TurnProcessor(battle.state, { random: battleRandom });
        for (let attack = 0; attack < 20; attack += 1) {
          const occupier = Array.from(battle.state.sides.otherSide.units.values())
            .find((unit) => (
              unit.stance !== 'destroyed'
              && unit.coordinate.q === reach.target!.q
              && unit.coordinate.r === reach.target!.r
            ));
          if (!occupier || !visibleEnemyIds(battle.state, 'alliance').has(occupier.id)) {
            break;
          }
          const contestAction = decideNextAIAction(battle.state, 'alliance', {
            objectiveTargets: [reach.target],
            objectiveUnitIds: new Set([captain.id]),
            aggression: difficultyRules.playerAutoAggression,
            difficulty: difficultyRules.playerAutoDifficulty,
            allowDemolition: false,
            visibleEnemyIds: visibleEnemyIds(battle.state, 'alliance')
          });
          if (
            (contestAction.type !== 'attack' && contestAction.type !== 'suppress')
            || contestAction.defenderId !== occupier.id
          ) break;
          const execution = executeAiAction(contestProcessor, contestAction);
          expect(execution.success).toBe(true);
          executedActions += 1;
        }
        const captainActionPoints = captain.actionPoints;
        captain.actionPoints = 0;
        executedActions += runAiPhase(battle, 'alliance', {
          objectiveTargets: [escortRally],
          reachTargets: [escortRally],
          defendBias: false,
          aggression: difficultyRules.playerAutoAggression,
          difficulty: difficultyRules.playerAutoDifficulty,
          allowDemolition: false
        }, {
          endTurn: false,
          random: battleRandom
        });
        captain.actionPoints = captainActionPoints;
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;

        const objectiveClear = Array.from(battle.state.sides.otherSide.units.values())
          .every((unit) => (
            unit.stance === 'destroyed'
            || unit.coordinate.q !== reach.target!.q
            || unit.coordinate.r !== reach.target!.r
          ));
        if (
          objectiveClear
          && captain.actionPoints > 0
          && isoDistance(captain.coordinate, reach.target) === 1
          && (
            captain.coordinate.q !== reach.target.q
            || captain.coordinate.r !== reach.target.r
          )
        ) {
          const finalStep = planPathForUnitIso(battle.state, captain.id, reach.target);
          if (finalStep.success && finalStep.path.length > 0) {
            const move = contestProcessor.moveUnit({
              unitId: captain.id,
              path: finalStep.path.slice(0, 1)
            });
            expect(move.success).toBe(true);
            executedActions += 1;
          }
        }

        if (
          evaluateBattleOutcome(battle) === 'ongoing'
          && battle.state.activeFaction === 'alliance'
        ) {
          new TurnProcessor(battle.state, { random: battleRandom }).endTurn();
        }
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;

        const activeEnemies = Array.from(battle.state.sides.otherSide.units.values())
          .filter((unit) => unit.stance !== 'destroyed').length;
        executedActions += runAiPhase(battle, 'otherSide', {
          objectiveTargets: [reach.target],
          defendBias: true,
          difficulty: getEnemyDifficultyTier(campaignDifficulty, 1),
          allowDemolition: true
        }, {
          maxAttacks: getEnemyActionBudget(campaignDifficulty, activeEnemies),
          maxDecisions: getEnemyDecisionBudget(campaignDifficulty, activeEnemies),
          random: battleRandom
        });
        processTacticalEvents(state, starterBundle);
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;
      }

      random.mockRestore();
      expect(evaluateBattleOutcome(battle)).toBe('victory');
      expect(captain.stance).not.toBe('destroyed');
      expect(captain.currentHealth).toBeGreaterThan(campaignDifficulty === 'veteran' ? 80 : 100);
      expect(captain.coordinate).toEqual(reach.target);
      expect(isObjectiveMet(reach, battle)).toBe(true);
      expect(Array.from(battle.state.sides.otherSide.units.values())
        .filter((unit) => unit.stance !== 'destroyed').length).toBeGreaterThan(0);
      expect(executedActions).toBeGreaterThan(0);
    },
    15_000
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
