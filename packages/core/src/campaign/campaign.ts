import type {
  CampaignSpec,
  ContentBundle,
  TacticalObjective,
  TacticalScenario,
  TerritorySpec,
  UnitData
} from '@spellcross/data';
import { nanoid } from 'nanoid';

import { createBattleState } from '../simulation/game-state.js';
import type { HexCoordinate, TacticalBattleState, UnitDefinition } from '../simulation/types.js';
import { coordinateKey } from '../simulation/utils/grid.js';
import { updateAllFactionsVision } from '../simulation/visibility/vision.js';

// Core game logic must stay presentation-agnostic (no hardcoded English sentences baked into engine
// state) so the web layer can render campaign narrative in any language. Every log/event/popup carries
// an i18n key + interpolation params instead of a formatted string; the web layer looks the key up in
// its `campaign` translation namespace. Business-rule errors follow the same pattern via CampaignError.
export interface CampaignLogEntry {
  key: string;
  params?: Record<string, string | number>;
}

export class CampaignError extends Error {
  readonly key: string;
  readonly params?: Record<string, string | number>;
  constructor(key: string, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'CampaignError';
    this.key = key;
    this.params = params;
  }
}

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
  // Territories synthesized at runtime (raids/counterattacks) carry an i18n key + params so the UI can
  // render a localized name/brief instead of the hardcoded English `name`/`brief` above (kept as the
  // fallback and as the stable identifier `isGeneratedCounteroffensive` matches against). Territories
  // from the static content bundle have no key here — the UI looks those up by `id` instead.
  nameKey?: string;
  briefKey?: string;
  keyParams?: Record<string, string | number>;
}

export interface ActiveBattle {
  territoryId: string;
  scenario: TacticalScenario;
  state: TacticalBattleState;
  deployment: Record<string, string>; // army unit id -> tactical unit id
  startTiles: HexCoordinate[];
  holdProgress: Record<string, number>;
  // Last battle round in which each hold objective was credited, so progress
  // counts at most once per round regardless of how often outcome is evaluated.
  holdCountedRound: Record<string, number>;
  // True once the player has left deployment. Persisted so a reloaded in-progress battle resumes in
  // normal play (with saved unit positions/AP) instead of re-opening DEPLOYMENT and allowing free moves.
  deployed?: boolean;
  // Set when a battle is decided but the player hasn't yet acknowledged the result card. Persisted so a
  // reload re-shows the card and the win's reward/territory unlock can't be silently lost.
  resolved?: 'victory' | 'defeat';
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
  log: CampaignLogEntry[];
  events?: Array<{ turn: number; key: string; params?: Record<string, string | number> }>;
  popups?: Array<{ turn: number; key: string; params?: Record<string, string | number>; kind: 'briefing' | 'warning' | 'reward' | 'loss' }>;
  // Terminal campaign state: set once the last sector is cleared (victory) or the war clock runs out
  // (defeat). The UI shows a game-over screen; without it both ends were silent no-ops.
  outcome?: 'victory' | 'defeat';
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
  log: CampaignLogEntry[];
  events?: CampaignState['events'];
  popups?: CampaignState['popups'];
  outcome?: 'victory' | 'defeat';
  // Tagged-encoded tactical battle (see encodeActiveBattle); absent when no battle is in progress.
  activeBattle?: unknown;
}

const isGeneratedCounteroffensive = (territory: TerritoryState) =>
  territory.id === 'counterattack'
  || territory.id === 'enemy-raid-static'
  || territory.id.startsWith('raid-')
  || /^Enemy (Counterattack|Raid)/i.test(territory.name);

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
    log: [{ key: 'campaignInitialized', params: { name: spec.name, campaignId: spec.id } }],
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
    throw new CampaignError('researchInProgress', 'Research already in progress');
  }
  const topic = bundle.research.find((r) => r.id === topicId);
  if (!topic) throw new Error(`Research ${topicId} not found`);
  const unmet = (topic.requires ?? []).filter((req) => !state.research.completed.has(req));
  if (unmet.length) {
    throw new CampaignError('missingPrerequisites', `Missing prerequisites: ${unmet.join(', ')}`, { list: unmet.join(', ') });
  }
  state.research.inProgress = { topicId, remaining: topic.cost };
}

