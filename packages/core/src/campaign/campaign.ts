import { nanoid } from 'nanoid';

import type {
  CampaignSpec,
  ContentBundle,
  TacticalObjective,
  TacticalScenario,
  TerritorySpec,
  UnitData
} from '@spellcross/data';
import type { HexCoordinate, TacticalBattleState, UnitDefinition } from '../simulation/types.js';
import { coordinateKey } from '../simulation/utils/grid.js';
import { createBattleState } from '../simulation/game-state.js';
import { updateAllFactionsVision } from '../simulation/visibility/vision.js';
import { pushEvent } from './events.js';

export type UnitTier = 'rookie' | 'veteran' | 'elite';

export interface ArmyUnit {
  id: string;
  definitionId: string;
  tier: UnitTier;
  experience: number;
  nickname?: string;
  currentHealth?: number;
  availableOnTurn?: number;
}

export interface Formation {
  id: string;
  name: string;
  units: string[];
  bonus: {
    attack: number;
    defense: number;
    morale: number;
  };
}

export interface ResearchState {
  known: Set<string>;
  completed: Set<string>;
  inProgress?: {
    topicId: string;
    remaining: number;
  };
}

export type TerritoryStatus = 'locked' | 'available' | 'cleared' | 'failed';

export interface TerritoryState extends TerritorySpec {
  status: TerritoryStatus;
  remainingTimer?: number;
}

export interface ActiveBattle {
  territoryId: string;
  scenario: TacticalScenario;
  state: TacticalBattleState;
  deployment: Record<string, string>; // army unit id -> tactical unit id
  startTiles: HexCoordinate[];
  holdProgress: Record<string, number>;
}

export interface CampaignState {
  campaignId: string;
  turn: number;
  globalTimer: number;
  resources: {
    money: number;
    research: number;
    strategic: number;
  };
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  formations: Formation[];
  territories: TerritoryState[];
  research: ResearchState;
  activeBattle?: ActiveBattle;
  log: string[];
  events?: Array<{ turn: number; message: string }>;
  popups?: Array<{ turn: number; title: string; body: string; kind: 'briefing' | 'warning' | 'reward' | 'loss' }>;
}

export interface SerializedCampaignState {
  campaignId: string;
  turn: number;
  globalTimer: number;
  resources: CampaignState['resources'];
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  formations: Formation[];
  territories: TerritoryState[];
  research: {
    known: string[];
    completed: string[];
    inProgress?: ResearchState['inProgress'];
  };
  log: string[];
  events?: Array<{ turn: number; message: string }>;
  popups?: CampaignState['popups'];
}

const tierModifier = (tier: UnitTier) => {
  switch (tier) {
    case 'rookie':
      return { accuracy: 0, morale: 0 };
    case 'veteran':
      return { accuracy: 0.08, morale: 6 };
    case 'elite':
      return { accuracy: 0.12, morale: 12 };
  }
};

const tierCostMultiplier = (tier: UnitTier) => {
  switch (tier) {
    case 'rookie':
      return 1;
    case 'veteran':
      return 1.4;
    case 'elite':
      return 1.8;
  }
};

const findCampaignSpec = (bundle: ContentBundle, id?: string): CampaignSpec => {
  if (id) {
    const spec = bundle.campaigns.find((c) => c.id === id);
    if (!spec) throw new Error(`Campaign ${id} not found`);
    return spec;
  }
  const [first] = bundle.campaigns;
  if (!first) throw new Error('No campaign specs defined');
  return first;
};

const addResearchUnlocksToKnown = (bundle: ContentBundle, topicIds: Iterable<string>): Set<string> => {
  const known = new Set<string>();
  for (const id of topicIds) {
    known.add(id);
    const topic = bundle.research.find((r) => r.id === id);
    if (!topic) continue;
    for (const unlock of topic.unlocks) {
      known.add(unlock);
    }
  }
  return known;
};

const findUnitDef = (bundle: ContentBundle, id: string): UnitData => {
  const def = bundle.units.find((u) => u.id === id);
  if (!def) throw new Error(`Unit ${id} not found in bundle`);
  return def;
};

