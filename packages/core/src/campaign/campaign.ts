import type {
  CampaignSpec,
  ContentBundle,
  EquipmentCategory,
  EquipmentPackage,
  FactionId,
  OfficerProfile,
  OfficerRankSpec,
  TacticalEventMessageKey,
  TacticalObjective,
  TacticalScenario,
  TacticalScenarioEventEffect,
  TerritorySpec,
  UnitData
} from '@spellcross/data';
import { nanoid } from 'nanoid';

import { experienceLevelFor } from '../simulation/combat/experience.js';
import { createBattleState, createUnitInstance } from '../simulation/game-state.js';
import { stanceForMorale } from '../simulation/systems/morale.js';
import type { HexCoordinate, TacticalBattleState, UnitDefinition, UnitInstance } from '../simulation/types.js';
import { isoDistance } from '../simulation/utils/grid-iso.js';
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
  equipment?: Partial<Record<EquipmentCategory, string>>;
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
  commandShockUntilTurn?: number;
}

export type OfficerStatus = 'active' | 'fallen';

export interface Officer {
  id: string;
  profileId: string;
  rankId: string;
  service: number;
  status: OfficerStatus;
  assignedUnitId?: string;
}

export interface ResearchState {
  known: Set<string>;
  completed: Set<string>;
  paused: Record<string, number>;
  inProgress?: {
    topicId: string;
    remaining: number;
  };
}

export type CampaignOperationResult = 'victory' | 'defeat';

export type TerritoryStatus = 'locked' | 'available' | 'cleared' | 'failed' | 'resolved' | 'bypassed';

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
  deploymentExperience?: Record<string, number>; // army unit id -> cumulative XP at deployment
  startTiles: HexCoordinate[];
  holdProgress: Record<string, number>;
  // Last battle round in which each hold objective was credited, so progress
  // counts at most once per round regardless of how often outcome is evaluated.
  holdCountedRound: Record<string, number>;
  // First round in which a reach objective became occupied. Commander and Veteran campaigns require
  // the objective to survive the following enemy phase before it is secured.
  reachClaimedRound: Record<string, number>;
  difficulty: CampaignDifficulty;
  triggeredEventIds: string[];
  completedObjectiveIds: string[];
  // True once the player has left deployment. Persisted so a reloaded in-progress battle resumes in
  // normal play (with saved unit positions/AP) instead of re-opening DEPLOYMENT and allowing free moves.
  deployed?: boolean;
  // Set when a battle is decided but the player hasn't yet acknowledged the result card. Persisted so a
  // reload re-shows the card and the win's reward/territory unlock can't be silently lost.
  resolved?: 'victory' | 'defeat';
}

export type CampaignDifficulty = 'story' | 'commander' | 'veteran';

export interface CampaignDifficultyRules {
  globalTimer: number;
  startingResourceMultiplier: number;
  playerAutoDifficulty: 'easy' | 'normal' | 'hard' | 'brutal';
  playerAutoAggression: number;
  enemyDifficultyOffset: number;
  enemyAttacksPerUnit: number;
  secureReachObjectives: boolean;
  reinforcementBase: number;
}

export const CAMPAIGN_DIFFICULTY_RULES: Record<CampaignDifficulty, CampaignDifficultyRules> = {
  story: {
    globalTimer: 30,
    startingResourceMultiplier: 1.2,
    playerAutoDifficulty: 'hard',
    playerAutoAggression: 0.85,
    enemyDifficultyOffset: -1,
    enemyAttacksPerUnit: 0.35,
    secureReachObjectives: false,
    reinforcementBase: 0
  },
  commander: {
    globalTimer: 25,
    startingResourceMultiplier: 1,
    playerAutoDifficulty: 'normal',
    playerAutoAggression: 0.65,
    enemyDifficultyOffset: 0,
    enemyAttacksPerUnit: 1.25,
    secureReachObjectives: true,
    reinforcementBase: 2
  },
  veteran: {
    globalTimer: 20,
    startingResourceMultiplier: 0.85,
    playerAutoDifficulty: 'normal',
    playerAutoAggression: 0.55,
    enemyDifficultyOffset: 1,
    enemyAttacksPerUnit: 1.75,
    secureReachObjectives: true,
    reinforcementBase: 3
  }
};

export const getCampaignDifficultyRules = (difficulty: CampaignDifficulty) => CAMPAIGN_DIFFICULTY_RULES[difficulty];

const ENEMY_DIFFICULTY_TIERS = ['easy', 'normal', 'hard', 'brutal'] as const;

export const getEnemyDifficultyTier = (campaignDifficulty: CampaignDifficulty, sectorDifficulty: number) => {
  const baseIndex = sectorDifficulty >= 4 ? 3 : sectorDifficulty >= 3 ? 2 : 1;
  const offset = getCampaignDifficultyRules(campaignDifficulty).enemyDifficultyOffset;
  return ENEMY_DIFFICULTY_TIERS[Math.max(0, Math.min(ENEMY_DIFFICULTY_TIERS.length - 1, baseIndex + offset))];
};

export const getEnemyActionBudget = (campaignDifficulty: CampaignDifficulty, activeEnemyCount: number) =>
  Math.max(2, Math.ceil(activeEnemyCount * getCampaignDifficultyRules(campaignDifficulty).enemyAttacksPerUnit));

export const getEnemyDecisionBudget = (campaignDifficulty: CampaignDifficulty, activeEnemyCount: number) => {
  const positioningDecisions = activeEnemyCount;
  const attackDecisions = getEnemyActionBudget(campaignDifficulty, activeEnemyCount);
  const recoveryMargin = Math.max(10, Math.ceil(activeEnemyCount / 2));
  return Math.max(50, positioningDecisions + attackDecisions + recoveryMargin);
};