export function progressResearch(state: CampaignState, bundle: ContentBundle) {
  if (!state.research.inProgress) return;
  const topic = bundle.research.find((r) => r.id === state.research.inProgress?.topicId);
  if (!topic) {
    // Topic disappeared from the content bundle (rename/removal): clear the slot instead of
    // blocking all future research on a save that can never finish it.
    state.research.inProgress = undefined;
    return;
  }
  const spend = Math.min(state.resources.research, state.research.inProgress.remaining);
  state.resources.research -= spend;
  state.research.inProgress.remaining -= spend;
  if (state.research.inProgress.remaining <= 0) {
    state.research.completed.add(topic.id);
    for (const unlock of topic.unlocks) {
      state.research.known.add(unlock);
    }
    state.research.inProgress = undefined;
    state.log.push({ key: 'researchCompleted', params: { topic: topic.name, topicId: topic.id } });
  }
}

export function endStrategicTurn(state: CampaignState, bundle: ContentBundle) {
  // Income from cleared territories. Generated raids/counterattacks pay only their one-shot victory
  // reward (applyBattleOutcome); letting them pay recurring income too lets you farm an endless economy.
  const income = state.territories
    .filter((t) => t.status === 'cleared' && !isGeneratedCounteroffensive(t))
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
    state.log.push({ key: 'upkeepPaid', params: { amount: upkeep } });
  } else {
    state.resources.money = 0;
    state.log.push({ key: 'upkeepInsufficient' });
  }

  progressResearch(state, bundle);

  let reliefExpiredThisTurn = false;
  const expiredRaidIds: string[] = [];
  for (const territory of state.territories) {
    if (territory.status === 'available' && territory.remainingTimer != null) {
      territory.remainingTimer -= 1;
      if (territory.remainingTimer <= 0) {
        if (isGeneratedCounteroffensive(territory)) {
          // Raid window closed: the attacking force withdraws and the opportunity is gone.
          // Leaving it attackable forever made the timer meaningless.
          expiredRaidIds.push(territory.id);
          if (typeof territory.keyParams?.target === 'string') {
            state.log.push({
              key: 'raidExpired',
              params: { target: territory.keyParams.target, targetId: String(territory.keyParams.targetId ?? '') }
            });
          } else {
            state.log.push({ key: 'raidExpiredGeneric' });
          }
          continue;
        }
        // Timed territories sit on the only path to the final objective; a permanent 'failed' here
        // would make the campaign unwinnable. The relief window is lost but the sector stays clearable.
        territory.remainingTimer = undefined;
        reliefExpiredThisTurn = true;
        state.log.push({ key: 'reliefExpired', params: { territory: territory.name, territoryId: territory.id } });
        state.events?.push({ turn: state.turn, key: 'reliefExpired', params: { territory: territory.name, territoryId: territory.id } });
      }
    }
  }
  if (expiredRaidIds.length > 0) {
    state.territories = state.territories.filter((t) => !expiredRaidIds.includes(t.id));
  }

  state.globalTimer -= 1;
  if (state.globalTimer <= 0 && !state.outcome) {
    // War clock ran out: strategic defeat. Don't permanently flip path sectors to 'failed' (that left
    // the campaign silently unwinnable); instead declare a terminal outcome the UI renders as game-over.
    state.outcome = 'defeat';
    state.log.push({ key: 'warClockExpired' });
    state.popups?.push({ turn: state.turn, key: 'strategicDefeat', kind: 'loss' });
  }
  if (state.globalTimer === 5) {
    state.log.push({ key: 'warClockCritical' });
    state.events?.push({ turn: state.turn, key: 'warClockCritical' });
    state.popups?.push({ turn: state.turn, key: 'warClockCritical', kind: 'warning' });
  }

  // Promote ready recruits
  const readyNow = state.reserves.filter((r) => (r.availableOnTurn ?? 0) <= state.turn + 1);
  state.army.push(...readyNow);
  state.reserves = state.reserves.filter((r) => (r.availableOnTurn ?? 0) > state.turn + 1);

  state.turn += 1;

  // Simple scripted events
  if (state.turn === 3) {
    state.log.push({ key: 'intelSorcerers' });
    state.events?.push({ turn: state.turn, key: 'intelSorcerers' });
    state.popups?.push({ turn: state.turn, key: 'intelSorcerers', kind: 'briefing' });
  }
  if (state.turn === 5) {
    state.log.push({ key: 'localAlliesCommand' });
    state.resources.strategic += 20;
    state.events?.push({ turn: state.turn, key: 'localAllies' });
    state.popups?.push({ turn: state.turn, key: 'localAllies', kind: 'reward' });
  }
  if (state.turn === 6) {
    state.research.known.add('supply-truck-unlock');
    state.log.push({ key: 'logisticsOnline' });
    state.events?.push({ turn: state.turn, key: 'logisticsOnline' });
    state.popups?.push({ turn: state.turn, key: 'logisticsOnline', kind: 'reward' });
  }
  if (state.turn === 8) {
    state.events?.push({ turn: state.turn, key: 'finalAssault' });
    state.popups?.push({ turn: state.turn, key: 'finalAssault', kind: 'briefing' });
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
    state.log.push({ key: 'reinforcementsEnRoute' });
    state.events?.push({ turn: state.turn, key: 'reinforcementsEnRoute' });
    state.popups?.push({ turn: state.turn, key: 'reinforcementsEnRoute', kind: 'briefing' });
  }

  // Branching counterattack event if the war clock is low or a territory fell
  const counterattackExists = state.territories.some((t) => t.id === 'counterattack');
  const recentLoss =
    reliefExpiredThisTurn || state.territories.some((t) => t.status === 'failed' && (t.remainingTimer ?? 0) <= 0);
  if (!counterattackExists && (recentLoss || state.globalTimer <= 5)) {
    state.territories.push({
      id: 'counterattack',
      name: 'Enemy Counterattack',
      brief: 'Enemy forces counter-attack near the crossroads. Hold them off.',
      nameKey: 'dynamic.counterattack.name',
      briefKey: 'dynamic.counterattack.brief',
      scenarioId: 'enemy-counterstrike',
      timer: 3,
      remainingTimer: 3,
      reward: { money: 120, research: 25, strategic: 10 },
      status: 'available'
    });
    state.log.push({ key: 'enemyCounterattack' });
    state.events?.push({ turn: state.turn, key: 'enemyCounterattack' });
    state.popups?.push({ turn: state.turn, key: 'enemyCounterattack', kind: 'warning' });
  }

  // Periodic raid/retake attempts on cleared sectors every 4 turns
  if (state.turn % 4 === 0) {
    const raidTargets = state.territories.filter((t) => !isGeneratedCounteroffensive(t));
    const cleared = raidTargets.filter((t) => t.status === 'cleared');
    const fallback = raidTargets.filter((t) => t.status === 'available');
    const candidates = cleared.length ? cleared : fallback;
    if (candidates.length) {
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      const raidId = `raid-${target.id}-${state.turn}`;
      const exists = state.territories.some((t) => t.id === raidId);
      if (!exists) {
        state.territories.push({
          id: raidId,
          name: `Enemy Raid near ${target.name}`,
          brief: 'Enemy forces launch a counteroffensive to retake ground. Hold them off.',
          nameKey: 'dynamic.raidNear.name',
          briefKey: 'dynamic.raidNear.brief',
          keyParams: { target: target.name, targetId: target.id },
          scenarioId: 'enemy-counterstrike',
          timer: 2,
          remainingTimer: 2,
          reward: { money: 60, research: 15, strategic: 8 },
          status: 'available'
        });
        state.log.push({ key: 'raidThreatens', params: { target: target.name, targetId: target.id } });
        state.events?.push({ turn: state.turn, key: 'raidNear', params: { target: target.name, targetId: target.id } });
      }
    }
  }

  // Safety net raid to ensure at least one counteroffensive appears
  if (state.turn >= 4 && !state.territories.some((t) => t.id === 'enemy-raid-static')) {
    state.territories.push({
      id: 'enemy-raid-static',
      name: 'Enemy Raid',
      brief: 'Hostile force is probing our lines. Repel the raid.',
      nameKey: 'dynamic.staticRaid.name',
      briefKey: 'dynamic.staticRaid.brief',
      scenarioId: 'enemy-counterstrike',
      timer: 2,
      remainingTimer: 2,
      reward: { money: 60, research: 15, strategic: 8 },
      status: 'available'
    });
    state.log.push({ key: 'raidStaticDetected' });
    state.events?.push({ turn: state.turn, key: 'raidStatic' });
  }

  // Both feeds grow every turn and get serialized into every save slot — keep them bounded.
  if (state.log.length > 200) state.log = state.log.slice(-200);
  if (state.events && state.events.length > 200) state.events = state.events.slice(-200);
}