export function createCampaign(bundle: ContentBundle, campaignId?: string): CampaignState {
  const spec = findCampaignSpec(bundle, campaignId);

  const research: ResearchState = {
    known: addResearchUnlocksToKnown(bundle, spec.startingResearch),
    completed: new Set(spec.startingResearch)
  };

  // Create territories with proper locked/available status based on requires
  const territories: TerritoryState[] = spec.territories.map((t) => {
    // Territory is available if it has no requirements
    const hasRequirements = t.requires && t.requires.length > 0;
    return {
      ...t,
      status: hasRequirements ? 'locked' : 'available',
      remainingTimer: t.timer
    };
  });

  const army: ArmyUnit[] = spec.startingUnits.map((u) => ({
    id: u.id,
    definitionId: u.definitionId,
    tier: u.tier,
    experience: u.experience ?? 0,
    nickname: u.nickname,
    currentHealth: findUnitDef(bundle, u.definitionId).stats.maxHealth
  }));

  const defaultFormation: Formation = {
    id: 'alpha',
    name: 'Task Force Alpha',
    units: army.map((u) => u.id),
    bonus: { attack: 1, defense: 1, morale: 3 }
  };

  return {
    campaignId: spec.id,
    turn: 1,
    globalTimer: 25, // Increased for larger campaign
    resources: { ...spec.startingResources },
    army,
    reserves: [],
    formations: [defaultFormation],
    territories,
    research,
    log: [`Campaign ${spec.name} initialized`],
    events: [],
    popups: []
  };
}

export function convertStrategicToMoney(state: CampaignState, amount: number) {
  if (amount <= 0) return;
  const spend = Math.min(amount, state.resources.strategic);
  state.resources.strategic -= spend;
  state.resources.money += spend;
}

export function convertStrategicToResearch(state: CampaignState, amount: number) {
  if (amount <= 0) return;
  const spend = Math.min(amount, state.resources.strategic);
  state.resources.strategic -= spend;
  state.resources.research += spend * 3;
}

export function isUnitUnlocked(state: CampaignState, bundle: ContentBundle, unitId: string): boolean {
  const spec = findCampaignSpec(bundle, state.campaignId);
  const alreadyFielded =
    state.army.some((u) => u.definitionId === unitId) ||
    state.reserves.some((u) => u.definitionId === unitId) ||
    spec.startingUnits.some((u) => u.definitionId === unitId);

  // If no research explicitly unlocks the unit, it is considered baseline equipment.
  const requiresResearch = bundle.research.some((topic) => topic.unlocks.includes(unitId));
  if (!requiresResearch) return true;
  if (alreadyFielded) return true;
  return state.research.known.has(unitId);
}

export function startResearch(state: CampaignState, bundle: ContentBundle, topicId: string) {
  if (state.research.inProgress) {
    throw new Error('Research already in progress');
  }
  const topic = bundle.research.find((r) => r.id === topicId);
  if (!topic) throw new Error(`Research ${topicId} not found`);
  const unmet = (topic.requires ?? []).filter((req) => !state.research.completed.has(req));
  if (unmet.length) {
    throw new Error(`Missing prerequisites: ${unmet.join(', ')}`);
  }
  state.research.inProgress = { topicId, remaining: topic.cost };
}

export function progressResearch(state: CampaignState, bundle: ContentBundle) {
  if (!state.research.inProgress) return;
  const topic = bundle.research.find((r) => r.id === state.research.inProgress?.topicId);
  if (!topic) return;
  const spend = Math.min(state.resources.research, state.research.inProgress.remaining);
  state.resources.research -= spend;
  state.research.inProgress.remaining -= spend;
  if (state.research.inProgress.remaining <= 0) {
    state.research.completed.add(topic.id);
    for (const unlock of topic.unlocks) {
      state.research.known.add(unlock);
    }
    state.research.inProgress = undefined;
    state.log.push(`Research completed: ${topic.name}`);
  }
}