export interface CampaignState {
  campaignId: string;
  difficulty: CampaignDifficulty;
  turn: number;
  lastOperationTurn?: number;
  globalTimer: number;
  resources: {
    money: number;
    research: number;
    strategic: number;
  };
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  formations: Formation[];
  officers: Officer[];
  territories: TerritoryState[];
  operationResults: Record<string, CampaignOperationResult>;
  actTimeBonusesApplied: Record<string, number>;
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
  // Optional for saves created before campaign difficulty was introduced.
  difficulty?: CampaignDifficulty;
  turn: number;
  lastOperationTurn?: number;
  globalTimer: number;
  resources: CampaignState['resources'];
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  // Optional for saves created before formation management was exposed at HQ.
  formations?: Formation[];
  // Optional for saves created before the persistent officer corps.
  officers?: Officer[];
  territories: TerritoryState[];
  // Optional for saves created before campaign outcome routes were introduced.
  operationResults?: Record<string, CampaignOperationResult>;
  // Optional for saves created before later campaign acts could extend the war clock.
  actTimeBonusesApplied?: Record<string, number>;
  research: {
    known: string[];
    completed: string[];
    paused?: Record<string, number>;
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

const UNIT_TIER_EXPERIENCE_FLOORS: Record<UnitTier, number> = {
  rookie: 0,
  veteran: 25,
  elite: 60
};

const UNIT_TIER_ORDER: UnitTier[] = ['rookie', 'veteran', 'elite'];

export const minimumExperienceForTier = (tier: UnitTier) => UNIT_TIER_EXPERIENCE_FLOORS[tier];

export function unitTierForExperience(experience: number): UnitTier {
  if (experience >= UNIT_TIER_EXPERIENCE_FLOORS.elite) return 'elite';
  if (experience >= UNIT_TIER_EXPERIENCE_FLOORS.veteran) return 'veteran';
  return 'rookie';
}

const normalizeArmyUnitProgression = (unit: ArmyUnit): ArmyUnit => {
  const storedExperience = Number.isFinite(unit.experience) ? Math.max(0, unit.experience) : 0;
  const experience = Math.max(storedExperience, minimumExperienceForTier(unit.tier));
  return {
    ...unit,
    experience,
    tier: unitTierForExperience(experience),
    equipment: { ...(unit.equipment ?? {}) }
  };
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

const initialTerritoryStatus = (territory: TerritorySpec): TerritoryStatus => (
  territory.route || territory.requires?.length || territory.requiresAny?.length ? 'locked' : 'available'
);

const routeSourceIdsFor = (spec: CampaignSpec) => new Set(
  spec.territories.flatMap((territory) => territory.route ? [territory.route.territoryId] : [])
);

const isCompletedTerritory = (territory: TerritoryState) => (
  territory.status === 'cleared' || territory.status === 'resolved'
);

const isTerminalTerritory = (territory: TerritoryState) => (
  isCompletedTerritory(territory) || territory.status === 'bypassed'
);

const refreshCampaignRoutes = (
  state: CampaignState,
  spec: CampaignSpec,
  announceAvailable = false
) => {
  const territoryStates = new Map(state.territories.map((territory) => [territory.id, territory]));

  for (let changed = true; changed;) {
    changed = false;
    for (const territorySpec of spec.territories) {
      const territory = territoryStates.get(territorySpec.id);
      if (!territory || isTerminalTerritory(territory)) continue;

      const requirements = (territorySpec.requires ?? [])
        .map((requirementId) => territoryStates.get(requirementId))
        .filter((requirement): requirement is TerritoryState => Boolean(requirement));
      const anyRequirements = (territorySpec.requiresAny ?? [])
        .map((requirementId) => territoryStates.get(requirementId))
        .filter((requirement): requirement is TerritoryState => Boolean(requirement));
      let nextStatus: TerritoryStatus;

      if (requirements.some((requirement) => requirement.status === 'bypassed')) {
        nextStatus = 'bypassed';
      } else if (!requirements.every(isCompletedTerritory)) {
        nextStatus = 'locked';
      } else if (anyRequirements.length > 0 && anyRequirements.every((requirement) => requirement.status === 'bypassed')) {
        nextStatus = 'bypassed';
      } else if (anyRequirements.length > 0 && !anyRequirements.some(isCompletedTerritory)) {
        nextStatus = 'locked';
      } else if (territorySpec.route) {
        const source = territoryStates.get(territorySpec.route.territoryId);
        const selectedResult = state.operationResults[territorySpec.route.territoryId];
        if (source?.status === 'bypassed' || (selectedResult && selectedResult !== territorySpec.route.result)) {
          nextStatus = 'bypassed';
        } else if (source && isCompletedTerritory(source) && selectedResult === territorySpec.route.result) {
          nextStatus = 'available';
        } else if (
          source?.status === 'failed'
          && selectedResult === territorySpec.route.result
        ) {
          nextStatus = 'available';
        } else {
          nextStatus = 'locked';
        }
      } else {
        nextStatus = 'available';
      }

      if (territory.status === 'failed' && nextStatus === 'available') continue;
      if (territory.status === nextStatus) continue;
      const becameAvailable = nextStatus === 'available';
      territory.status = nextStatus;
      territory.remainingTimer = becameAvailable ? territory.timer : undefined;
      if (becameAvailable && announceAvailable) {
        state.log.push({
          key: 'newSectorAvailable',
          params: { territory: territory.name, territoryId: territory.id }
        });
      }
      changed = true;
    }
  }
};

const campaignIsComplete = (state: CampaignState) => {
  const realSectors = state.territories.filter((territory) => !isGeneratedCounteroffensive(territory));
  return realSectors.length > 0 && realSectors.every(isTerminalTerritory);
};

const applyAvailableActTimeBonuses = (state: CampaignState, spec: CampaignSpec) => {
  if (state.outcome === 'defeat') return;
  for (const bonus of spec.actTimeBonuses ?? []) {
    const actOpen = state.territories.some((territory) => (
      territory.act === bonus.act
      && (territory.status === 'available' || isCompletedTerritory(territory))
    ));
    if (!actOpen) continue;

    const key = String(bonus.act);
    const target = bonus.turns[state.difficulty];
    const applied = state.actTimeBonusesApplied[key] ?? 0;
    if (target <= applied) continue;
    state.globalTimer += target - applied;
    state.actTimeBonusesApplied[key] = target;
  }
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

const STANDARD_FORMATIONS: Array<Omit<Formation, 'units'>> = [
  { id: 'alpha', name: 'Task Force Alpha', bonus: { attack: 1, defense: 1, morale: 3 } },
  { id: 'bravo', name: 'Task Force Bravo', bonus: { attack: 0, defense: 2, morale: 4 } },
  { id: 'charlie', name: 'Task Force Charlie', bonus: { attack: 2, defense: 0, morale: 1 } }
];

export const COMMANDER_FREE_FORMATION_CAPACITY = 6;
export const COMMAND_SHOCK_MORALE_PENALTY = 8;

const createDefaultFormations = (army: ArmyUnit[]): Formation[] => STANDARD_FORMATIONS.map((formation, index) => ({
  ...structuredClone(formation),
  units: index === 0 ? army.map((unit) => unit.id) : []
}));

const normalizeFormations = (formations: Formation[] | undefined, army: ArmyUnit[]): Formation[] => {
  const armyIds = new Set(army.map((unit) => unit.id));
  const claimedUnitIds = new Set<string>();
  const normalized: Formation[] = [];
  const formationIds = new Set<string>();

  for (const formation of formations ?? []) {
    if (!formation?.id || formationIds.has(formation.id)) continue;
    formationIds.add(formation.id);
    // Save order is authoritative: if legacy data lists a unit twice, the first
    // formation claims it and later duplicates are discarded.
    const units = (formation.units ?? []).filter((unitId) => {
      if (!armyIds.has(unitId) || claimedUnitIds.has(unitId)) return false;
      claimedUnitIds.add(unitId);
      return true;
    });
    normalized.push({
      id: formation.id,
      name: formation.name || formation.id,
      units,
      bonus: {
        attack: Number.isFinite(formation.bonus?.attack) ? formation.bonus.attack : 0,
        defense: Number.isFinite(formation.bonus?.defense) ? formation.bonus.defense : 0,
        morale: Number.isFinite(formation.bonus?.morale) ? formation.bonus.morale : 0
      },
      commandShockUntilTurn: Number.isFinite(formation.commandShockUntilTurn)
        ? formation.commandShockUntilTurn
        : undefined
    });
  }

  for (const standard of STANDARD_FORMATIONS) {
    if (formationIds.has(standard.id)) continue;
    formationIds.add(standard.id);
    normalized.push({ ...structuredClone(standard), units: [] });
  }

  if (!normalized.length) return createDefaultFormations(army);
  if (!(formations?.length)) {
    normalized[0].units = army.map((unit) => unit.id);
  }
  return normalized;
};

const normalizeOfficers = (
  bundle: ContentBundle,
  officers: Officer[] | undefined,
  army: ArmyUnit[]
): Officer[] => {
  const profiles = new Set(bundle.officerProfiles.map((profile) => profile.id));
  const ranks = new Set(bundle.officerRanks.map((rank) => rank.id));
  const defaultRankId = bundle.officerRanks[0]?.id;
  const armyById = new Map(army.map((unit) => [unit.id, unit]));
  const seenIds = new Set<string>();
  const seenProfiles = new Set<string>();
  const seenCarriers = new Set<string>();
  const normalized: Officer[] = [];

  for (const officer of officers ?? []) {
    if (
      !officer?.id
      || seenIds.has(officer.id)
      || !profiles.has(officer.profileId)
      || seenProfiles.has(officer.profileId)
      || !defaultRankId
    ) continue;
    seenIds.add(officer.id);
    seenProfiles.add(officer.profileId);
    const status: OfficerStatus = officer.status === 'fallen' ? 'fallen' : 'active';
    const carrier = officer.assignedUnitId ? armyById.get(officer.assignedUnitId) : undefined;
    const carrierDefinition = carrier
      ? bundle.units.find((definition) => definition.id === carrier.definitionId)
      : undefined;
    const assignedUnitId = status === 'active'
      && carrier
      && carrierDefinition?.type !== 'hero'
      && !seenCarriers.has(carrier.id)
      ? carrier.id
      : undefined;
    if (assignedUnitId) seenCarriers.add(assignedUnitId);
    normalized.push({
      id: officer.id,
      profileId: officer.profileId,
      rankId: ranks.has(officer.rankId) ? officer.rankId : defaultRankId,
      service: Math.max(0, Number.isFinite(officer.service) ? Math.floor(officer.service) : 0),
      status,
      assignedUnitId
    });
  }
  return normalized;
};

const normalizeOfficerFormationAssignments = (officers: Officer[], formations: Formation[]) => {
  const ledFormationIds = new Set<string>();
  for (const officer of officers) {
    if (officer.status !== 'active' || !officer.assignedUnitId) continue;
    const formation = formations.find((candidate) => candidate.units.includes(officer.assignedUnitId!));
    if (!formation || ledFormationIds.has(formation.id)) {
      officer.assignedUnitId = undefined;
      continue;
    }
    ledFormationIds.add(formation.id);
  }
};

export function createCampaign(
  bundle: ContentBundle,
  campaignId?: string,
  difficulty: CampaignDifficulty = 'commander'
): CampaignState {
  const spec = findCampaignSpec(bundle, campaignId);
  const difficultyRules = getCampaignDifficultyRules(difficulty);

  const research: ResearchState = {
    known: addResearchUnlocksToKnown(bundle, spec.startingResearch),
    completed: new Set(spec.startingResearch),
    paused: {}
  };

  const territories: TerritoryState[] = spec.territories.map((territory) => {
    const status = initialTerritoryStatus(territory);
    return {
      ...territory,
      status,
      remainingTimer: territory.route ? undefined : territory.timer
    };
  });

  const army: ArmyUnit[] = spec.startingUnits.map((u) => normalizeArmyUnitProgression({
    id: u.id,
    definitionId: u.definitionId,
    tier: u.tier,
    experience: u.experience ?? 0,
    nickname: u.nickname,
    currentHealth: findUnitDef(bundle, u.definitionId).stats.maxHealth
  }));

  const state: CampaignState = {
    campaignId: spec.id,
    difficulty,
    turn: 1,
    globalTimer: difficultyRules.globalTimer,
    resources: Object.fromEntries(
      Object.entries(spec.startingResources).map(([resource, amount]) => [
        resource,
        Math.round(amount * difficultyRules.startingResourceMultiplier)
      ])
    ) as CampaignState['resources'],
    army,
    reserves: [],
    formations: createDefaultFormations(army),
    officers: [],
    territories,
    operationResults: {},
    actTimeBonusesApplied: {},
    research,
    log: [{ key: 'campaignInitialized', params: { name: spec.name, campaignId: spec.id, difficulty } }],
    events: [],
    popups: []
  };
  applyAvailableActTimeBonuses(state, spec);
  return state;
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
  if (state.research.completed.has(topicId)) {
    throw new CampaignError('researchAlreadyCompleted', 'Research already completed');
  }
  const unmet = (topic.requires ?? []).filter((req) => !state.research.completed.has(req));
  if (unmet.length) {
    throw new CampaignError('missingPrerequisites', `Missing prerequisites: ${unmet.join(', ')}`, { list: unmet.join(', ') });
  }
  const pausedRemaining = state.research.paused[topicId];
  state.research.inProgress = {
    topicId,
    remaining: pausedRemaining == null ? topic.cost : Math.min(topic.cost, Math.max(1, pausedRemaining))
  };
  delete state.research.paused[topicId];
  state.log.push({ key: pausedRemaining == null ? 'researchStarted' : 'researchResumed', params: { topic: topic.name, topicId } });
}

export function pauseResearch(state: CampaignState, bundle: ContentBundle) {
  const active = state.research.inProgress;
  if (!active) throw new CampaignError('noResearchInProgress', 'No research in progress');
  const topic = bundle.research.find((candidate) => candidate.id === active.topicId);
  if (!topic) {
    state.research.inProgress = undefined;
    return;
  }
  state.research.paused[active.topicId] = Math.min(topic.cost, Math.max(1, active.remaining));
  state.research.inProgress = undefined;
  state.log.push({ key: 'researchPaused', params: { topic: topic.name, topicId: topic.id } });
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
    delete state.research.paused[topic.id];
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
  if (state.globalTimer === 5 && !state.log.some((entry) => entry.key === 'warClockCritical')) {
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

  const routeSourceIds = routeSourceIdsFor(findCampaignSpec(bundle, state.campaignId));
  for (const territory of state.territories) {
    if (territory.status !== 'failed' || !routeSourceIds.has(territory.id)) continue;
    territory.status = 'available';
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
    experience: minimumExperienceForTier(tier),
    currentHealth: def.stats.maxHealth,
    availableOnTurn
  };
  state.resources.money -= cost;
  state.reserves.push(unit);
  state.log.push({ key: 'unitRecruited', params: { name: def.name, unitId: def.id, tier, turn: availableOnTurn } });
  return unit;
}

const REFILL_EXPERIENCE_RETENTION: Record<UnitTier, number> = {
  rookie: 0.6,
  veteran: 0.85,
  // Elite replacements preserve the veteran cadre; their higher service price pays for that continuity.
  elite: 1
};

export type UnitServiceRequest =
  | { kind: 'refill'; quality: UnitTier }
  | { kind: 'rearm'; definitionId: string };

export interface UnitServiceQuote {
  cost: number;
  experienceAfter: number;
  tierAfter: UnitTier;
  equipmentResetCount: number;
}

export type RearmLockReason = 'nonAlliance' | 'uniqueUnit' | 'noAlternative';

export function getRearmLockReason(bundle: ContentBundle, definitionId: string): RearmLockReason | undefined {
  const definition = findUnitDef(bundle, definitionId);
  if (definition.faction !== 'alliance') return 'nonAlliance';
  if (definition.type === 'hero') return 'uniqueUnit';
  const alternatives = bundle.units.filter((candidate) => (
    candidate.faction === definition.faction
    && candidate.type === definition.type
    && candidate.id !== definition.id
  ));
  return alternatives.length ? undefined : 'noAlternative';
}

export function getUnitRearmOptions(state: CampaignState, bundle: ContentBundle, unitId: string): UnitData[] {
  const unit = state.army.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error('Unit not found');
  if (getRearmLockReason(bundle, unit.definitionId)) return [];
  const currentDefinition = findUnitDef(bundle, unit.definitionId);
  return bundle.units.filter((candidate) => (
    candidate.id !== currentDefinition.id
    && candidate.faction === currentDefinition.faction
    && candidate.type === currentDefinition.type
    && isUnitUnlocked(state, bundle, candidate.id)
  ));
}

export function projectUnitService(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string,
  request: UnitServiceRequest
): UnitServiceQuote {
  const unit = state.army.find((u) => u.id === unitId);
  if (!unit) throw new Error('Unit not found');
  if (request.kind === 'refill') {
    const retention = REFILL_EXPERIENCE_RETENTION[request.quality];
    if (retention == null) throw new Error('Invalid refill quality');
    const definition = findUnitDef(bundle, unit.definitionId);
    const experienceAfter = Math.floor(unit.experience * retention);
    return {
      cost: Math.round(definition.cost * 0.35 * tierCostMultiplier(request.quality)),
      experienceAfter,
      tierAfter: unitTierForExperience(experienceAfter),
      equipmentResetCount: 0
    };
  }
  const currentDefinition = findUnitDef(bundle, unit.definitionId);
  const definition = findUnitDef(bundle, request.definitionId);
  if (getRearmLockReason(bundle, currentDefinition.id)) {
    throw new CampaignError('rearmLocked', 'This unit cannot change equipment');
  }
  if (definition.faction !== currentDefinition.faction || definition.type !== currentDefinition.type) {
    throw new CampaignError('incompatibleRearm', 'Unit can only rearm within its combat category');
  }
  if (definition.id === currentDefinition.id) {
    throw new CampaignError('alreadyEquipped', 'Unit already uses this equipment');
  }
  const experienceAfter = Math.floor(unit.experience * 0.75);
  return {
    cost: Math.round(definition.cost * 0.5),
    experienceAfter,
    tierAfter: unitTierForExperience(experienceAfter),
    equipmentResetCount: Object.keys(unit.equipment ?? {}).length
  };
}

const recordServiceTierChange = (state: CampaignState, bundle: ContentBundle, unit: ArmyUnit, previousTier: UnitTier) => {
  if (unit.tier === previousTier) return;
  const definition = findUnitDef(bundle, unit.definitionId);
  state.log.push({
    key: 'unitTierAdjusted',
    params: { name: definition.name, unitId: definition.id, tier: unit.tier, previousTier }
  });
};

export function refillUnit(state: CampaignState, bundle: ContentBundle, unitId: string, quality: UnitTier) {
  const unit = state.army.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error('Unit not found');
  const definition = findUnitDef(bundle, unit.definitionId);
  if ((unit.currentHealth ?? definition.stats.maxHealth) >= definition.stats.maxHealth) {
    throw new CampaignError('unitAtFullStrength', 'Unit is already at full strength');
  }
  const quote = projectUnitService(state, bundle, unitId, { kind: 'refill', quality });
  if (state.resources.money < quote.cost) throw new CampaignError('notEnoughMoneyRefill', 'Not enough money to refill');
  const previousTier = unit.tier;
  state.resources.money -= quote.cost;
  unit.currentHealth = definition.stats.maxHealth;
  unit.experience = quote.experienceAfter;
  unit.tier = quote.tierAfter;
  recordServiceTierChange(state, bundle, unit, previousTier);
  state.log.push({
    key: 'unitRefilled',
    params: { name: definition.name, unitId: definition.id, quality, cost: quote.cost }
  });
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
  const quote = projectUnitService(state, bundle, unitId, { kind: 'rearm', definitionId: newDefinitionId });
  if (state.resources.money < quote.cost) throw new CampaignError('notEnoughMoneyRearm', 'Not enough money to rearm');

  const previousTier = unit.tier;
  state.resources.money -= quote.cost;
  unit.definitionId = newDef.id;
  unit.experience = quote.experienceAfter;
  unit.tier = quote.tierAfter;
  unit.currentHealth = newDef.stats.maxHealth;
  unit.equipment = {};
  recordServiceTierChange(state, bundle, unit, previousTier);
  state.log.push({
    key: 'unitRearmed',
    params: { name: newDef.name, unitId: newDef.id, cost: quote.cost }
  });
  return unit;
}

const officerProfileFor = (bundle: ContentBundle, profileId: string): OfficerProfile => {
  const profile = bundle.officerProfiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new CampaignError('officerProfileNotFound', 'Officer profile not found');
  return profile;
};

const officerRankFor = (bundle: ContentBundle, rankId: string): OfficerRankSpec => {
  const rank = bundle.officerRanks.find((candidate) => candidate.id === rankId);
  if (!rank) throw new CampaignError('officerRankNotFound', 'Officer rank not found');
  return rank;
};

export interface FormationCommandSummary {
  formationId: string;
  members: number;
  capacity: number;
  overstrength: boolean;
  baseBonus: Formation['bonus'];
  bonus: Formation['bonus'];
  shockMoralePenalty: number;
  officerId?: string;
  officerProfileId?: string;
  officerRankId?: string;
  assignedUnitId?: string;
}

export function getFormationCommand(
  state: CampaignState,
  bundle: ContentBundle,
  formationId: string
): FormationCommandSummary {
  const formation = state.formations.find((candidate) => candidate.id === formationId);
  if (!formation) throw new CampaignError('formationNotFound', 'Formation not found');
  const officer = state.officers.find((candidate) => (
    candidate.status === 'active'
    && candidate.assignedUnitId != null
    && formation.units.includes(candidate.assignedUnitId)
  ));
  const profile = officer ? bundle.officerProfiles.find((candidate) => candidate.id === officer.profileId) : undefined;
  const rank = officer ? bundle.officerRanks.find((candidate) => candidate.id === officer.rankId) : undefined;
  const shockMoralePenalty = (formation.commandShockUntilTurn ?? 0) > state.turn
    ? COMMAND_SHOCK_MORALE_PENALTY
    : 0;
  const bonus = {
    attack: formation.bonus.attack + (profile?.bonus.attack ?? 0) + (rank?.bonus.attack ?? 0),
    defense: formation.bonus.defense + (profile?.bonus.defense ?? 0) + (rank?.bonus.defense ?? 0),
    morale: formation.bonus.morale
      + (profile?.bonus.morale ?? 0)
      + (rank?.bonus.morale ?? 0)
      - shockMoralePenalty
  };
  const capacity = rank?.capacity ?? COMMANDER_FREE_FORMATION_CAPACITY;
  return {
    formationId: formation.id,
    members: formation.units.length,
    capacity,
    overstrength: formation.units.length > capacity,
    baseBonus: { ...formation.bonus },
    bonus,
    shockMoralePenalty,
    officerId: officer?.id,
    officerProfileId: officer?.profileId,
    officerRankId: officer?.rankId,
    assignedUnitId: officer?.assignedUnitId
  };
}

export function recruitOfficer(
  state: CampaignState,
  bundle: ContentBundle,
  profileId: string
): Officer {
  const profile = officerProfileFor(bundle, profileId);
  if (state.officers.some((officer) => officer.profileId === profileId)) {
    throw new CampaignError('officerAlreadyRecruited', 'Officer profile was already recruited');
  }
  if (state.resources.money < profile.recruitCost) {
    throw new CampaignError('notEnoughMoneyOfficer', 'Not enough money to recruit officer');
  }
  const startingRank = bundle.officerRanks[0];
  if (!startingRank) throw new CampaignError('officerRankNotFound', 'Officer rank not found');
  const officer: Officer = {
    id: profile.id,
    profileId: profile.id,
    rankId: startingRank.id,
    service: 0,
    status: 'active'
  };
  state.resources.money -= profile.recruitCost;
  state.officers.push(officer);
  state.log.push({
    key: 'officerRecruited',
    params: { officer: profile.name, officerId: profile.id, cost: profile.recruitCost }
  });
  return officer;
}

export interface OfficerPromotionQuote {
  rankId: string;
  cost: number;
  requiredService: number;
}

export function getOfficerPromotion(
  state: CampaignState,
  bundle: ContentBundle,
  officerId: string
): OfficerPromotionQuote | undefined {
  const officer = state.officers.find((candidate) => candidate.id === officerId);
  if (!officer || officer.status !== 'active') return undefined;
  const currentIndex = bundle.officerRanks.findIndex((rank) => rank.id === officer.rankId);
  const nextRank = bundle.officerRanks[currentIndex + 1];
  return nextRank
    ? {
        rankId: nextRank.id,
        cost: nextRank.promotionCost,
        requiredService: nextRank.requiredService
      }
    : undefined;
}

export function promoteOfficer(
  state: CampaignState,
  bundle: ContentBundle,
  officerId: string
): Officer {
  const officer = state.officers.find((candidate) => candidate.id === officerId);
  if (!officer || officer.status !== 'active') {
    throw new CampaignError('officerUnavailable', 'Officer is not available');
  }
  const quote = getOfficerPromotion(state, bundle, officerId);
  if (!quote) throw new CampaignError('officerAtMaximumRank', 'Officer is already at maximum rank');
  if (officer.service < quote.requiredService) {
    throw new CampaignError('officerServiceRequired', 'Officer needs more service before promotion', {
      required: quote.requiredService,
      current: officer.service
    });
  }
  if (state.resources.money < quote.cost) {
    throw new CampaignError('notEnoughMoneyPromotion', 'Not enough money to promote officer');
  }
  const profile = officerProfileFor(bundle, officer.profileId);
  const rank = officerRankFor(bundle, quote.rankId);
  state.resources.money -= quote.cost;
  officer.rankId = rank.id;
  state.log.push({
    key: 'officerPromoted',
    params: {
      officer: profile.name,
      officerId: profile.id,
      rank: rank.name,
      rankId: rank.id,
      cost: quote.cost
    }
  });
  state.popups?.push({
    turn: state.turn,
    key: 'officerPromoted',
    params: { officer: profile.name, officerId: profile.id, rank: rank.name, rankId: rank.id },
    kind: 'reward'
  });
  return officer;
}

export function assignOfficer(
  state: CampaignState,
  bundle: ContentBundle,
  officerId: string,
  unitId?: string
): Officer {
  const officer = state.officers.find((candidate) => candidate.id === officerId);
  if (!officer || officer.status !== 'active') {
    throw new CampaignError('officerUnavailable', 'Officer is not available');
  }
  const previousFormation = officer.assignedUnitId
    ? state.formations.find((formation) => formation.units.includes(officer.assignedUnitId!))
    : undefined;
  if (!unitId) {
    if (previousFormation && previousFormation.units.length > COMMANDER_FREE_FORMATION_CAPACITY) {
      throw new CampaignError(
        'officerAssignmentWouldExceedCapacity',
        'Reduce the task group before standing down its officer'
      );
    }
    officer.assignedUnitId = undefined;
    state.log.push({
      key: 'officerStoodDown',
      params: { officer: officerProfileFor(bundle, officer.profileId).name, officerId: officer.profileId }
    });
    return officer;
  }
  if (officer.assignedUnitId === unitId) {
    throw new CampaignError('officerAlreadyAssigned', 'Officer is already attached to this unit');
  }
  const unit = state.army.find((candidate) => candidate.id === unitId);
  if (!unit || (unit.availableOnTurn ?? 0) > state.turn) {
    throw new CampaignError('officerCarrierUnavailable', 'Officer carrier is not ready in the field army');
  }
  const definition = findUnitDef(bundle, unit.definitionId);
  if (definition.type === 'hero') {
    throw new CampaignError('officerCarrierHero', 'Hero units cannot carry an officer');
  }
  const targetFormation = state.formations.find((formation) => formation.units.includes(unit.id));
  if (!targetFormation) {
    throw new CampaignError('officerCarrierUnassigned', 'Officer carrier must belong to a task group');
  }
  if (state.officers.some((candidate) => (
    candidate.id !== officer.id
    && candidate.status === 'active'
    && candidate.assignedUnitId === unit.id
  ))) {
    throw new CampaignError('officerCarrierOccupied', 'Unit already carries an officer');
  }
  if (state.officers.some((candidate) => (
    candidate.id !== officer.id
    && candidate.status === 'active'
    && candidate.assignedUnitId != null
    && targetFormation.units.includes(candidate.assignedUnitId)
  ))) {
    throw new CampaignError('formationAlreadyLed', 'Task group already has an officer');
  }
  if (
    previousFormation
    && previousFormation.id !== targetFormation.id
    && previousFormation.units.length > COMMANDER_FREE_FORMATION_CAPACITY
  ) {
    throw new CampaignError(
      'officerAssignmentWouldExceedCapacity',
      'Reduce the former task group before reassigning its officer'
    );
  }
  const rank = officerRankFor(bundle, officer.rankId);
  if (targetFormation.units.length > rank.capacity) {
    throw new CampaignError('formationCapacityExceeded', 'Task group exceeds this officer rank capacity', {
      members: targetFormation.units.length,
      capacity: rank.capacity
    });
  }
  officer.assignedUnitId = unit.id;
  state.log.push({
    key: 'officerAssigned',
    params: {
      officer: officerProfileFor(bundle, officer.profileId).name,
      officerId: officer.profileId,
      formation: targetFormation.name,
      formationId: targetFormation.id,
      unitId: unit.id
    }
  });
  return officer;
}

export function dismissUnit(state: CampaignState, bundle: ContentBundle, unitId: string) {
  const unit = state.army.find((u) => u.id === unitId);
  // The hero anchors evac escort/protect objectives; without him those sectors silently degrade to
  // a full-wipe-only win, so he can't be dismissed.
  if (!unit || findUnitDef(bundle, unit.definitionId).type === 'hero') return;
  const officer = state.officers.find((candidate) => (
    candidate.status === 'active' && candidate.assignedUnitId === unitId
  ));
  const formation = state.formations.find((candidate) => candidate.units.includes(unitId));
  if (officer && formation && formation.units.length - 1 > COMMANDER_FREE_FORMATION_CAPACITY) {
    throw new CampaignError(
      'officerAssignmentWouldExceedCapacity',
      'Reduce the task group before dismissing its officer carrier'
    );
  }
  if (officer) {
    officer.assignedUnitId = undefined;
    state.log.push({
      key: 'officerStoodDown',
      params: { officer: officerProfileFor(bundle, officer.profileId).name, officerId: officer.profileId }
    });
  }
  state.army = state.army.filter((u) => u.id !== unitId);
  state.formations = state.formations.map((f) => ({
    ...f,
    units: f.units.filter((id) => id !== unitId)
  }));
}

export function setUnitFormation(
  state: CampaignState,
  unitId: string,
  formationId?: string,
  bundle?: ContentBundle
) {
  if (!state.army.some((unit) => unit.id === unitId)) {
    throw new CampaignError('unitNotInArmy', 'Unit is not available in the field army');
  }
  const normalized = normalizeFormations(state.formations, state.army);
  if (formationId && !normalized.some((formation) => formation.id === formationId)) {
    throw new CampaignError('formationNotFound', 'Formation not found');
  }
  const currentFormation = normalized.find((formation) => formation.units.includes(unitId));
  if (currentFormation?.id === formationId) return;
  if (state.officers.some((officer) => (
    officer.status === 'active' && officer.assignedUnitId === unitId
  ))) {
    throw new CampaignError('officerCarrierLocked', 'Reassign the officer before moving its carrier');
  }
  if (formationId) {
    const target = normalized.find((formation) => formation.id === formationId)!;
    const capacity = bundle
      ? getFormationCommand({ ...state, formations: normalized }, bundle, formationId).capacity
      : COMMANDER_FREE_FORMATION_CAPACITY;
    if (target.units.length >= capacity) {
      throw new CampaignError('formationCapacityExceeded', 'Task group has reached command capacity', {
        members: target.units.length,
        capacity
      });
    }
  }
  state.formations = normalized.map((formation) => ({
    ...formation,
    units: formation.units.filter((id) => id !== unitId)
  }));
  if (!formationId) return;
  const formation = state.formations.find((candidate) => candidate.id === formationId)!;
  formation.units.push(unitId);
}

const applyTierAdjustments = (definition: UnitData, tier: UnitTier): UnitDefinition => {
  const mod = tierModifier(tier);
  const stats: UnitDefinition['stats'] = {
    ...definition.stats,
    morale: definition.stats.morale + mod.morale,
    weaponAccuracy: Object.fromEntries(
      Object.entries(definition.stats.weaponAccuracy).map(([k, v]) => [k, v + mod.accuracy])
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
        ? Object.fromEntries(Object.entries(unit.stats.weaponAccuracy).map(([k, v]) => [k, v + accuracy]))
        : unit.stats.weaponAccuracy
    }
  };
};

const EQUIPMENT_CATEGORIES: EquipmentCategory[] = ['offense', 'protection', 'mobility'];

const isEquipmentEligibleDefinition = (definition: UnitData) => (
  definition.faction === 'alliance'
  && definition.type !== 'hero'
);

const isEquipmentCategoryEligible = (definition: UnitData, category: EquipmentCategory) => (
  isEquipmentEligibleDefinition(definition)
  && (category !== 'offense' || Object.keys(definition.stats.weaponPower).length > 0)
);

export interface UnitEquipmentOption {
  equipment: EquipmentPackage;
  unlocked: boolean;
  fitted: boolean;
}

export interface UnitEquipmentQuote {
  category: EquipmentCategory;
  equipmentId?: string;
  replacedEquipmentId?: string;
  cost: number;
  before: UnitDefinition['stats'];
  after: UnitDefinition['stats'];
}

const applyEquipmentPackages = (
  unit: UnitDefinition,
  equipment: EquipmentPackage[]
): UnitDefinition => {
  if (equipment.length === 0) return unit;
  const totals = equipment.reduce((sum, candidate) => {
    for (const [stat, modifier] of Object.entries(candidate.modifiers)) {
      sum[stat as keyof typeof sum] += modifier ?? 0;
    }
    return sum;
  }, {
    armor: 0,
    morale: 0,
    mobility: 0,
    vision: 0,
    weaponPower: 0,
    range: 0,
    accuracy: 0
  });
  return {
    ...unit,
    stats: {
      ...unit.stats,
      armor: unit.stats.armor + totals.armor,
      morale: unit.stats.morale + totals.morale,
      mobility: unit.stats.mobility + totals.mobility,
      vision: unit.stats.vision + totals.vision,
      weaponPower: Object.fromEntries(
        Object.entries(unit.stats.weaponPower).map(([weaponId, power]) => [
          weaponId,
          power + totals.weaponPower
        ])
      ),
      weaponRanges: Object.fromEntries(
        Object.entries(unit.stats.weaponRanges).map(([weaponId, range]) => [
          weaponId,
          range + totals.range
        ])
      ),
      weaponAccuracy: Object.fromEntries(
        Object.entries(unit.stats.weaponAccuracy).map(([weaponId, accuracy]) => [
          weaponId,
          accuracy + totals.accuracy
        ])
      )
    }
  };
};

const clampCampaignUnitStats = (unit: UnitDefinition): UnitDefinition => ({
  ...unit,
  stats: {
    ...unit.stats,
    armor: Math.max(0, unit.stats.armor),
    morale: Math.max(0, unit.stats.morale),
    mobility: Math.max(0, unit.stats.mobility),
    vision: Math.max(1, unit.stats.vision),
    weaponPower: Object.fromEntries(
      Object.entries(unit.stats.weaponPower).map(([weaponId, power]) => [weaponId, Math.max(0, power)])
    ),
    weaponRanges: Object.fromEntries(
      Object.entries(unit.stats.weaponRanges).map(([weaponId, range]) => [weaponId, Math.max(1, range)])
    ),
    weaponAccuracy: Object.fromEntries(
      Object.entries(unit.stats.weaponAccuracy).map(([weaponId, accuracy]) => [
        weaponId,
        Math.max(0, Math.min(0.98, accuracy))
      ])
    )
  }
});

const equipmentPackagesForLoadout = (
  state: CampaignState,
  bundle: ContentBundle,
  definition: UnitData,
  loadout: ArmyUnit['equipment']
) => EQUIPMENT_CATEGORIES.flatMap((category) => {
  const equipmentId = loadout?.[category];
  if (!equipmentId) return [];
  const equipment = bundle.equipment.find((candidate) => candidate.id === equipmentId);
  if (
    !equipment
    || equipment.category !== category
    || !isEquipmentCategoryEligible(definition, category)
    || !equipment.applyTo.includes(definition.type)
    || !state.research.completed.has(equipment.requiresResearch)
  ) return [];
  return [equipment];
});

const buildEffectiveArmyUnitDefinition = (
  state: CampaignState,
  bundle: ContentBundle,
  roster: ArmyUnit,
  equipment: ArmyUnit['equipment'] = roster.equipment,
  deployedRosterIds?: ReadonlySet<string>
) => {
  const baseDefinition = findUnitDef(bundle, roster.definitionId);
  const tierAdjusted = applyTierAdjustments(baseDefinition, roster.tier);
  const formation = state.formations.find((candidate) => candidate.units.includes(roster.id));
  const command = formation ? getFormationCommand(state, bundle, formation.id) : undefined;
  const commandBonus = command
    ? deployedRosterIds && command.assignedUnitId && !deployedRosterIds.has(command.assignedUnitId)
      ? {
          ...command.baseBonus,
          morale: command.baseBonus.morale - command.shockMoralePenalty
        }
      : command.bonus
    : undefined;
  const withFormation = applyFormationBonus(tierAdjusted, commandBonus);
  const withResearch = applyResearchBonus(state, bundle, withFormation);
  const packages = equipmentPackagesForLoadout(state, bundle, baseDefinition, equipment);
  return clampCampaignUnitStats(applyEquipmentPackages(withResearch, packages));
};

export function getEffectiveArmyUnitDefinition(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string
): UnitDefinition {
  const unit = state.army.find((candidate) => candidate.id === unitId)
    ?? state.reserves.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error('Unit not found');
  return buildEffectiveArmyUnitDefinition(state, bundle, unit);
}

export function getUnitEquipmentOptions(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string
): UnitEquipmentOption[] {
  const unit = state.army.find((candidate) => candidate.id === unitId);
  if (!unit) return [];
  const definition = findUnitDef(bundle, unit.definitionId);
  if (!isEquipmentEligibleDefinition(definition)) return [];
  return bundle.equipment
    .filter((equipment) => (
      isEquipmentCategoryEligible(definition, equipment.category)
      && equipment.applyTo.includes(definition.type)
    ))
    .map((equipment) => ({
      equipment,
      unlocked: state.research.completed.has(equipment.requiresResearch),
      fitted: unit.equipment?.[equipment.category] === equipment.id
    }));
}

export function projectUnitEquipment(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string,
  category: EquipmentCategory,
  equipmentId?: string
): UnitEquipmentQuote {
  const unit = state.army.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error('Unit not found');
  const definition = findUnitDef(bundle, unit.definitionId);
  if (!isEquipmentCategoryEligible(definition, category)) {
    throw new CampaignError('equipmentIneligible', 'Unit is not eligible for equipment doctrine');
  }
  const fittedId = unit.equipment?.[category];
  if (fittedId === equipmentId) {
    throw new CampaignError('equipmentAlreadyFitted', 'Equipment package is already fitted');
  }

  const equipment = equipmentId
    ? bundle.equipment.find((candidate) => candidate.id === equipmentId)
    : undefined;
  if (equipmentId && !equipment) throw new CampaignError('equipmentUnknown', 'Equipment package not found');
  if (equipment && equipment.category !== category) {
    throw new CampaignError('equipmentCategoryMismatch', 'Equipment package belongs to another category');
  }
  if (equipment && !equipment.applyTo.includes(definition.type)) {
    throw new CampaignError('equipmentIneligible', 'Equipment package is not compatible with this unit');
  }
  if (equipment && !state.research.completed.has(equipment.requiresResearch)) {
    throw new CampaignError('equipmentResearchLocked', 'Equipment package research is not complete');
  }

  const nextLoadout = { ...(unit.equipment ?? {}) };
  if (equipment) nextLoadout[category] = equipment.id;
  else delete nextLoadout[category];
  return {
    category,
    equipmentId: equipment?.id,
    replacedEquipmentId: fittedId,
    cost: equipment?.cost ?? 0,
    before: buildEffectiveArmyUnitDefinition(state, bundle, unit).stats,
    after: buildEffectiveArmyUnitDefinition(state, bundle, unit, nextLoadout).stats
  };
}

export function setUnitEquipment(
  state: CampaignState,
  bundle: ContentBundle,
  unitId: string,
  category: EquipmentCategory,
  equipmentId?: string
): ArmyUnit {
  const quote = projectUnitEquipment(state, bundle, unitId, category, equipmentId);
  if (state.resources.money < quote.cost) {
    throw new CampaignError('notEnoughMoneyEquipment', 'Not enough money to fit equipment');
  }
  const unit = state.army.find((candidate) => candidate.id === unitId)!;
  const definition = findUnitDef(bundle, unit.definitionId);
  const nextLoadout = { ...(unit.equipment ?? {}) };
  if (equipmentId) nextLoadout[category] = equipmentId;
  else delete nextLoadout[category];
  unit.equipment = nextLoadout;
  state.resources.money -= quote.cost;
  const equipment = equipmentId
    ? bundle.equipment.find((candidate) => candidate.id === equipmentId)
    : undefined;
  state.log.push({
    key: equipment ? 'unitEquipmentFitted' : 'unitEquipmentRemoved',
    params: {
      name: definition.name,
      unitId: definition.id,
      category,
      equipment: equipment?.name ?? '',
      equipmentId: equipment?.id ?? '',
      cost: quote.cost
    }
  });
  return unit;
}

export interface OperationDeploymentPlan {
  capacity: number;
  availableUnitIds: string[];
  requiredUnitIds: string[];
  unavailableRequiredUnitIds: string[];
  specialistUnitIds: string[];
  missionSupport: Array<{
    id: string;
    definitionId: string;
    specialist: boolean;
  }>;
  automaticSupportDefinitionIds: string[];
  canDeployWithoutRoster: boolean;
}

const readyArmyUnits = (state: CampaignState) => state.army.filter(
  (unit) => (unit.availableOnTurn ?? 0) <= state.turn
);

const automaticSupportDefinitionIds = (state: CampaignState) => (
  state.research.known.has('supply-truck-unlock')
  && !state.army.some((unit) => unit.definitionId === 'supply-truck')
    ? ['supply-truck']
    : []
);

const requiredRosterUnitIds = (state: CampaignState, scenario: TacticalScenario) => {
  const rosterIds = new Set(state.army.map((unit) => unit.id));
  return Array.from(new Set(scenario.objectives
    .filter((objective) => !objective.optional && (
      objective.kind === 'reach' || objective.kind === 'protect' || objective.kind === 'interact'
    ))
    .flatMap((objective) => objective.unitIds ?? [])
    .filter((unitId) => rosterIds.has(unitId))));
};

export function getOperationDeploymentPlan(
  state: CampaignState,
  bundle: ContentBundle,
  territoryId: string
): OperationDeploymentPlan {
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (!territory) throw new CampaignError('territoryNotFound', 'Territory not found');
  const scenario = bundle.scenarios.find((candidate) => candidate.id === territory.scenarioId);
  if (!scenario) throw new Error(`Scenario ${territory.scenarioId} missing`);
  const readyIds = new Set(readyArmyUnits(state).map((unit) => unit.id));
  const requiredIds = requiredRosterUnitIds(state, scenario);
  const automaticSupport = automaticSupportDefinitionIds(state);
  const specialistSupportIds = new Set(scenario.objectives
    .filter((objective) => !objective.optional && objective.kind === 'interact')
    .flatMap((objective) => objective.unitIds ?? []));
  const requiresPlayerRoster = scenario.objectives.some((objective) => objective.essential);
  return {
    capacity: Math.max(0, scenario.startZones.alliance.length - automaticSupport.length),
    availableUnitIds: readyArmyUnits(state).map((unit) => unit.id),
    requiredUnitIds: requiredIds.filter((unitId) => readyIds.has(unitId)),
    unavailableRequiredUnitIds: requiredIds.filter((unitId) => !readyIds.has(unitId)),
    specialistUnitIds: Array.from(new Set(scenario.objectives
      .filter((objective) => objective.optional && objective.kind === 'interact')
      .flatMap((objective) => objective.unitIds ?? [])
      .filter((unitId) => state.army.some((unit) => unit.id === unitId)))),
    missionSupport: (scenario.allianceForces ?? []).map((unit) => ({
      id: unit.id,
      definitionId: unit.definitionId,
      specialist: specialistSupportIds.has(unit.id)
    })),
    automaticSupportDefinitionIds: automaticSupport,
    canDeployWithoutRoster: !requiresPlayerRoster
      && (automaticSupport.length > 0 || (scenario.allianceForces?.length ?? 0) > 0)
  };
}

const validateOperationSelection = (
  state: CampaignState,
  bundle: ContentBundle,
  territoryId: string,
  selectedUnitIds: string[] | undefined
) => {
  const plan = getOperationDeploymentPlan(state, bundle, territoryId);
  if (plan.unavailableRequiredUnitIds.length) {
    throw new CampaignError('requiredDeploymentUnitUnavailable', 'A mission-critical unit is still in transit', {
      list: plan.unavailableRequiredUnitIds.join(', ')
    });
  }
  if (selectedUnitIds == null) return;
  if (selectedUnitIds.length === 0 && !plan.canDeployWithoutRoster) {
    throw new CampaignError('noDeployableUnits', 'No deployable units available for this operation');
  }
  const uniqueSelected = new Set(selectedUnitIds);
  if (uniqueSelected.size !== selectedUnitIds.length) {
    throw new CampaignError('duplicateDeploymentUnit', 'A unit can only be selected once');
  }
  if (selectedUnitIds.length > plan.capacity) {
    throw new CampaignError('deploymentCapacityExceeded', 'Selected force exceeds deployment capacity', {
      selected: selectedUnitIds.length,
      capacity: plan.capacity
    });
  }
  const availableIds = new Set(plan.availableUnitIds);
  const unavailable = selectedUnitIds.filter((unitId) => !availableIds.has(unitId));
  if (unavailable.length) {
    throw new CampaignError('deploymentUnitUnavailable', 'Selected unit is not ready for deployment');
  }
  const missingRequired = plan.requiredUnitIds.filter((unitId) => !uniqueSelected.has(unitId));
  if (missingRequired.length) {
    throw new CampaignError('requiredDeploymentUnitMissing', 'A mission-critical unit is missing from deployment', {
      list: missingRequired.join(', ')
    });
  }
};

const buildArmySide = (
  state: CampaignState,
  bundle: ContentBundle,
  scenario: TacticalScenario,
  selectedUnitIds?: string[]
): {
  rosterUnits: ArmyUnit[];
  tacticalUnits: Array<{ definition: UnitDefinition; coordinate: HexCoordinate; rosterId: string; experience: number }>;
  startTiles: HexCoordinate[];
} => {
  const automaticSupport: ArmyUnit[] = automaticSupportDefinitionIds(state).map((definitionId) => ({
    id: nanoid(6),
    definitionId,
    tier: 'rookie',
    experience: 0,
    currentHealth: findUnitDef(bundle, definitionId).stats.maxHealth
  }));
  const available = readyArmyUnits(state)
    .concat(automaticSupport)
    .sort((a, b) => {
      const defA = findUnitDef(bundle, a.definitionId);
      const defB = findUnitDef(bundle, b.definitionId);
      const capA = defA.stats.transportCapacity ?? 0;
      const capB = defB.stats.transportCapacity ?? 0;
      return capB - capA;
    });
  const startTiles = scenario.startZones.alliance;
  let rosterUnits = selectedUnitIds
    ? selectedUnitIds.map((unitId) => available.find((unit) => unit.id === unitId)!)
    : available;
  if (selectedUnitIds && automaticSupport.length) {
    rosterUnits = [...automaticSupport, ...rosterUnits];
  }
  const transports = available.filter((u) => (findUnitDef(bundle, u.definitionId).stats.transportCapacity ?? 0) > 0);
  // Don't force a transport into an explicit full selection — deployment is truncated to the start
  // zone, so the injected unit would silently evict one the player deliberately picked.
  if (
    !rosterUnits.some((u) => transports.includes(u)) &&
    transports.length > 0 &&
    !selectedUnitIds
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
  // Roster units named by positional or interaction objectives must never be truncated out of a small
  // start zone. Required specialists authored as scenario support bypass roster capacity entirely.
  const objectiveUnitIds = new Set(scenario.objectives
    .filter((objective) => objective.kind === 'reach' || objective.kind === 'interact')
    .flatMap((objective) => objective.unitIds ?? []));
  if (objectiveUnitIds.size > 0) {
    const objectiveUnits = rosterUnits.filter((unit) => objectiveUnitIds.has(unit.id));
    rosterUnits = [...objectiveUnits, ...rosterUnits.filter((unit) => !objectiveUnitIds.has(unit.id))];
  }
  const tacticalUnits: Array<{ definition: UnitDefinition; coordinate: HexCoordinate; rosterId: string; experience: number }> = [];
  const deployedRosterIds = new Set(
    rosterUnits.slice(0, startTiles.length).map((roster) => roster.id)
  );

  for (let i = 0; i < Math.min(startTiles.length, rosterUnits.length); i++) {
    const roster = rosterUnits[i];
    tacticalUnits.push({
      definition: buildEffectiveArmyUnitDefinition(state, bundle, roster, roster.equipment, deployedRosterIds),
      coordinate: startTiles[i],
      rosterId: roster.id,
      experience: roster.experience
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
  if (state.lastOperationTurn === state.turn) {
    throw new CampaignError('operationAlreadyLaunched', 'An operation has already been launched this turn');
  }
  const territory = state.territories.find((t) => t.id === territoryId);
  if (!territory) throw new CampaignError('territoryNotFound', 'Territory not found');
  if (territory.status !== 'available') throw new CampaignError('territoryNotAttackable', 'Territory not attackable');

  const scenario = bundle.scenarios.find((s) => s.id === territory.scenarioId);
  if (!scenario) throw new Error(`Scenario ${territory.scenarioId} missing`);

  validateOperationSelection(state, bundle, territoryId, selectedUnitIds);

  const { tacticalUnits, startTiles } = buildArmySide(state, bundle, scenario, selectedUnitIds);

  const alliedSupport = (scenario.allianceForces ?? []).map((u) => ({
    scenarioId: u.id,
    definition: findUnitDef(bundle, u.definitionId),
    coordinate: u.coordinate,
    experience: 0
  }));

  if (tacticalUnits.length + alliedSupport.length === 0) {
    throw new CampaignError('noDeployableUnits', 'No deployable units available for this operation');
  }

  const enemyForces = scenario.otherSideForces;

  const enemyUnits = enemyForces.map((unit) => ({
    definition: findUnitDef(bundle, unit.definitionId),
    coordinate: unit.coordinate,
    experience: 0
  }));

  const battleState = createBattleState({
    map: scenario.map,
    sides: [
      {
        faction: 'alliance',
        units: tacticalUnits
          .map((u) => ({ definition: u.definition, coordinate: u.coordinate, experience: u.experience }))
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
  const deploymentExperience: Record<string, number> = {};
  const allianceUnits = Array.from(battleState.sides.alliance.units.values());
  for (let i = 0; i < allianceUnits.length; i++) {
    const rosterId = tacticalUnits[i]?.rosterId;
    if (rosterId) {
      deployment[rosterId] = allianceUnits[i].id;
      const roster = state.army.find((u) => u.id === rosterId);
      deploymentExperience[rosterId] = roster?.experience ?? 0;
      if (roster?.currentHealth != null) {
        allianceUnits[i].currentHealth = Math.min(roster.currentHealth, allianceUnits[i].currentHealth);
      }
    }
  }
  for (let i = 0; i < alliedSupport.length; i += 1) {
    const tacticalUnit = allianceUnits[tacticalUnits.length + i];
    if (tacticalUnit) deployment[alliedSupport[i].scenarioId] = tacticalUnit.id;
  }

  const activeBattle: ActiveBattle = {
    territoryId,
    scenario,
    state: battleState,
    deployment,
    deploymentExperience,
    startTiles,
    holdProgress: {},
    holdCountedRound: {},
    reachClaimedRound: {},
    difficulty: state.difficulty,
    triggeredEventIds: [],
    completedObjectiveIds: []
  };
  if (territory.route && state.operationResults[territory.route.territoryId] === territory.route.result) {
    const routeSource = state.territories.find((candidate) => candidate.id === territory.route?.territoryId);
    if (routeSource && routeSource.status !== 'cleared') routeSource.status = 'resolved';
  }
  state.lastOperationTurn = state.turn;
  state.activeBattle = activeBattle;
  return activeBattle;
}

export type TriggeredTacticalEventEffect =
  | {
      kind: 'revealObjective';
      objectiveId: string;
      coordinates: HexCoordinate[];
    }
  | {
      kind: 'transformTerrain';
      coordinates: HexCoordinate[];
    }
  | {
      kind: 'pressurePulse';
      coordinates: HexCoordinate[];
      affectedUnitIds: string[];
      targetFaction: FactionId;
      healthDamage: number;
      moraleDamage: number;
    };

export interface TriggeredTacticalEvent {
  id: string;
  messageKey: TacticalEventMessageKey;
  faction: FactionId;
  units: Array<{ id: string; coordinate: HexCoordinate }>;
  effects: TriggeredTacticalEventEffect[];
}

const reinforcementCountForBattle = (battle: ActiveBattle, sectorDifficulty = 1) => (
  getCampaignDifficultyRules(battle.difficulty).reinforcementBase
  + (battle.difficulty === 'veteran' && sectorDifficulty >= 4 ? 1 : 0)
);

const pendingHostileReinforcementEvents = (battle: ActiveBattle) => {
  if (reinforcementCountForBattle(battle) === 0) return [];
  const triggered = new Set(battle.triggeredEventIds ?? []);
  return (battle.scenario.events ?? []).filter((event) => (
    event.faction === 'otherSide'
    && event.reinforcements.length > 0
    && !triggered.has(event.id)
  ));
};

const livingUnitCount = (battle: ActiveBattle, faction: FactionId) =>
  Array.from(battle.state.sides[faction].units.values())
    .filter((unit) => unit.stance !== 'destroyed' && !unit.embarkedOn).length;

const openReinforcementCoordinate = (
  battle: ActiveBattle,
  preferred: HexCoordinate,
  occupied: Set<string>
): HexCoordinate | undefined => {
  const { map } = battle.state;
  const available = (coordinate: HexCoordinate) => {
    if (coordinate.q < 0 || coordinate.r < 0 || coordinate.q >= map.width || coordinate.r >= map.height) return false;
    const tile = map.tiles[coordinate.r * map.width + coordinate.q];
    return Boolean(tile?.passable) && !occupied.has(coordinateKey(coordinate));
  };
  if (available(preferred)) return { ...preferred };

  const candidates: HexCoordinate[] = [];
  for (let r = 0; r < map.height; r += 1) {
    for (let q = 0; q < map.width; q += 1) {
      const coordinate = { q, r };
      if (available(coordinate)) candidates.push(coordinate);
    }
  }
  candidates.sort((left, right) => {
    const leftDistance = Math.max(Math.abs(left.q - preferred.q), Math.abs(left.r - preferred.r));
    const rightDistance = Math.max(Math.abs(right.q - preferred.q), Math.abs(right.r - preferred.r));
    return leftDistance - rightDistance || left.r - right.r || left.q - right.q;
  });
  return candidates[0];
};

function applyTacticalEventEffects(
  battle: ActiveBattle,
  effects: TacticalScenarioEventEffect[]
): TriggeredTacticalEventEffect[] {
  const applied: TriggeredTacticalEventEffect[] = [];
  for (const effect of effects) {
    if (effect.kind === 'revealObjective') {
      battle.scenario.objectives.push(structuredClone(effect.objective));
      applied.push({
        kind: effect.kind,
        objectiveId: effect.objective.id,
        coordinates: effect.objective.target ? [{ ...effect.objective.target }] : []
      });
      continue;
    }
    if (effect.kind === 'transformTerrain') {
      for (const change of effect.tiles) {
        battle.state.map.tiles[change.coordinate.r * battle.state.map.width + change.coordinate.q] = {
          ...change.tile
        };
      }
      applied.push({
        kind: effect.kind,
        coordinates: effect.tiles.map((change) => ({ ...change.coordinate }))
      });
      continue;
    }

    const pulseCoordinates = new Set(effect.coordinates.map(coordinateKey));
    const affectedUnitIds: string[] = [];
    for (const unit of battle.state.sides[effect.targetFaction].units.values()) {
      if (
        unit.stance === 'destroyed'
        || unit.embarkedOn
        || !pulseCoordinates.has(coordinateKey(unit.coordinate))
      ) continue;
      unit.currentHealth = Math.max(1, unit.currentHealth - effect.healthDamage);
      unit.currentMorale = Math.max(0, unit.currentMorale - effect.moraleDamage);
      unit.stance = stanceForMorale(unit.currentMorale);
      affectedUnitIds.push(unit.id);
    }
    applied.push({
      kind: effect.kind,
      coordinates: effect.coordinates.map((coordinate) => ({ ...coordinate })),
      affectedUnitIds,
      targetFaction: effect.targetFaction,
      healthDamage: effect.healthDamage,
      moraleDamage: effect.moraleDamage
    });
  }
  return applied;
}

export function processTacticalEvents(
  state: CampaignState,
  bundle: ContentBundle
): TriggeredTacticalEvent[] {
  const battle = state.activeBattle;
  if (!battle || battle.state.activeFaction !== 'alliance') return [];

  battle.triggeredEventIds ??= [];
  const triggered = new Set(battle.triggeredEventIds);
  const triggeredBeforeProcessing = new Set(triggered);
  const enemyRemaining = livingUnitCount(battle, 'otherSide');
  const sectorDifficulty = state.territories.find((territory) => territory.id === battle.territoryId)?.difficulty ?? 1;
  const waveSize = reinforcementCountForBattle(battle, sectorDifficulty);
  const triggeredEvents: TriggeredTacticalEvent[] = [];
  let terrainChanged = false;

  for (const event of battle.scenario.events ?? []) {
    if (triggered.has(event.id)) continue;
    if (event.triggerAfterEventId && !triggeredBeforeProcessing.has(event.triggerAfterEventId)) continue;
    const dueByRound = event.triggerRound != null && battle.state.round >= event.triggerRound;
    const dueByAttrition = event.triggerEnemyRemaining != null && enemyRemaining <= event.triggerEnemyRemaining;
    const dueByObjective = event.triggerObjectiveId != null
      && battle.scenario.objectives.some((objective) => (
        objective.id === event.triggerObjectiveId && isObjectiveMet(objective, battle)
      ));
    if (!dueByRound && !dueByAttrition && !dueByObjective) continue;

    battle.triggeredEventIds.push(event.id);
    triggered.add(event.id);
    const appliedEffects = applyTacticalEventEffects(battle, event.effects ?? []);
    terrainChanged ||= appliedEffects.some((effect) => effect.kind === 'transformTerrain');
    const requestedUnits = event.faction === 'alliance'
      ? event.reinforcements
      : event.reinforcements.slice(0, waveSize);

    const occupied = new Set<string>();
    for (const side of Object.values(battle.state.sides)) {
      for (const unit of side.units.values()) {
        if (unit.stance !== 'destroyed' && !unit.embarkedOn) occupied.add(coordinateKey(unit.coordinate));
      }
    }

    const spawnedUnits: TriggeredTacticalEvent['units'] = [];
    for (const reinforcement of requestedUnits) {
      const coordinate = openReinforcementCoordinate(battle, reinforcement.coordinate, occupied);
      if (!coordinate) continue;
      const definition = findUnitDef(bundle, reinforcement.definitionId);
      const tacticalId = `${event.id}:${reinforcement.id}`;
      const unit = createUnitInstance(definition, event.faction, coordinate, tacticalId);
      unit.orientation = reinforcement.orientation ?? 0;

      const hasThermalOptics = event.faction === 'alliance' && state.research.completed.has('optics-ii');
      const weatherVisionLoss = battle.state.weather === 'night'
        ? (hasThermalOptics ? 0 : 1)
        : battle.state.weather === 'fog'
          ? (hasThermalOptics ? 1 : 2)
          : 0;
      unit.stats.vision = Math.max(1, unit.stats.vision - weatherVisionLoss);

      battle.state.sides[event.faction].units.set(unit.id, unit);
      occupied.add(coordinateKey(coordinate));
      spawnedUnits.push({ id: unit.id, coordinate });
    }

    if (spawnedUnits.length > 0) {
      battle.state.timeline.push({
        kind: 'reinforcements:arrived',
        eventId: event.id,
        faction: event.faction,
        unitIds: spawnedUnits.map((unit) => unit.id),
        coordinates: spawnedUnits.map((unit) => unit.coordinate)
      });
    }
    if (appliedEffects.length > 0) {
      battle.state.timeline.push({
        kind: 'scenario:event',
        eventId: event.id,
        messageKey: event.messageKey,
        faction: event.faction,
        effectKinds: appliedEffects.map((effect) => effect.kind)
      });
    }
    if (spawnedUnits.length > 0 || appliedEffects.length > 0) {
      triggeredEvents.push({
        id: event.id,
        messageKey: event.messageKey,
        faction: event.faction,
        units: spawnedUnits,
        effects: appliedEffects
      });
    }
  }

  if (terrainChanged || triggeredEvents.some((event) => event.units.length > 0)) {
    updateAllFactionsVision(battle.state);
  }
  return triggeredEvents;
}

const unitsOccupyingReachObjective = (objective: TacticalObjective, battle: ActiveBattle) => {
  if (!objective.target) return [];
  const key = coordinateKey(objective.target);
  return Array.from(battle.state.sides.alliance.units.values()).filter(
    (unit) => unit.stance !== 'destroyed' && !unit.embarkedOn && coordinateKey(unit.coordinate) === key
  );
};

const isReachObjectiveOccupied = (objective: TacticalObjective, battle: ActiveBattle) => {
  const occupants = unitsOccupyingReachObjective(objective, battle);
  if (occupants.length === 0) return false;
  if (!objective.unitIds?.length) return true;
  const occupantIds = new Set(occupants.map((unit) => unit.id));
  return objective.unitIds.every((rosterId) => {
    const tacticalId = battle.deployment[rosterId];
    return tacticalId ? occupantIds.has(tacticalId) : false;
  });
};

export type ObjectiveActionErrorKey =
  | 'objectiveActionSelectUnit'
  | 'objectiveActionNotFound'
  | 'objectiveActionInvalid'
  | 'objectiveActionCompleted'
  | 'objectiveActionDeployment'
  | 'objectiveActionWrongTurn'
  | 'objectiveActionWrongFaction'
  | 'objectiveActionUnitUnavailable'
  | 'objectiveActionUnitRestricted'
  | 'objectiveActionOutOfRange'
  | 'objectiveActionNotEnoughAp'
  | 'objectiveActionDeadlineExpired';

export interface ObjectiveActionResult {
  success: boolean;
  errorKey?: ObjectiveActionErrorKey;
  actionPoints?: number;
}

const rejectObjectiveAction = (errorKey: ObjectiveActionErrorKey): ObjectiveActionResult => ({
  success: false,
  errorKey
});

const battleUnit = (battle: ActiveBattle, unitId: string) => (
  battle.state.sides.alliance.units.get(unitId)
  ?? battle.state.sides.otherSide.units.get(unitId)
);

export function checkObjectiveAction(
  battle: ActiveBattle,
  unitId: string | undefined,
  objectiveId: string
): ObjectiveActionResult {
  const objective = battle.scenario.objectives.find((candidate) => candidate.id === objectiveId);
  if (!objective) return rejectObjectiveAction('objectiveActionNotFound');
  if (objective.kind !== 'interact' || !objective.target || !objective.actionKey || !objective.actionPoints) {
    return rejectObjectiveAction('objectiveActionInvalid');
  }
  if ((battle.completedObjectiveIds ?? []).includes(objective.id)) {
    return rejectObjectiveAction('objectiveActionCompleted');
  }
  if (objective.deadlineRound != null && battle.state.round > objective.deadlineRound) {
    return rejectObjectiveAction('objectiveActionDeadlineExpired');
  }
  if (!battle.deployed) return rejectObjectiveAction('objectiveActionDeployment');
  if (!unitId) return rejectObjectiveAction('objectiveActionSelectUnit');
  if (battle.state.activeFaction !== 'alliance') return rejectObjectiveAction('objectiveActionWrongTurn');

  const unit = battleUnit(battle, unitId);
  if (!unit) return rejectObjectiveAction('objectiveActionSelectUnit');
  if (unit.faction !== 'alliance') return rejectObjectiveAction('objectiveActionWrongFaction');
  if (unit.stance === 'destroyed' || unit.stance === 'routed' || unit.embarkedOn) {
    return rejectObjectiveAction('objectiveActionUnitUnavailable');
  }
  if (objective.unitIds?.length) {
    const eligibleTacticalIds = new Set(objective.unitIds
      .map((rosterId) => battle.deployment[rosterId])
      .filter((tacticalId): tacticalId is string => Boolean(tacticalId)));
    if (!eligibleTacticalIds.has(unit.id)) return rejectObjectiveAction('objectiveActionUnitRestricted');
  }
  if (isoDistance(unit.coordinate, objective.target) > 1) {
    return rejectObjectiveAction('objectiveActionOutOfRange');
  }
  if (unit.actionPoints < objective.actionPoints) {
    return rejectObjectiveAction('objectiveActionNotEnoughAp');
  }
  return { success: true, actionPoints: objective.actionPoints };
}

export function performObjectiveAction(
  battle: ActiveBattle,
  unitId: string,
  objectiveId: string
): ObjectiveActionResult {
  const check = checkObjectiveAction(battle, unitId, objectiveId);
  if (!check.success) return check;

  const unit = battle.state.sides.alliance.units.get(unitId)!;
  const objective = battle.scenario.objectives.find((candidate) => candidate.id === objectiveId)!;
  const actionPoints = check.actionPoints!;
  unit.actionPoints -= actionPoints;
  battle.completedObjectiveIds ??= [];
  battle.completedObjectiveIds.push(objectiveId);
  battle.state.timeline.push({ kind: 'objective:completed', objectiveId, unitId, actionKey: objective.actionKey! });
  return { success: true, actionPoints };
}

export const isObjectiveMet = (objective: TacticalObjective, battle: ActiveBattle): boolean => {
  switch (objective.kind) {
    case 'eliminate': {
      const remaining = Array.from(battle.state.sides.otherSide.units.values()).filter(
        (u) => u.stance !== 'destroyed'
      );
      return remaining.length === 0 && pendingHostileReinforcementEvents(battle).length === 0;
    }
    case 'reach': {
      if (!isReachObjectiveOccupied(objective, battle)) return false;
      const difficultyRules = getCampaignDifficultyRules(battle.difficulty ?? 'commander');
      if (!difficultyRules.secureReachObjectives) return true;
      const claimedRound = battle.reachClaimedRound?.[objective.id];
      return claimedRound != null
        && battle.state.activeFaction === 'alliance'
        && battle.state.round > claimedRound;
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
    case 'interact':
      return (battle.completedObjectiveIds ?? []).includes(objective.id);
    default:
      return false;
  }
};

export const isObjectiveDeadlineMissed = (objective: TacticalObjective, battle: ActiveBattle) => (
  objective.deadlineRound != null
  && battle.state.round > objective.deadlineRound
  && !isObjectiveMet(objective, battle)
);

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

function tickReachProgress(battle: ActiveBattle) {
  battle.reachClaimedRound ??= {};
  for (const objective of battle.scenario.objectives) {
    if (objective.kind !== 'reach') continue;
    if (!isReachObjectiveOccupied(objective, battle)) {
      delete battle.reachClaimedRound[objective.id];
      continue;
    }
    battle.reachClaimedRound[objective.id] ??= battle.state.round;
  }
}

export function evaluateBattleOutcome(battle: ActiveBattle): 'victory' | 'defeat' | 'ongoing' {
  tickHoldProgress(battle);
  tickReachProgress(battle);

  const requiredObjectives = battle.scenario.objectives.filter((objective) => !objective.optional);
  const defeatByProtect = requiredObjectives.some((o) => o.kind === 'protect' && !isObjectiveMet(o, battle));
  if (defeatByProtect) return 'defeat';
  if (requiredObjectives.some((objective) => isObjectiveDeadlineMissed(objective, battle))) {
    return 'defeat';
  }

  const allMet = requiredObjectives.every((o) => isObjectiveMet(o, battle));
  if (allMet) return 'victory';

  // Alternate win: securing the primary objective — reach (extraction flare / far bank / charges) or
  // hold (secure the relay/spire for N rounds) — wins even with enemies alive; protects are enforced
  // above, and routing everyone still wins via the all-enemies-dead shortcut. This makes the brief copy
  // honest on evac, bridgehead, and raid/hold sectors instead of secretly requiring a full wipe too.
  const primaryObjectives = requiredObjectives.filter(
    (objective) => objective.kind === 'reach' || objective.kind === 'hold' || objective.kind === 'interact'
  );
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
  const essentialIncomplete = requiredObjectives.some(
    (objective) => objective.essential && !isObjectiveMet(objective, battle)
  );
  if (
    survivingEnemies.length === 0
    && pendingHostileReinforcementEvents(battle).length === 0
    && !essentialIncomplete
  ) return 'victory';

  // reach/hold with turn limit missed?
  const turn = battle.state.round;
  const timedFailure = requiredObjectives.some((o) => {
    if (o.turnLimit && (o.kind === 'reach' || o.kind === 'interact') && turn > o.turnLimit + 1) {
      return !isObjectiveMet(o, battle);
    }
    return false;
  });
  if (timedFailure) return 'defeat';

  return 'ongoing';
}

export type BattleRetreatForecast = {
  lostUnitIds: string[];
  recoveredHeroIds: string[];
};

const reconcileRosterProgression = (
  state: CampaignState,
  bundle: ContentBundle,
  battle: ActiveBattle,
  roster: ArmyUnit,
  unit: UnitInstance
) => {
  const deployedWith = battle.deploymentExperience?.[roster.id] ?? 0;
  const earnedExperience = Math.max(0, unit.experience - deployedWith);
  const previousTier = roster.tier;
  roster.experience = Math.max(0, roster.experience + earnedExperience);
  roster.tier = unitTierForExperience(roster.experience);
  if (UNIT_TIER_ORDER.indexOf(roster.tier) <= UNIT_TIER_ORDER.indexOf(previousTier)) return;

  const definition = findUnitDef(bundle, roster.definitionId);
  const params = {
    name: definition.name,
    unitId: definition.id,
    tier: roster.tier,
    previousTier,
    level: experienceLevelFor(roster.experience)
  };
  state.log.push({ key: 'unitPromoted', params });
  state.popups?.push({ turn: state.turn, key: 'unitPromoted', params, kind: 'reward' });
};

type OfficerLossRecord = {
  officer: Officer;
  profile: OfficerProfile;
  formation?: Formation;
};

const reconcileDeployedOfficers = (
  state: CampaignState,
  bundle: ContentBundle,
  battle: ActiveBattle,
  lostRosterIds: ReadonlySet<string>,
  awardService: boolean
): OfficerLossRecord[] => {
  const losses: OfficerLossRecord[] = [];
  for (const officer of state.officers) {
    if (officer.status !== 'active' || !officer.assignedUnitId) continue;
    const tacticalId = battle.deployment[officer.assignedUnitId];
    if (!tacticalId) continue;
    const tactical = battle.state.sides.alliance.units.get(tacticalId);
    if (lostRosterIds.has(officer.assignedUnitId)) {
      const formation = state.formations.find((candidate) => candidate.units.includes(officer.assignedUnitId!));
      officer.status = 'fallen';
      officer.assignedUnitId = undefined;
      if (formation) {
        formation.commandShockUntilTurn = Math.max(formation.commandShockUntilTurn ?? 0, state.turn + 2);
      }
      losses.push({ officer, profile: officerProfileFor(bundle, officer.profileId), formation });
      continue;
    }
    if (!awardService || !tactical || tactical.stance === 'destroyed' || tactical.currentHealth <= 0) continue;
    officer.service += 1;
    const promotion = getOfficerPromotion(state, bundle, officer.id);
    if (promotion && officer.service === promotion.requiredService) {
      const rank = officerRankFor(bundle, promotion.rankId);
      const profile = officerProfileFor(bundle, officer.profileId);
      state.log.push({
        key: 'officerPromotionReady',
        params: {
          officer: profile.name,
          officerId: profile.id,
          rank: rank.name,
          rankId: rank.id,
          service: officer.service
        }
      });
    }
  }
  return losses;
};

const reconcileFormationCasualties = (
  state: CampaignState,
  losses: OfficerLossRecord[]
) => {
  const armyIds = new Set(state.army.map((unit) => unit.id));
  const claimedUnitIds = new Set<string>();
  for (const formation of state.formations) {
    formation.units = formation.units.filter((unitId) => {
      if (!armyIds.has(unitId) || claimedUnitIds.has(unitId)) return false;
      claimedUnitIds.add(unitId);
      return true;
    });
  }

  for (const loss of losses) {
    const formation = loss.formation
      ? state.formations.find((candidate) => candidate.id === loss.formation?.id)
      : undefined;
    const released = formation && formation.units.length > COMMANDER_FREE_FORMATION_CAPACITY
      ? formation.units.splice(COMMANDER_FREE_FORMATION_CAPACITY)
      : [];
    const params = {
      officer: loss.profile.name,
      officerId: loss.profile.id,
      formation: formation?.name ?? '',
      formationId: formation?.id ?? '',
      moralePenalty: COMMAND_SHOCK_MORALE_PENALTY,
      released: released.length,
      shockThroughTurn: Math.max(state.turn, (formation?.commandShockUntilTurn ?? state.turn + 1) - 1)
    };
    state.log.push({ key: 'officerLost', params });
    state.popups?.push({ turn: state.turn, key: 'officerLost', params, kind: 'loss' });
  }
};

export function getBattleRetreatForecast(
  state: CampaignState,
  bundle: ContentBundle
): BattleRetreatForecast {
  const battle = state.activeBattle;
  if (!battle) throw new Error('No active battle');
  const startKeys = new Set(battle.startTiles.map((c) => coordinateKey(c)));
  const deployedRosterIds = new Set(Object.keys(battle.deployment));
  const forecast: BattleRetreatForecast = { lostUnitIds: [], recoveredHeroIds: [] };

  for (const roster of state.army) {
    if (!deployedRosterIds.has(roster.id)) continue;
    const unit = battle.state.sides.alliance.units.get(battle.deployment[roster.id]);
    if (!unit) continue;
    const carrier = unit.embarkedOn ? battle.state.sides.alliance.units.get(unit.embarkedOn) : undefined;
    const effectiveUnit = carrier ?? unit;
    const onStartTile = startKeys.has(coordinateKey(effectiveUnit.coordinate));
    const cutOff = unit.stance === 'destroyed' || effectiveUnit.stance === 'destroyed' || !onStartTile;
    if (!cutOff) continue;

    if (findUnitDef(bundle, roster.definitionId).type === 'hero') {
      forecast.recoveredHeroIds.push(roster.id);
    } else {
      forecast.lostUnitIds.push(roster.id);
    }
  }

  return forecast;
}

export function retreatFromBattle(state: CampaignState, bundle: ContentBundle) {
  const battle = state.activeBattle;
  if (!battle) throw new Error('No active battle');
  const forecast = getBattleRetreatForecast(state, bundle);
  const lostUnitIds = new Set(forecast.lostUnitIds);
  const recoveredHeroIds = new Set(forecast.recoveredHeroIds);
  const officerLosses = reconcileDeployedOfficers(state, bundle, battle, lostUnitIds, false);
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
    if (lostUnitIds.has(roster.id)) {
      continue; // lost during retreat
    }
    roster.currentHealth = recoveredHeroIds.has(roster.id) ? 1 : unit.currentHealth;
    reconcileRosterProgression(state, bundle, battle, roster, unit);
    updatedArmy.push(roster);
  }
  state.army = updatedArmy;
  reconcileFormationCasualties(state, officerLosses);
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
  const lostRosterIds = new Set<string>();
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
    const hero = findUnitDef(bundle, roster.definitionId).type === 'hero';
    if ((unit.stance === 'destroyed' || unit.currentHealth <= 0) && !hero) {
      lostRosterIds.add(roster.id);
      continue;
    }
    roster.currentHealth = hero && (unit.stance === 'destroyed' || unit.currentHealth <= 0)
      ? 1
      : unit.currentHealth;
    reconcileRosterProgression(state, bundle, battle, roster, unit);
    survivors.push(roster);
  }

  const officerLosses = reconcileDeployedOfficers(state, bundle, battle, lostRosterIds, true);
  state.army = survivors;
  reconcileFormationCasualties(state, officerLosses);
  const spec = findCampaignSpec(bundle, state.campaignId);
  const routeSourceIds = routeSourceIdsFor(spec);
  if (routeSourceIds.has(territory.id)) {
    state.operationResults[territory.id] ??= result;
  }

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

  } else {
    territory.status = routeSourceIds.has(territory.id)
      ? 'failed'
      : territory.status === 'available' ? 'available' : 'failed';
    state.log.push({ key: 'defeatAt', params: { territory: territory.name, territoryId: territory.id } });
    state.popups?.push({
      turn: state.turn,
      key: state.army.length === 0 ? 'operationFailedNoArmy' : 'operationFailedWithSurvivors',
      params: { territory: territory.name, territoryId: territory.id },
      kind: 'loss'
    });
  }

  refreshCampaignRoutes(state, spec, true);
  applyAvailableActTimeBonuses(state, spec);
  if (!state.outcome && campaignIsComplete(state)) {
    state.outcome = 'victory';
    state.log.push({ key: 'campaignWon' });
    state.popups?.push({ turn: state.turn, key: 'campaignWon', kind: 'reward' });
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
    difficulty: state.difficulty,
    turn: state.turn,
    lastOperationTurn: state.lastOperationTurn,
    globalTimer: state.globalTimer,
    resources: { ...state.resources },
    army: structuredClone(state.army),
    reserves: structuredClone(state.reserves),
    formations: structuredClone(state.formations),
    officers: structuredClone(state.officers),
    territories: structuredClone(state.territories),
    ...(Object.keys(state.operationResults).length > 0
      ? { operationResults: { ...state.operationResults } }
      : {}),
    ...(Object.keys(state.actTimeBonusesApplied).length > 0
      ? { actTimeBonusesApplied: { ...state.actTimeBonusesApplied } }
      : {}),
    research: {
      known: Array.from(state.research.known),
      completed: Array.from(state.research.completed),
      paused: { ...state.research.paused },
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
  const difficulty = snapshot.difficulty ?? 'commander';
  const territoryBase = new Map(spec.territories.map((t) => [t.id, t]));
  const savedTerritories = new Map(snapshot.territories.map((territory) => [territory.id, territory]));
  const routeSourceIds = routeSourceIdsFor(spec);
  const operationResults = { ...(snapshot.operationResults ?? {}) };
  for (const sourceId of routeSourceIds) {
    if (operationResults[sourceId]) continue;
    if (savedTerritories.get(sourceId)?.status === 'cleared') operationResults[sourceId] = 'victory';
  }

  const researchKnown = addResearchUnlocksToKnown(bundle, snapshot.research.completed);
  for (const k of snapshot.research.known) {
    researchKnown.add(k);
  }

  const army = structuredClone(snapshot.army).map(normalizeArmyUnitProgression);
  const reserves = structuredClone(snapshot.reserves).map(normalizeArmyUnitProgression);
  const formations = normalizeFormations(snapshot.formations, army);
  const officers = normalizeOfficers(bundle, snapshot.officers, army);
  normalizeOfficerFormationAssignments(officers, formations);
  const completedResearch = new Set(snapshot.research.completed);
  const researchTopics = new Map(bundle.research.map((topic) => [topic.id, topic]));
  const pausedResearch = Object.fromEntries(Object.entries(snapshot.research.paused ?? {}).flatMap(([topicId, remaining]) => {
    const topic = researchTopics.get(topicId);
    if (!topic || completedResearch.has(topicId) || !Number.isFinite(remaining) || remaining <= 0) return [];
    return [[topicId, Math.min(topic.cost, Math.max(1, remaining))]];
  }));
  const activeTopic = snapshot.research.inProgress
    ? researchTopics.get(snapshot.research.inProgress.topicId)
    : undefined;
  const inProgress = activeTopic && !completedResearch.has(activeTopic.id)
    ? {
        topicId: activeTopic.id,
        remaining: Math.min(activeTopic.cost, Math.max(1, snapshot.research.inProgress?.remaining ?? activeTopic.cost))
      }
    : undefined;
  if (inProgress) delete pausedResearch[inProgress.topicId];
  const activeBattle = snapshot.activeBattle ? decodeActiveBattle(snapshot.activeBattle) : undefined;
  if (activeBattle) {
    activeBattle.difficulty ??= difficulty;
    activeBattle.reachClaimedRound ??= {};
    activeBattle.holdProgress ??= {};
    activeBattle.holdCountedRound ??= {};
    activeBattle.triggeredEventIds ??= [];
    activeBattle.completedObjectiveIds ??= [];
    const hasCumulativeDeploymentExperience = activeBattle.deploymentExperience != null;
    const deploymentExperience = { ...(activeBattle.deploymentExperience ?? {}) };
    const unitDefinitions = new Map(bundle.units.map((definition) => [definition.id, definition]));
    for (const side of Object.values(activeBattle.state.sides)) {
      for (const unit of side.units.values()) {
        unit.experience = Math.max(0, Number.isFinite(unit.experience) ? unit.experience : 0);
        unit.level = experienceLevelFor(unit.experience);
        unit.careerProgression = true;
        unit.dugInThisRound ??= false;
        const sensorDeployment = unitDefinitions.get(unit.definitionId)?.stats.sensorDeployment;
        if (sensorDeployment) {
          unit.stats.sensorDeployment ??= { ...sensorDeployment };
          unit.sensorDeployed ??= false;
        }
        unit.idleEntrenchedTurns = Math.max(
          0,
          Number.isFinite(unit.idleEntrenchedTurns) ? unit.idleEntrenchedTurns ?? 0 : 0
        );
      }
    }
    if (!hasCumulativeDeploymentExperience) {
      for (const [rosterId, tacticalId] of Object.entries(activeBattle.deployment)) {
        const roster = army.find((unit) => unit.id === rosterId);
        const tactical = activeBattle.state.sides.alliance.units.get(tacticalId);
        if (!roster || !tactical) continue;
        tactical.experience = roster.experience + tactical.experience;
        tactical.level = experienceLevelFor(tactical.experience);
        deploymentExperience[rosterId] = roster.experience;
      }
    }
    activeBattle.deploymentExperience = deploymentExperience;
  }

  const state: CampaignState = {
    campaignId,
    difficulty,
    turn: snapshot.turn,
    lastOperationTurn: snapshot.lastOperationTurn,
    globalTimer: snapshot.globalTimer ?? 15,
    resources: { ...snapshot.resources },
    army,
    reserves,
    formations,
    officers,
    territories: [
      ...spec.territories.map((territorySpec) => {
        const saved = savedTerritories.get(territorySpec.id);
        if (!saved) {
          const status = initialTerritoryStatus(territorySpec);
          return {
            ...territorySpec,
            status,
            remainingTimer: territorySpec.route ? undefined : territorySpec.timer
          };
        }
        return {
          ...territorySpec,
          status: saved.status === 'failed' ? 'available' as const : saved.status,
          remainingTimer: saved.status === 'failed' || (saved.status === 'locked' && territorySpec.route)
            ? undefined
            : saved.remainingTimer
        };
      }),
      ...snapshot.territories
        .filter((territory) => !territoryBase.has(territory.id) && isGeneratedCounteroffensive(territory))
        .map((territory) => ({
          ...territory,
          status: territory.status === 'failed' ? 'available' as const : territory.status,
          remainingTimer: territory.status === 'failed' ? undefined : territory.remainingTimer
        }))
    ],
    operationResults,
    actTimeBonusesApplied: { ...(snapshot.actTimeBonusesApplied ?? {}) },
    research: {
      known: researchKnown,
      completed: completedResearch,
      paused: pausedResearch,
      inProgress
    },
    activeBattle,
    log: snapshot.log.map(normalizeLegacyLogEntry),
    events: snapshot.events ? [...snapshot.events] : [],
    popups: snapshot.popups ? structuredClone(snapshot.popups).map(normalizeLegacyPopup) : [],
    outcome: snapshot.outcome
  };

  refreshCampaignRoutes(state, spec);
  applyAvailableActTimeBonuses(state, spec);
  return state;
}