export function recruitUnit(
  state: CampaignState,
  bundle: ContentBundle,
  definitionId: string,
  tier: UnitTier
): ArmyUnit {
  const def = findUnitDef(bundle, definitionId);
  if (!isUnitUnlocked(state, bundle, def.id)) {
    throw new CampaignError('unitNotUnlocked', 'Unit not unlocked by research');
  }
  const cost = Math.round(def.cost * tierCostMultiplier(tier));
  if (state.resources.money < cost) {
    throw new CampaignError('notEnoughMoneyRecruit', 'Not enough money to recruit');
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
  state.log.push({ key: 'unitRecruited', params: { name: def.name, unitId: def.id, tier, turn: availableOnTurn } });
  return unit;
}

export function refillUnit(state: CampaignState, bundle: ContentBundle, unitId: string, tier: UnitTier) {
  const unit = state.army.find((u) => u.id === unitId);
  if (!unit) throw new Error('Unit not found');
  const def = findUnitDef(bundle, unit.definitionId);
  const cost = Math.round(def.cost * 0.35 * tierCostMultiplier(tier));
  if (state.resources.money < cost) throw new CampaignError('notEnoughMoneyRefill', 'Not enough money to refill');
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
    throw new CampaignError('unitNotUnlocked', 'Unit not unlocked by research');
  }
  const cost = Math.round(newDef.cost * 0.5);
  if (state.resources.money < cost) throw new CampaignError('notEnoughMoneyRearm', 'Not enough money to rearm');

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

// Completed research with a statBonus permanently upgrades units of the matching type that you field.
const applyResearchBonus = (state: CampaignState, bundle: ContentBundle, unit: UnitDefinition): UnitDefinition => {
  let armor = 0, power = 0, range = 0, accuracy = 0;
  for (const topic of bundle.research) {
    if (!topic.statBonus || !state.research.completed.has(topic.id)) continue;
    if (topic.applyTo && !topic.applyTo.includes(unit.type as 'infantry')) continue;
    armor += topic.statBonus.armor ?? 0;
    power += topic.statBonus.weaponPower ?? 0;
    range += topic.statBonus.range ?? 0;
    accuracy += topic.statBonus.accuracy ?? 0;
  }
  if (!armor && !power && !range && !accuracy) return unit;
  return {
    ...unit,
    stats: {
      ...unit.stats,
      armor: unit.stats.armor + armor,
      weaponPower: power
        ? Object.fromEntries(Object.entries(unit.stats.weaponPower).map(([k, v]) => [k, v + power]))
        : unit.stats.weaponPower,
      weaponRanges: range
        ? Object.fromEntries(Object.entries(unit.stats.weaponRanges).map(([k, v]) => [k, v + range]))
        : unit.stats.weaponRanges,
      weaponAccuracy: accuracy
        ? Object.fromEntries(Object.entries(unit.stats.weaponAccuracy).map(([k, v]) => [k, Math.min(0.98, v + accuracy)]))
        : unit.stats.weaponAccuracy
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
      state.research.known.has('supply-truck-unlock') &&
      !state.army.some((u) => u.definitionId === 'supply-truck')
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
  const startTiles = scenario.startZones.alliance;
  let rosterUnits = selectedUnitIds
    ? available.filter((u) => selectedUnitIds.includes(u.id))
    : available;
  const transports = available.filter((u) => (findUnitDef(bundle, u.definitionId).stats.transportCapacity ?? 0) > 0);
  // Don't force a transport into an explicit full selection — deployment is truncated to the start
  // zone, so the injected unit would silently evict one the player deliberately picked.
  if (
    !rosterUnits.some((u) => transports.includes(u)) &&
    transports.length > 0 &&
    (!selectedUnitIds || rosterUnits.length < startTiles.length)
  ) {
    const pick = transports[0];
    rosterUnits = [pick, ...rosterUnits.filter((u) => u.id !== pick.id)];
  }
  // Guarantee the auto-attached supply truck a deployment slot — otherwise on small maps with a large
  // roster it sorts out of the deployed set and the resupply feature is unreachable.
  const truck = rosterUnits.find((u) => u.definitionId === 'supply-truck');
  if (truck) {
    rosterUnits = [truck, ...rosterUnits.filter((u) => u.id !== truck.id)];
  }
  const apc = rosterUnits.find((u) => u.definitionId === 'm113');
  if (apc) {
    rosterUnits = [apc, ...rosterUnits.filter((u) => u.id !== apc.id)];
  }
  const tacticalUnits: Array<{ definition: UnitDefinition; coordinate: HexCoordinate; rosterId: string }> = [];

  for (let i = 0; i < Math.min(startTiles.length, rosterUnits.length); i++) {
    const roster = rosterUnits[i];
    const baseDef = findUnitDef(bundle, roster.definitionId);
    const tierAdjusted = applyTierAdjustments(baseDef, roster.tier);
    const formation = state.formations.find((f) => f.units.includes(roster.id));
    const withFormation = applyFormationBonus(tierAdjusted, formation?.bonus);
    const withResearch = applyResearchBonus(state, bundle, withFormation);
    tacticalUnits.push({
      definition: withResearch,
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
  if (state.activeBattle) throw new CampaignError('battleInProgress', 'Battle already in progress');
  const territory = state.territories.find((t) => t.id === territoryId);
  if (!territory) throw new CampaignError('territoryNotFound', 'Territory not found');
  if (territory.status !== 'available') throw new CampaignError('territoryNotAttackable', 'Territory not attackable');

  const scenario = bundle.scenarios.find((s) => s.id === territory.scenarioId);
  if (!scenario) throw new Error(`Scenario ${territory.scenarioId} missing`);

  const { tacticalUnits, startTiles } = buildArmySide(state, bundle, scenario, selectedUnitIds);

  const alliedSupport = (scenario.allianceForces ?? []).map((u) => ({
    definition: findUnitDef(bundle, u.definitionId),
    coordinate: u.coordinate
  }));

  if (tacticalUnits.length + alliedSupport.length === 0) {
    throw new CampaignError('noDeployableUnits', 'No deployable units available for this operation');
  }

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

  // Optics II (thermal/low-light sights) lets our forces shrug off poor visibility; the enemy never does,
  // so researching it turns night/fog from a flat penalty into a real edge.
  const hasOptics = state.research.completed.has('optics-ii');
  if (scenario.weather === 'night') {
    for (const [faction, side] of Object.entries(battleState.sides)) {
      const loss = faction === 'alliance' && hasOptics ? 0 : 1;
      for (const unit of side.units.values()) {
        unit.stats.vision = Math.max(1, unit.stats.vision - loss);
      }
    }
    updateAllFactionsVision(battleState);
    state.log.push({ key: hasOptics ? 'weatherNightThermal' : 'weatherNightReduced' });
    state.events?.push({ turn: state.turn, key: hasOptics ? 'nightThermal' : 'nightReduced' });
  }
  if (scenario.weather === 'fog') {
    for (const [faction, side] of Object.entries(battleState.sides)) {
      const loss = faction === 'alliance' && hasOptics ? 1 : 2;
      for (const unit of side.units.values()) {
        unit.stats.vision = Math.max(1, unit.stats.vision - loss);
      }
    }
    updateAllFactionsVision(battleState);
    state.log.push({ key: hasOptics ? 'weatherFogThermal' : 'weatherFogReduced' });
    state.events?.push({ turn: state.turn, key: hasOptics ? 'fogThermal' : 'fogReduced' });
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
    holdProgress: {},
    holdCountedRound: {}
  };
  state.activeBattle = activeBattle;
  return activeBattle;
}

export const isObjectiveMet = (objective: TacticalObjective, battle: ActiveBattle): boolean => {
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
      // Embarked passengers keep a frozen coordinate at the embark tile — they can't occupy it.
      return Array.from(battle.state.sides.alliance.units.values()).some(
        (u) => u.stance !== 'destroyed' && !u.embarkedOn && coordinateKey(u.coordinate) === key
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
      // A missing turnLimit is schema-valid; treat it as 1 so the objective stays satisfiable
      // instead of silently impossible.
      const limit = objective.turnLimit ?? 1;
      return (battle.holdProgress[objective.id] ?? 0) >= limit;
    }
    default:
      return false;
  }
};

// Credits hold objectives for the current round if their tile is occupied by a
// surviving ally. Idempotent per round: re-evaluating outcome within the same
// round (e.g. after every player action) never double-counts.
function tickHoldProgress(battle: ActiveBattle) {
  const round = battle.state.round;
  for (const objective of battle.scenario.objectives) {
    if (objective.kind !== 'hold' || !objective.target) continue;
    if (battle.holdCountedRound[objective.id] === round) continue;
    const key = coordinateKey(objective.target);
    const held = Array.from(battle.state.sides.alliance.units.values()).some(
      (u) => u.stance !== 'destroyed' && !u.embarkedOn && coordinateKey(u.coordinate) === key
    );
    if (held) {
      battle.holdProgress[objective.id] = (battle.holdProgress[objective.id] ?? 0) + 1;
      battle.holdCountedRound[objective.id] = round;
    }
  }
}

export function evaluateBattleOutcome(battle: ActiveBattle): 'victory' | 'defeat' | 'ongoing' {
  tickHoldProgress(battle);

  const defeatByProtect = battle.scenario.objectives.some((o) => o.kind === 'protect' && !isObjectiveMet(o, battle));
  if (defeatByProtect) return 'defeat';

  const allMet = battle.scenario.objectives.every((o) => isObjectiveMet(o, battle));
  if (allMet) return 'victory';

  // Alternate win: securing the primary objective — reach (extraction flare / far bank / charges) or
  // hold (secure the relay/spire for N rounds) — wins even with enemies alive; protects are enforced
  // above, and routing everyone still wins via the all-enemies-dead shortcut. This makes the brief copy
  // honest on evac, bridgehead, and raid/hold sectors instead of secretly requiring a full wipe too.
  const primaryObjectives = battle.scenario.objectives.filter((o) => o.kind === 'reach' || o.kind === 'hold');
  if (primaryObjectives.length > 0 && primaryObjectives.every((o) => isObjectiveMet(o, battle))) {
    return 'victory';
  }

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
  // Preserve never-deployed (benched) units — they didn't fight, so a retreat can't lose them.
  const deployedRosterIds = new Set(Object.keys(battle.deployment));
  const updatedArmy: ArmyUnit[] = [];
  for (const roster of state.army) {
    if (!deployedRosterIds.has(roster.id)) {
      updatedArmy.push(roster);
      continue;
    }
    const unit = battle.state.sides.alliance.units.get(battle.deployment[roster.id]);
    if (!unit) {
      updatedArmy.push(roster);
      continue;
    }
    // Embarked passengers keep their coordinate frozen at the embark tile — judge them by the
    // carrier's position instead, so riding a transport back to the deploy zone saves them.
    const carrier = unit.embarkedOn ? battle.state.sides.alliance.units.get(unit.embarkedOn) : undefined;
    const effectiveUnit = carrier ?? unit;
    const onStartTile = startKeys.has(coordinateKey(effectiveUnit.coordinate));
    if (unit.stance === 'destroyed' || effectiveUnit.stance === 'destroyed' || !onStartTile) {
      continue; // lost during retreat
    }
    roster.currentHealth = unit.currentHealth;
    roster.experience += unit.experience;
    updatedArmy.push(roster);
  }
  state.army = updatedArmy;
  state.activeBattle = undefined;
  state.log.push({ key: 'battleRetreated' });
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

  // Rebuild the roster while PRESERVING units that were never deployed (benched because the
  // scenario had fewer start tiles than the army). Only deployed units can become casualties;
  // undeployed units never fought and must survive untouched. The ephemeral supply truck is not
  // part of state.army, so it is naturally excluded.
  const deployedRosterIds = new Set(Object.keys(battle.deployment));
  const survivors: ArmyUnit[] = [];
  for (const roster of state.army) {
    if (!deployedRosterIds.has(roster.id)) {
      survivors.push(roster);
      continue;
    }
    const unit = battle.state.sides.alliance.units.get(battle.deployment[roster.id]);
    if (!unit) {
      survivors.push(roster);
      continue;
    }
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
    state.log.push({ key: 'territorySecured', params: { territory: territory.name, territoryId: territory.id } });
    state.popups?.push({
      turn: state.turn,
      key: 'territorySecured',
      params: { territory: territory.name, territoryId: territory.id },
      kind: 'reward'
    });

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
          state.log.push({ key: 'newSectorAvailable', params: { territory: t.name, territoryId: t.id } });
        }
      }
    }

    // Campaign victory: every real sector (excluding generated raids/counterattacks) is cleared.
    const realSectors = state.territories.filter((t) => !isGeneratedCounteroffensive(t));
    if (!state.outcome && realSectors.length > 0 && realSectors.every((t) => t.status === 'cleared')) {
      state.outcome = 'victory';
      state.log.push({ key: 'campaignWon' });
      state.popups?.push({ turn: state.turn, key: 'campaignWon', kind: 'reward' });
    }
  } else {
    territory.status = territory.status === 'available' ? 'available' : 'failed';
    state.log.push({ key: 'defeatAt', params: { territory: territory.name, territoryId: territory.id } });
    state.popups?.push({
      turn: state.turn,
      key: state.army.length === 0 ? 'operationFailedNoArmy' : 'operationFailedWithSurvivors',
      params: { territory: territory.name, territoryId: territory.id },
      kind: 'loss'
    });
  }

  state.activeBattle = undefined;
}

// A tactical battle holds Maps (units per side), Sets (status effects, vision) and
// Infinity ammo. Plain JSON drops Maps/Sets and turns Infinity into null, so we tag
// those on the way out and rebuild them on the way back in.
type BattleJsonTag =
  | { __t: 'Map'; v: [unknown, unknown][] }
  | { __t: 'Set'; v: unknown[] }
  | { __t: 'Inf' }
  | { __t: '-Inf' };

function battleReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return { __t: 'Map', v: Array.from(value.entries()) };
  if (value instanceof Set) return { __t: 'Set', v: Array.from(value.values()) };
  if (value === Infinity) return { __t: 'Inf' };
  if (value === -Infinity) return { __t: '-Inf' };
  return value;
}

function battleReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__t' in (value as Record<string, unknown>)) {
    const tagged = value as BattleJsonTag;
    switch (tagged.__t) {
      case 'Map':
        return new Map(tagged.v);
      case 'Set':
        return new Set(tagged.v);
      case 'Inf':
        return Infinity;
      case '-Inf':
        return -Infinity;
    }
  }
  return value;
}