export function endStrategicTurn(state: CampaignState, bundle: ContentBundle) {
  // Income from cleared territories
  const income = state.territories
    .filter((t) => t.status === 'cleared')
    .reduce(
      (acc, t) => {
        acc.money += t.reward.money;
        acc.research += t.reward.research;
        acc.strategic += t.reward.strategic;
        return acc;
      },
      { money: 0, research: 0, strategic: 0 }
    );

  state.resources.money += income.money;
  state.resources.research += income.research;
  state.resources.strategic += income.strategic;

  // Upkeep: small cost per active army unit
  const upkeep = Math.max(0, Math.floor(state.army.length * 3));
  if (state.resources.money >= upkeep) {
    state.resources.money -= upkeep;
    state.log.push(`Upkeep paid: ${upkeep}`);
  } else {
    state.resources.money = 0;
    state.log.push('Insufficient funds for upkeep; treasury depleted');
  }

  progressResearch(state, bundle);

  for (const territory of state.territories) {
    if (territory.status === 'available' && territory.remainingTimer != null) {
      territory.remainingTimer -= 1;
      if (territory.remainingTimer <= 0) {
        territory.status = 'failed';
        state.log.push(`Territory lost: ${territory.name}`);
        state.events?.push({ turn: state.turn, message: `Territory ${territory.name} lost.` });
      }
    }
  }

  state.globalTimer -= 1;
  if (state.globalTimer <= 0) {
    state.log.push('War clock expired: strategic defeat imminent.');
    for (const t of state.territories) {
      if (t.status === 'available') t.status = 'failed';
    }
  }
  if (state.globalTimer === 5) {
    const title = 'War Clock Critical';
    const body = 'Enemy tempo rising; decisive actions needed before the invasion hardens.';
    state.log.push(title);
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'warning' });
  }

  // Promote ready recruits
  const readyNow = state.reserves.filter((r) => (r.availableOnTurn ?? 0) <= state.turn + 1);
  state.army.push(...readyNow);
  state.reserves = state.reserves.filter((r) => (r.availableOnTurn ?? 0) > state.turn + 1);

  state.turn += 1;

  // Simple scripted events
  if (state.turn === 3) {
    const title = 'Intel: Sorcerers';
    const body = 'Enemy sorcerers sighted near the outpost. Expect ethereal units and protect your command squad.';
    state.log.push(title);
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'briefing' });
  }
  if (state.turn === 5) {
    state.log.push('Command: Reinforcements unlocked via local allies (+20 SP).');
    state.resources.strategic += 20;
    const title = 'Local Allies';
    const body = 'Local militia pledge support. Strategic pool +20; recruit heavier squads sooner.';
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'reward' });
  }
  if (state.turn === 6) {
    state.research.known.add('supply-truck-unlock');
    const title = 'Logistics Online';
    const body = 'Mobile supply corps attached. Supply trucks available as battlefield support.';
    state.log.push(title);
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'reward' });
  }
  if (state.turn === 8) {
    const title = 'Final Assault Authorized';
    const body = 'HQ orders an assault on the Black Spire before the rift stabilizes. Expect elites and beasts.';
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'briefing' });
  }
  if (state.turn === 4) {
    const reinf: ArmyUnit = {
      id: nanoid(6),
      definitionId: 'heavy-infantry',
      tier: 'rookie',
      experience: 0,
      currentHealth: findUnitDef(bundle, 'heavy-infantry').stats.maxHealth,
      availableOnTurn: state.turn + 2
    };
    state.reserves.push(reinf);
    const title = 'Reinforcements En Route';
    const body = 'Storm Squad will arrive in 2 turns. Prepare a landing zone.';
    state.log.push(title);
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'briefing' });
  }

  // Branching counterattack event if the war clock is low or a territory fell
  const counterattackExists = state.territories.some((t) => t.id === 'counterattack');
  const recentLoss = state.territories.some((t) => t.status === 'failed' && (t.remainingTimer ?? 0) <= 0);
  if (!counterattackExists && (recentLoss || state.globalTimer <= 5)) {
    state.territories.push({
      id: 'counterattack',
      name: 'Enemy Counterattack',
      brief: 'Enemy forces counter-attack near the crossroads. Hold them off.',
      scenarioId: 'enemy-counterstrike',
      timer: 3,
      remainingTimer: 3,
      reward: { money: 120, research: 25, strategic: 10 },
      status: 'available'
    });
    const title = 'Enemy Counterattack';
    const body = 'Enemy counterattack detected near Crossroads — respond immediately.';
    state.log.push(title);
    state.events?.push({ turn: state.turn, message: body });
    state.popups?.push({ turn: state.turn, title, body, kind: 'warning' });
  }

  // Periodic raid/retake attempts on cleared sectors every 4 turns
  if (state.turn % 4 === 0) {
    const cleared = state.territories.filter((t) => t.status === 'cleared');
    const fallback = state.territories.filter((t) => t.status === 'available');
    const candidates = cleared.length ? cleared : fallback.length ? fallback : state.territories;
    if (candidates.length) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const raidId = `raid-${target.id}-${state.turn}`;
      const exists = state.territories.some((t) => t.id === raidId);
      if (!exists) {
        state.territories.push({
          id: raidId,
          name: `Enemy Raid near ${target.name}`,
          brief: 'Enemy forces launch a counteroffensive to retake ground. Hold them off.',
          scenarioId: 'enemy-counterstrike',
          timer: 2,
          remainingTimer: 2,
          reward: { money: 90, research: 20, strategic: 10 },
          status: 'available'
        });
        state.log.push(`Enemy raid threatens ${target.name}; rapid response required.`);
        state.events?.push({ turn: state.turn, message: `Enemy raid near ${target.name}. New defense available.` });
      }
    }
  }

  // Safety net raid to ensure at least one counteroffensive appears
  if (state.turn >= 4 && !state.territories.some((t) => t.id === 'enemy-raid-static')) {
    state.territories.push({
      id: 'enemy-raid-static',
      name: 'Enemy Raid',
      brief: 'Hostile force is probing our lines. Repel the raid.',
      scenarioId: 'enemy-counterstrike',
      timer: 2,
      remainingTimer: 2,
      reward: { money: 60, research: 15, strategic: 8 },
      status: 'available'
    });
    state.log.push('Enemy raid detected on the line — immediate response.');
    state.events?.push({ turn: state.turn, message: 'Enemy raid available to defend.' });
  }
}

export function recruitUnit(
  state: CampaignState,
  bundle: ContentBundle,
  definitionId: string,
  tier: UnitTier
): ArmyUnit {
  const def = findUnitDef(bundle, definitionId);
  if (!isUnitUnlocked(state, bundle, def.id)) {
    throw new Error('Unit not unlocked by research');
  }
  const cost = Math.round(def.cost * tierCostMultiplier(tier));
  if (state.resources.money < cost) {
    throw new Error('Not enough money to recruit');
  }

  const availableOnTurn = state.turn + 2;
  const unit: ArmyUnit = {
    id: nanoid(6),
    definitionId: def.id,
    tier,
    experience: tier === 'rookie' ? 0 : tier === 'veteran' ? 25 : 50,
    currentHealth: def.stats.maxHealth,
    availableOnTurn
  };
  state.resources.money -= cost;
  state.reserves.push(unit);
  state.log.push(`Recruited ${def.name} (${tier}) available on turn ${availableOnTurn}`);
  return unit;
}

export function refillUnit(state: CampaignState, bundle: ContentBundle, unitId: string, tier: UnitTier) {
  const unit = state.army.find((u) => u.id === unitId);
  if (!unit) throw new Error('Unit not found');
  const def = findUnitDef(bundle, unit.definitionId);
  const cost = Math.round(def.cost * 0.35 * tierCostMultiplier(tier));
  if (state.resources.money < cost) throw new Error('Not enough money to refill');
  state.resources.money -= cost;
  unit.currentHealth = def.stats.maxHealth;

  // XP impact
  if (tier === 'rookie') {
    unit.experience = Math.floor(unit.experience * 0.6);
  } else if (tier === 'veteran') {
    unit.experience = Math.floor(unit.experience * 0.85);
  }
}