function encodeActiveBattle(battle: ActiveBattle): unknown {
  return JSON.parse(JSON.stringify(battle, battleReplacer));
}

function decodeActiveBattle(raw: unknown): ActiveBattle {
  return JSON.parse(JSON.stringify(raw), battleReviver) as ActiveBattle;
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
    events: state.events ? [...state.events] : undefined,
    popups: state.popups ? structuredClone(state.popups) : undefined,
    outcome: state.outcome,
    activeBattle: state.activeBattle ? encodeActiveBattle(state.activeBattle) : undefined
  };
}

// Saves written before the i18n refactor stored log entries as raw English strings and popups with
// pre-rendered title/body. Map them onto the 'legacy' passthrough key so old slots still display.
function normalizeLegacyLogEntry(entry: CampaignLogEntry | string): CampaignLogEntry {
  return typeof entry === 'string' ? { key: 'legacy', params: { text: entry } } : entry;
}

type CampaignPopup = NonNullable<CampaignState['popups']>[number];
function normalizeLegacyPopup(
  popup: CampaignPopup | (Omit<CampaignPopup, 'key' | 'params'> & { title: string; body: string })
): CampaignPopup {
  if ('key' in popup) return popup;
  return { turn: popup.turn, key: 'legacy', params: { title: popup.title, body: popup.body }, kind: popup.kind };
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
    // Older builds flipped expired path sectors to 'failed', leaving those campaigns silently
    // unwinnable; normalize them back to attackable on load.
    territories: snapshot.territories.map((t) => ({
      ...(territoryBase.get(t.id) ?? t),
      status: t.status === 'failed' ? 'available' : t.status,
      remainingTimer: t.status === 'failed' ? undefined : t.remainingTimer
    })),
    research: {
      known: researchKnown,
      completed: new Set(snapshot.research.completed),
      inProgress: snapshot.research.inProgress ? { ...snapshot.research.inProgress } : undefined
    },
    activeBattle: snapshot.activeBattle ? decodeActiveBattle(snapshot.activeBattle) : undefined,
    log: snapshot.log.map(normalizeLegacyLogEntry),
    events: snapshot.events ? [...snapshot.events] : [],
    popups: snapshot.popups ? structuredClone(snapshot.popups).map(normalizeLegacyPopup) : [],
    outcome: snapshot.outcome
  };

  return state;
}