export function rearmUnit(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string,
  newDefinitionId: string
): ArmyUnit {
  const unit = state.army.find((u) => u.id === unitId);
  if (!unit) throw new Error('Unit not found');
  const newDef = findUnitDef(bundle, newDefinitionId);
  if (!isUnitUnlocked(state, bundle, newDef.id)) {
    throw new Error('Unit not unlocked by research');
  }
  const cost = Math.round(newDef.cost * 0.5);
  if (state.resources.money < cost) throw new Error('Not enough money to rearm');

  state.resources.money -= cost;
  unit.definitionId = newDef.id;
  unit.experience = Math.floor(unit.experience * 0.75);
  unit.currentHealth = newDef.stats.maxHealth;
  return unit;
}

export function dismissUnit(state: CampaignState, unitId: string) {
  state.army = state.army.filter((u) => u.id !== unitId);
  state.formations = state.formations.map((f) => ({
    ...f,
    units: f.units.filter((id) => id !== unitId)
  }));
}

const applyTierAdjustments = (definition: UnitData, tier: UnitTier): UnitDefinition => {
  const mod = tierModifier(tier);
  const stats: UnitDefinition['stats'] = {
    ...definition.stats,
    morale: definition.stats.morale + mod.morale,
    weaponAccuracy: Object.fromEntries(
      Object.entries(definition.stats.weaponAccuracy).map(([k, v]) => [k, Math.min(0.98, v + mod.accuracy)])
    )
  };

  return {
    id: definition.id,
    faction: definition.faction,
    name: definition.name,
    type: definition.type,
    stats
  };
};

const applyFormationBonus = (unit: UnitDefinition, bonus?: Formation['bonus']): UnitDefinition => {
  if (!bonus) return unit;
  return {
    ...unit,
    stats: {
      ...unit.stats,
      armor: unit.stats.armor + bonus.defense,
      morale: unit.stats.morale + bonus.morale,
      weaponPower: Object.fromEntries(
        Object.entries(unit.stats.weaponPower).map(([k, v]) => [k, v + bonus.attack])
      )
    }
  };
};

const buildArmySide = (
  state: CampaignState,
  bundle: ContentBundle,
  scenario: TacticalScenario,
  selectedUnitIds?: string[]
): {
  rosterUnits: ArmyUnit[];
  tacticalUnits: Array<{ definition: UnitDefinition; coordinate: HexCoordinate; rosterId: string }>;
  startTiles: HexCoordinate[];
} => {
  const available = state.army
    .filter((u) => (u.availableOnTurn ?? 0) <= state.turn)
    .concat(
      // auto-attach supply truck if unlocked and not already present
      state.research.known.has('supply-truck-unlock')
        ? [
            {
              id: nanoid(6),
              definitionId: 'supply-truck',
              tier: 'rookie',
              experience: 0,
              currentHealth: bundle.units.find((u) => u.id === 'supply-truck')?.stats.maxHealth
            }
          ]
        : []
    )
    .sort((a, b) => {
      const defA = findUnitDef(bundle, a.definitionId);
      const defB = findUnitDef(bundle, b.definitionId);
      const capA = defA.stats.transportCapacity ?? 0;
      const capB = defB.stats.transportCapacity ?? 0;
      return capB - capA;
    });
  let rosterUnits = selectedUnitIds
    ? available.filter((u) => selectedUnitIds.includes(u.id))
    : available;
  const transports = available.filter((u) => (findUnitDef(bundle, u.definitionId).stats.transportCapacity ?? 0) > 0);
  if (!rosterUnits.some((u) => transports.includes(u)) && transports.length > 0) {
    const pick = transports[0];
    rosterUnits = [pick, ...rosterUnits.filter((u) => u.id !== pick.id)];
  }
  const apc = rosterUnits.find((u) => u.definitionId === 'm113');
  if (apc) {
    rosterUnits = [apc, ...rosterUnits.filter((u) => u.id !== apc.id)];
  }
  const startTiles = scenario.startZones.alliance;
  const tacticalUnits: Array<{ definition: UnitDefinition; coordinate: HexCoordinate; rosterId: string }> = [];

  for (let i = 0; i < Math.min(startTiles.length, rosterUnits.length); i++) {
    const roster = rosterUnits[i];
    const baseDef = findUnitDef(bundle, roster.definitionId);
    const tierAdjusted = applyTierAdjustments(baseDef, roster.tier);
    const formation = state.formations.find((f) => f.units.includes(roster.id));
    const withFormation = applyFormationBonus(tierAdjusted, formation?.bonus);
    tacticalUnits.push({
      definition: withFormation,
      coordinate: startTiles[i],
      rosterId: roster.id
    });
  }
  return { rosterUnits, tacticalUnits, startTiles };
};

export function startBattleForTerritory(
  state: CampaignState,
  bundle: ContentBundle,
  territoryId: string,
  selectedUnitIds?: string[]
): ActiveBattle {
  if (state.activeBattle) throw new Error('Battle already in progress');
  const territory = state.territories.find((t) => t.id === territoryId);
  if (!territory) throw new Error('Territory not found');
  if (territory.status !== 'available') throw new Error('Territory not attackable');

  const scenario = bundle.scenarios.find((s) => s.id === territory.scenarioId);
  if (!scenario) throw new Error(`Scenario ${territory.scenarioId} missing`);

  const { tacticalUnits, startTiles } = buildArmySide(state, bundle, scenario, selectedUnitIds);

  const alliedSupport = (scenario.allianceForces ?? []).map((u) => ({
    definition: findUnitDef(bundle, u.definitionId),
    coordinate: u.coordinate
  }));

  const enemyUnits = scenario.otherSideForces.map((unit) => ({
    definition: findUnitDef(bundle, unit.definitionId),
    coordinate: unit.coordinate
  }));

  const battleState = createBattleState({
    map: scenario.map,
    sides: [
      {
        faction: 'alliance',
        units: tacticalUnits
          .map((u) => ({ definition: u.definition, coordinate: u.coordinate }))
          .concat(alliedSupport)
      },
      { faction: 'otherSide', units: enemyUnits }
    ],
    weather: scenario.weather,
    supplyZones: {
      alliance: scenario.startZones.alliance,
      otherSide: scenario.startZones.otherSide
    },
    startingFaction: 'alliance'
  });

  if (scenario.weather === 'night') {
    for (const side of Object.values(battleState.sides)) {
      for (const unit of side.units.values()) {
        unit.stats.vision = Math.max(1, unit.stats.vision - 1);
      }
    }
    updateAllFactionsVision(battleState);
    state.log.push('Night op: visibility reduced for all forces.');
    state.events?.push({ turn: state.turn, message: 'Night conditions: vision reduced by 1.' });
  }
  if (scenario.weather === 'fog') {
    for (const side of Object.values(battleState.sides)) {
      for (const unit of side.units.values()) {
        unit.stats.vision = Math.max(1, unit.stats.vision - 2);
      }
    }
    updateAllFactionsVision(battleState);
    state.log.push('Fog: vision severely reduced.');
    state.events?.push({ turn: state.turn, message: 'Fog banks cut visibility (-2).' });
  }

  const deployment: Record<string, string> = {};
  const allianceUnits = Array.from(battleState.sides.alliance.units.values());
  for (let i = 0; i < allianceUnits.length; i++) {
    const rosterId = tacticalUnits[i]?.rosterId;
    if (rosterId) {
      deployment[rosterId] = allianceUnits[i].id;
      const roster = state.army.find((u) => u.id === rosterId);
      if (roster?.currentHealth != null) {
        allianceUnits[i].currentHealth = Math.min(roster.currentHealth, allianceUnits[i].currentHealth);
      }
    }
  }

  const activeBattle: ActiveBattle = {
    territoryId,
    scenario,
    state: battleState,
    deployment,
    startTiles,
    holdProgress: {}
  };
  state.activeBattle = activeBattle;
  return activeBattle;
}

const isObjectiveMet = (objective: TacticalObjective, battle: ActiveBattle): boolean => {
  switch (objective.kind) {
    case 'eliminate': {
      const remaining = Array.from(battle.state.sides.otherSide.units.values()).filter(
        (u) => u.stance !== 'destroyed'
      );
      return remaining.length === 0;
    }
    case 'reach': {
      if (!objective.target) return false;
      const key = coordinateKey(objective.target);
      return Array.from(battle.state.sides.alliance.units.values()).some(
        (u) => u.stance !== 'destroyed' && coordinateKey(u.coordinate) === key
      );
    }
    case 'protect': {
      const ids = objective.unitIds ?? [];
      for (const rosterId of ids) {
        const tacticalId = battle.deployment[rosterId];
        // If unit is not deployed to this battle, they're safe (not in danger)
        if (!tacticalId) continue;
        const unit = battle.state.sides.alliance.units.get(tacticalId);
        // Only fail if deployed unit was destroyed
        if (!unit || unit.stance === 'destroyed') return false;
      }
      return true;
    }
    case 'hold': {
      if (!objective.target || !objective.turnLimit) return false;
      const key = coordinateKey(objective.target);
      const occupant = Array.from(battle.state.sides.alliance.units.values()).find(
        (u) => u.stance !== 'destroyed' && coordinateKey(u.coordinate) === key
      );
      if (occupant) {
        battle.holdProgress[objective.id] = (battle.holdProgress[objective.id] ?? 0) + 1;
      }
      return (battle.holdProgress[objective.id] ?? 0) >= objective.turnLimit;
    }
    default:
      return false;
  }
};

export function evaluateBattleOutcome(battle: ActiveBattle): 'victory' | 'defeat' | 'ongoing' {
  const defeatByProtect = battle.scenario.objectives.some((o) => o.kind === 'protect' && !isObjectiveMet(o, battle));
  if (defeatByProtect) return 'defeat';

  const allMet = battle.scenario.objectives.every((o) => isObjectiveMet(o, battle));
  if (allMet) return 'victory';

  const survivingAllies = Array.from(battle.state.sides.alliance.units.values()).filter(
    (u) => u.stance !== 'destroyed'
  );
  if (survivingAllies.length === 0) return 'defeat';

  // Victory if all enemies are destroyed (regardless of other objectives)
  const survivingEnemies = Array.from(battle.state.sides.otherSide.units.values()).filter(
    (u) => u.stance !== 'destroyed'
  );
  if (survivingEnemies.length === 0) return 'victory';

  // reach/hold with turn limit missed?
  const turn = battle.state.round;
  const timedFailure = battle.scenario.objectives.some((o) => {
    if (o.turnLimit && o.kind === 'reach' && turn > o.turnLimit + 1) {
      return !isObjectiveMet(o, battle);
    }
    return false;
  });
  if (timedFailure) return 'defeat';

  return 'ongoing';
}

export function retreatFromBattle(state: CampaignState) {
  const battle = state.activeBattle;
  if (!battle) throw new Error('No active battle');
  const startKeys = new Set(battle.startTiles.map((c) => coordinateKey(c)));
  const updatedArmy: ArmyUnit[] = [];
  for (const [rosterId, tacticalId] of Object.entries(battle.deployment)) {
    const roster = state.army.find((u) => u.id === rosterId);
    const unit = battle.state.sides.alliance.units.get(tacticalId);
    if (!roster || !unit) continue;
    const onStartTile = startKeys.has(coordinateKey(unit.coordinate));
    if (unit.stance === 'destroyed' || !onStartTile) {
      continue; // lost during retreat
    }
    roster.currentHealth = unit.currentHealth;
    roster.experience += unit.experience;
    updatedArmy.push(roster);
  }
  state.army = updatedArmy;
  state.activeBattle = undefined;
  state.log.push('Retreated from battle');
}

export function applyBattleOutcome(
  state: CampaignState,
  bundle: ContentBundle,
  result: 'victory' | 'defeat'
) {
  const battle = state.activeBattle;
  if (!battle) throw new Error('No active battle');
  const territory = state.territories.find((t) => t.id === battle.territoryId);
  if (!territory) throw new Error('Territory missing');

  const survivors: ArmyUnit[] = [];
  for (const [rosterId, tacticalId] of Object.entries(battle.deployment)) {
    const roster = state.army.find((u) => u.id === rosterId);
    const unit = battle.state.sides.alliance.units.get(tacticalId);
    if (!roster || !unit) continue;
    if (unit.stance === 'destroyed' || unit.currentHealth <= 0) {
      continue;
    }
    roster.currentHealth = unit.currentHealth;
    roster.experience += unit.experience;
    survivors.push(roster);
  }

  state.army = survivors;

  if (result === 'victory') {
    territory.status = 'cleared';
    territory.remainingTimer = undefined;
    state.resources.money += territory.reward.money;
    state.resources.research += territory.reward.research;
    state.resources.strategic += territory.reward.strategic;
    state.log.push(`Territory secured: ${territory.name}`);

    // Unlock territories whose requirements are now met
    const clearedIds = new Set(
      state.territories.filter(t => t.status === 'cleared').map(t => t.id)
    );

    for (const t of state.territories) {
      if (t.status === 'locked') {
        // Check if all required territories are cleared
        const requires = t.requires ?? [];
        const allRequirementsMet = requires.every(reqId => clearedIds.has(reqId));
        if (allRequirementsMet) {
          t.status = 'available';
          t.remainingTimer = t.timer; // Start the timer when territory becomes available
          state.log.push(`New sector available: ${t.name}`);
        }
      }
    }
  } else {
    territory.status = territory.status === 'available' ? 'available' : 'failed';
    state.log.push(`Defeat at ${territory.name}`);
  }

  state.activeBattle = undefined;
}

export function serializeCampaignState(state: CampaignState): SerializedCampaignState {
  return {
    campaignId: state.campaignId,
    turn: state.turn,
    globalTimer: state.globalTimer,
    resources: { ...state.resources },
    army: structuredClone(state.army),
    reserves: structuredClone(state.reserves),
    formations: structuredClone(state.formations),
    territories: structuredClone(state.territories),
    research: {
      known: Array.from(state.research.known),
      completed: Array.from(state.research.completed),
      inProgress: state.research.inProgress ? { ...state.research.inProgress } : undefined
    },
    log: [...state.log],
    events: state.events ? [...state.events] : undefined
  };
}

export function hydrateCampaignState(bundle: ContentBundle, snapshot: SerializedCampaignState): CampaignState {
  const spec = findCampaignSpec(bundle, snapshot.campaignId);
  const campaignId = snapshot.campaignId ?? spec.id;
  const territoryBase = new Map(spec.territories.map((t) => [t.id, t]));

  const researchKnown = addResearchUnlocksToKnown(bundle, snapshot.research.completed);
  for (const k of snapshot.research.known) {
    researchKnown.add(k);
  }

  const state: CampaignState = {
    campaignId,
    turn: snapshot.turn,
    globalTimer: snapshot.globalTimer ?? 15,
    resources: { ...snapshot.resources },
    army: structuredClone(snapshot.army),
    reserves: structuredClone(snapshot.reserves),
    formations: structuredClone(snapshot.formations),
    territories: snapshot.territories.map((t) => ({
      ...(territoryBase.get(t.id) ?? t),
      status: t.status,
      remainingTimer: t.remainingTimer
    })),
    research: {
      known: researchKnown,
      completed: new Set(snapshot.research.completed),
      inProgress: snapshot.research.inProgress ? { ...snapshot.research.inProgress } : undefined
    },
    activeBattle: undefined,
    log: [...snapshot.log],
    events: snapshot.events ? [...snapshot.events] : []
  };

  return state;
}
