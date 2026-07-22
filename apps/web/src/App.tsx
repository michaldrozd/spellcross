import './styles.css';
import {
  applyBattleOutcome,
  calculateAttackRange,
  calculateHitChance,
  CampaignError,
  canAffordAttack,
  canWeaponReachCoordinate,
  canWeaponTarget,
  convertStrategicToMoney,
  convertStrategicToResearch,
  createCampaign,
  createUnitInstance,
  decideNextAIAction,
  endStrategicTurn,
  estimateHitDamage,
  experienceLevelFor,
  evaluateBattleOutcome,
  getCampaignDifficultyRules,
  getBattleRetreatForecast,
  getEnemyActionBudget,
  getEnemyDecisionBudget,
  getEnemyDifficultyTier,
  getOperationDeploymentPlan,
  getUnitRearmOptions,
  hasWeaponLineOfFire,
  isoDistance as axialDistance,
  isoNeighbors,
  isoWithinRange,
  coordinateKey,
  hydrateCampaignState,
  isObjectiveMet,
  isSupplyUnit,
  isUnitUnlocked,
  planPathForUnitIso as planPathForUnit,
  checkObjectiveAction,
  performObjectiveAction,
  processTacticalEvents,
  projectUnitService,
  pauseResearch,
  reactionThreats,
  rearmUnit,
  recruitUnit,
  dismissUnit,
  refillUnit,
  retreatFromBattle,
  serializeCampaignState,
  startBattleForTerritory,
  startResearch,
  setUnitFormation,
  TurnProcessor,
  typeEffectiveness,
  weaponFireMode,
  weaponDamageRole,
  calculateStrengthModifier,
  nextExperienceLevelThreshold,
  updateAllFactionsVision
} from '@spellcross/core';
import type { BattleEvent, BattlefieldMap, CampaignDifficulty, CampaignState, HexCoordinate, TacticalBattleState, TriggeredTacticalEvent, UnitInstance } from '@spellcross/core';
import { validatedStarterBundle } from '@spellcross/data';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { ArrivalEffect, AttackEffect, MovingUnit } from './components/BattlefieldStage.js';
import { combatEffectForShot, combatEffectTiming, combatEffectTypeForWeapon } from './components/combatVisuals.js';
import { HealButton } from './components/HealButton.js';
import { MainMenu } from './components/MainMenu.js';
import type { SaveSlot } from './components/MainMenu.js';
import { ObjectiveHud } from './components/ObjectiveHud.js';
import { OverwatchButton } from './components/OverwatchButton.js';
import { PostureActions } from './components/PostureActions.js';
import { StrategicHQ } from './components/StrategicHQ.js';
import { SupplyButton } from './components/SupplyButton.js';
import { ToastContainer, showToast } from './components/Toast.js';
import { battlefieldDirectionalSprite, unitPortrait } from './components/unitVisuals.js';
import i18n from './i18n/index.js';
import { AudioManager, movementSoundProfileFor } from './services/AudioManager.js';

const BattlefieldStage = React.lazy(async () => {
  const battlefieldModule = await import('./components/BattlefieldStage.js');
  return { default: battlefieldModule.BattlefieldStage };
});

const bundle = validatedStarterBundle;
const CAMPAIGN_STORAGE_KEY = 'spellcross:campaign-state';
const CAMPAIGN_SLOT_KEY = 'spellcross:campaign-slot';
const CAMPAIGN_SUMMARY_KEY = 'spellcross:campaign-summary';
const CAMPAIGN_SCHEMA_KEY = 'spellcross:campaign-schema';
const CAMPAIGN_SCHEMA_VERSION = '2026-07-20-operation-cycle';
const FOOT_STEP_DURATION_MS = 240;
const VEHICLE_STEP_DURATION_MS = 420;
const compactNumber = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
const displayActionPoints = (n: number) => String(Math.max(0, Math.floor(n)));
const orientationForStep = (from: HexCoordinate, to: HexCoordinate) => {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  if (dq > 0 && dr === 0) return 0;
  if (dq > 0 && dr < 0) return 1;
  if (dq === 0 && dr < 0) return 2;
  if (dq < 0 && dr === 0) return 3;
  if (dq < 0 && dr > 0) return 4;
  if (dq === 0 && dr > 0) return 5;
  if (dq > 0 && dr > 0) return 6;
  if (dq < 0 && dr < 0) return 7;
  return 0;
};
const movingUnitDuration = (moving: MovingUnit) => {
  const movementDuration = (moving.path.length - 1) * moving.stepDuration;
  const segmentTurnDuration = moving.segmentTurnDuration ?? 0;
  let turnDuration = 0;
  if (segmentTurnDuration > 0) {
    for (let index = 0; index + 2 < moving.path.length; index += 1) {
      const fromOrientation = orientationForStep(moving.path[index], moving.path[index + 1]);
      const toOrientation = orientationForStep(moving.path[index + 1], moving.path[index + 2]);
      if (fromOrientation !== toOrientation) turnDuration += segmentTurnDuration;
    }
  }
  return (moving.preAlignDuration ?? 0) + movementDuration + turnDuration;
};
// When the glide reaches a given path tile, accounting for directional-vehicle turn pauses so the reaction
// muzzle/HIT lands exactly as the sprite arrives there rather than a corner-turn too early.
const arrivalDelayForPath = (moving: MovingUnit, coord: HexCoordinate) => {
  const fullPath = moving.path;
  const found = fullPath.findIndex((c) => c.q === coord.q && c.r === coord.r);
  const stepIndex = found < 0 ? fullPath.length - 1 : Math.max(0, found);
  let t = (moving.preAlignDuration ?? 0) + stepIndex * moving.stepDuration;
  const segTurn = moving.segmentTurnDuration ?? 0;
  if (segTurn > 0) {
    for (let i = 0; i + 2 < fullPath.length && i < stepIndex; i += 1) {
      if (orientationForStep(fullPath[i], fullPath[i + 1]) !== orientationForStep(fullPath[i + 1], fullPath[i + 2])) t += segTurn;
    }
  }
  return t;
};
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
// Man-portable "artillery" that is actually a foot crew (mortar team) — walks, doesn't track.
const isFootCrew = (definitionId: string) => definitionId === 'mortar-team';
interface SlotSummary {
  difficulty: CampaignDifficulty;
  turn: number;
  resources: CampaignState['resources'];
  territories: number;
  updated: number;
  activeBattle: boolean;
}
function ensureCampaignStorageSchema() {
  if (typeof window === 'undefined') return;
  const stored = window.localStorage.getItem(CAMPAIGN_SCHEMA_KEY);
  if (stored === CAMPAIGN_SCHEMA_VERSION) return;
  // Record the new schema version without discarding existing saves. Loading is
  // resilient per slot (hydrate falls back to a fresh campaign on a parse failure),
  // so a schema bump no longer wipes every slot — at worst one incompatible slot
  // resets itself while the others survive.
  if (stored) {
    console.info(`Campaign save schema changed (${stored} -> ${CAMPAIGN_SCHEMA_VERSION}); existing saves preserved.`);
  }
  window.localStorage.setItem(CAMPAIGN_SCHEMA_KEY, CAMPAIGN_SCHEMA_VERSION);
}
function loadSavedCampaign(slot: number): CampaignState {
  if (typeof window === 'undefined') {
    return createCampaign(bundle);
  }
  ensureCampaignStorageSchema();
  const saved = window.localStorage.getItem(`${CAMPAIGN_STORAGE_KEY}:${slot}`);
  if (!saved) return createCampaign(bundle);
  try {
    const parsed = JSON.parse(saved);
    return hydrateCampaignState(bundle, parsed);
  } catch (err) {
    console.warn('Failed to restore campaign, starting fresh', err);
    return createCampaign(bundle);
  }
}
function loadSummary(slot: number): SlotSummary | null {
  if (typeof window === 'undefined') return null;
  ensureCampaignStorageSchema();
  const saved = window.localStorage.getItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<SlotSummary>;
    return { ...parsed, difficulty: parsed.difficulty ?? 'commander' } as SlotSummary;
  } catch {
    return null;
  }
}
function useCampaign() {
  const initialSlot = typeof window === 'undefined' ? 1 : Number(window.localStorage.getItem(CAMPAIGN_SLOT_KEY) ?? 1);
  const [slot, setSlot] = useState<number>(Number.isNaN(initialSlot) ? 1 : initialSlot);
  // Synchronous mirror of `slot`. persist()/updateSummary() must not read the async useState value:
  // changeSlot() followed by reset() (New Game) would otherwise write the fresh campaign into the
  // PREVIOUS slot's keys and destroy that save.
  const slotRef = useRef<number>(Number.isNaN(initialSlot) ? 1 : initialSlot);
  // Lazy init — a plain useRef(loadSavedCampaign(slot)) re-parses the whole save on every render.
  const ref = useRef<CampaignState | null>(null);
  if (!ref.current) ref.current = loadSavedCampaign(slot);
  const [, rerender] = useState(0);
  const [summary, setSummary] = useState<SlotSummary | null>(() => loadSummary(slot));
  const updateSummary = useCallback(() => {
    const state = ref.current!;
    const next: SlotSummary = {
      difficulty: state.difficulty,
      turn: state.turn,
      resources: { ...state.resources },
      territories: state.territories.length,
      updated: Date.now(),
      activeBattle: Boolean(state.activeBattle)
    };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${CAMPAIGN_SUMMARY_KEY}:${slotRef.current}`, JSON.stringify(next));
    }
    setSummary(next);
  }, []);
  const persist = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`${CAMPAIGN_STORAGE_KEY}:${slotRef.current}`, JSON.stringify(serializeCampaignState(ref.current!)));
      } catch (err) {
        console.warn('Failed to persist campaign', err);
      }
    }
    updateSummary();
    rerender((n) => n + 1);
  }, [updateSummary]);
  const mutate = useCallback((fn: (state: CampaignState) => void) => {
    fn(ref.current!);
    persist();
  }, [persist]);
  const reset = useCallback((difficulty: CampaignDifficulty = 'commander') => {
    ref.current = createCampaign(bundle, undefined, difficulty);
    persist();
  }, [persist]);
  const changeSlot = useCallback((next: number) => {
    slotRef.current = next;
    setSlot(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CAMPAIGN_SLOT_KEY, String(next));
    }
    ref.current = loadSavedCampaign(next);
    setSummary(loadSummary(next));
    rerender((n) => n + 1);
    return ref.current;
  }, []);
  return { campaign: ref.current!, mutate, persist, reset, slot, changeSlot, summary };
}
// Localization lookups for static content-bundle data (unit/research/territory/scenario/objective
// names+text). Content stays English/id-stable in packages/data; the display layer prefers the active
// locale's translation (keyed by the content's stable id) and falls back to the English source string
// so nothing goes blank if a translation is ever missing.
function localizedUnitName(definitionId: string, fallback: string) {
  return i18n.t(`units:${definitionId}.name`, { defaultValue: fallback });
}
function localizedScenarioName(scenarioId: string, fallback: string) {
  return i18n.t(`scenarios:${scenarioId}.name`, { defaultValue: fallback });
}
function localizedScenarioBrief(scenarioId: string, fallback: string) {
  return i18n.t(`scenarios:${scenarioId}.brief`, { defaultValue: fallback });
}
function localizedObjectiveText(scenarioId: string, objectiveId: string, fallback: string) {
  return i18n.t(`scenarios:${scenarioId}.objectives.${objectiveId}`, { defaultValue: fallback });
}
function localizedResearchName(topicId: string, fallback: string) {
  return i18n.t(`research:${topicId}.name`, { defaultValue: fallback });
}
function localizedResearchDescription(topicId: string, fallback: string) {
  return i18n.t(`research:${topicId}.description`, { defaultValue: fallback });
}
// Territories synthesized at runtime (raids/counterattacks) carry a nameKey/briefKey into the `campaign`
// namespace (set in packages/core campaign.ts); static content-bundle territories are looked up by id.
// Their keyParams hold the raw English name of the raided sector next to its stable id — re-resolve it
// through the active locale before interpolating (mirrors localizedLogParams in StrategicHQ).
function localizedTerritoryKeyParams(params?: Record<string, string | number>) {
  if (!params) return params;
  if (typeof params.targetId === 'string' && typeof params.target === 'string') {
    return { ...params, target: i18n.t(`territories:${params.targetId}.name`, { defaultValue: params.target }) };
  }
  return params;
}
function localizedTerritoryName(territory: { id: string; name: string; nameKey?: string; keyParams?: Record<string, string | number> }) {
  if (territory.nameKey) return i18n.t(`campaign:${territory.nameKey}`, localizedTerritoryKeyParams(territory.keyParams));
  return i18n.t(`territories:${territory.id}.name`, { defaultValue: territory.name });
}
function localizedTerritoryBrief(territory: { id: string; brief: string; briefKey?: string; keyParams?: Record<string, string | number> }) {
  if (territory.briefKey) return i18n.t(`campaign:${territory.briefKey}`, localizedTerritoryKeyParams(territory.keyParams));
  return i18n.t(`territories:${territory.id}.brief`, { defaultValue: territory.brief });
}
// Resolves a unit id to its player-facing name, preferring the active locale's translation (keyed by
// definitionId in the `units` namespace) and falling back to the English content-bundle name.
function unitDisplayName(unitId: string, battleState: TacticalBattleState) {
  for (const side of Object.values(battleState.sides)) {
    const unit = side.units.get(unitId);
    if (!unit) continue;
    const def = bundle.units.find((candidate) => candidate.id === unit.definitionId);
    return localizedUnitName(unit.definitionId, def?.name ?? unit.definitionId);
  }
  return unitId.replace(/[-_][A-Za-z0-9]{6,}$/, '');
}
// Combat-log lines. Templates use a colon/arrow style ("Hit: X → Y") rather than full prose sentences —
// unit/place names are interpolated from one fixed (nominative) form and Slovak declines nouns by case,
// so a template like "X zasiahol Y" would need to grammatically decline Y as a direct object. The
// colon-label format sidesteps that entirely and reads naturally in both languages.
function formatBattleEvent(event: BattleEvent, battleState: TacticalBattleState): string {
  const faction = (f: string) => i18n.t(`common:faction.${f === 'alliance' ? 'alliance' : 'otherSide'}`);
  switch (event.kind) {
    case 'round:started':
      return i18n.t('log:round', { round: event.round, faction: faction(event.activeFaction) });
    case 'unit:moved':
      return i18n.t('log:moved', { unit: unitDisplayName(event.unitId, battleState) });
    case 'unit:attacked':
      if (event.attackMode === 'suppressive') {
        return i18n.t('log:suppressed', {
          attacker: unitDisplayName(event.attackerId, battleState),
          defender: unitDisplayName(event.defenderId, battleState),
          morale: event.moraleDamage
        });
      }
      return event.hit
        ? i18n.t('log:hit', { attacker: unitDisplayName(event.attackerId, battleState), defender: unitDisplayName(event.defenderId, battleState), damage: event.damage })
        : i18n.t('log:miss', { attacker: unitDisplayName(event.attackerId, battleState), defender: unitDisplayName(event.defenderId, battleState) });
    case 'unit:defeated':
      return i18n.t('log:destroyed', { unit: unitDisplayName(event.unitId, battleState) });
    case 'unit:xp':
      return i18n.t('log:xpGained', { unit: unitDisplayName(event.unitId, battleState) });
    case 'tile:destroyed':
      return i18n.t('log:tileDestroyed', { q: event.at.q, r: event.at.r });
    case 'unit:dug-in':
      return i18n.t('log:dugIn', { unit: unitDisplayName(event.unitId, battleState), level: event.level });
    case 'unit:rallied':
      return i18n.t('log:rallied', { unit: unitDisplayName(event.unitId, battleState), morale: event.morale });
    case 'unit:level':
      return i18n.t('log:levelUp', { unit: unitDisplayName(event.unitId, battleState), level: event.level });
    case 'reinforcements:arrived':
      return i18n.t('log:reinforcements', { count: event.unitIds.length, faction: faction(event.faction) });
    case 'objective:completed': {
      return i18n.t('log:objectiveCompleted', {
        unit: unitDisplayName(event.unitId, battleState),
        action: i18n.t(`actions:objective.action.${event.actionKey}`)
      });
    }
    default:
      return i18n.t('log:genericEvent');
  }
}
function visualOutcomeForAttack(events: BattleEvent[] | undefined, attackerId: string, defenderId: string) {
  if (!events) return { hit: false, damage: 0, moraleDamage: 0, killed: false, attackMode: 'normal' as const };
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (
      event.kind === 'unit:attacked'
      && event.attackerId === attackerId
      && event.defenderId === defenderId
    ) {
      return {
        hit: event.hit,
        damage: event.damage,
        moraleDamage: event.moraleDamage,
        killed: event.defenderRemainingHealth === 0,
        attackMode: event.attackMode ?? 'normal'
      };
    }
  }
  return { hit: false, damage: 0, moraleDamage: 0, killed: false, attackMode: 'normal' as const };
}
// Monotonic id for combat notices — Date.now() collided when several notices were created in the
// same millisecond (e.g. rapid attacks), producing duplicate React keys.
let combatNoticeSeq = 0;
const nextNoticeId = () => (combatNoticeSeq += 1);
// Same collision applies to attack-effect keys when one attacker hits the same target
// repeatedly in a single tick — a monotonic suffix keeps each effect's React key unique.
let attackEffectSeq = 0;
const nextEffectId = () => (attackEffectSeq += 1);
function soundForAttackEffect(effectType: AttackEffect['type']) {
  switch (effectType) {
    case 'explosion':
      return 'explosion';
    case 'magic':
      return 'magic'; // spellcasters were wrongly playing a rifle shot
    case 'melee':
      return 'hit'; // a single thud, not the 5-round gunshot burst
    case 'arrow':
      return 'bow'; // a bow twang + arrow, not an assault-rifle burst (dark elf / skeleton archers)
    case 'fire':
      return 'fire'; // flamethrower / fire-breath whoosh
    case 'sniper':
      return 'sniper'; // a single high-powered crack, not a burst
    default:
      return 'gunshot';
  }
}
// The sound a weapon makes when FIRED. A mortar leaves the tube with a hollow launch thump, not the
// blast its shell makes downrange — so it gets its own cue instead of the generic artillery explosion.
function firingSound(attacker: UnitInstance, defender: UnitInstance, weaponId: string) {
  const id = attacker.definitionId.toLowerCase();
  if (id.includes('mortar') || weaponId.toLowerCase().includes('mortar')) return 'mortar' as const;
  return soundForAttackEffect(combatEffectTypeForWeapon(attacker.definitionId, weaponId));
}
// Indirect fire (mortars, howitzers, rocket batteries) lobs its shell in a high ballistic arc rather
// than a flat tracer. Direct-fire tank shells stay flat even though they're also 'explosion' type.
const isIndirectFire = (attacker: UnitInstance, weaponId: string) => weaponFireMode(attacker, weaponId) === 'indirect';
// Timbre of the struck target: armour clangs, flesh thuds, the demonic invaders ring dissonantly.
function impactMaterialFor(unit: UnitInstance): 'metal' | 'flesh' | 'undead' {
  if (unit.unitType === 'vehicle' || unit.unitType === 'artillery') return 'metal';
  const id = unit.definitionId.toLowerCase();
  if (id.includes('ghoul') || id.includes('zombie') || id.includes('undead') || id.includes('demon') || id.includes('spawn')) return 'undead';
  return 'flesh';
}
// Coarse stereo placement from the unit's isometric screen-x (q - r), so hits pan toward where they land.
function impactPanFor(unit: UnitInstance, map: BattlefieldMap): number {
  const screenX = unit.coordinate.q - unit.coordinate.r;
  return Math.max(-1, Math.min(1, (screenX / Math.max(map.width, map.height)) * 0.7));
}
function bestWeapon(attacker: UnitInstance, defender: UnitInstance, map: BattlefieldMap, weather?: TacticalBattleState['weather']): { weapon: string; hit: number } | null {
  let choice: { weapon: string; hit: number } | null = null;
  let bestScore = 0;
  for (const weaponId of Object.keys(attacker.stats.weaponRanges)) {
    // Check if weapon can target this unit type
    if (!canWeaponTarget(attacker, weaponId, defender)) {
      continue;
    }
    if (!canWeaponReachCoordinate(attacker, weaponId, defender.coordinate, map)) {
      continue;
    }
    const hit = calculateHitChance({ attacker, defender, weaponId, map, weather });
    if (hit <= 0) continue;
    // Pick the weapon with the best expected EFFECTIVE damage (hit × armour/type-aware damage), so the
    // anti-tank gun is chosen against a tank and the MG against infantry — not just the most accurate.
    const score = hit * Math.max(1, estimateHitDamage(attacker, defender, weaponId, map));
    const hitPercent = Math.round(hit * 100);
    if (!choice || score > bestScore) {
      bestScore = score;
      choice = { weapon: weaponId, hit: hitPercent };
    }
  }
  return choice;
}
// For a planned move, work out which tiles along the path expose the unit to enemy reaction fire
// and how hard the worst tile could hit. Mirrors the engine's reaction-fire step (reactionThreats),
// so the on-map warning matches what would actually happen.
function analyzePathThreat(
  state: TacticalBattleState,
  unit: UnitInstance,
  pathTiles: HexCoordinate[]
): { threatenedKeys: string[]; worstTileDamage: number } {
  const threatenedKeys: string[] = [];
  let worstTileDamage = 0;
  // skip index 0 — that's where the unit already stands, reaction fire only triggers on the steps it takes
  for (let i = 1; i < pathTiles.length; i += 1) {
    const tile = pathTiles[i];
    // The engine zeroes entrench the instant a move starts, so reaction fire actually resolves against
    // an un-entrenched mover. The preview must drop entrench too, or it under-estimates the damage and
    // a genuinely lethal move slips past the risky-move warning.
    const moverAtTile = { ...unit, coordinate: tile, entrench: 0, movedThisRound: true } as UnitInstance;
    const threats = reactionThreats(state, moverAtTile);
    if (threats.length === 0) continue;
    threatenedKeys.push(coordinateKey(tile));
    const tileDamage = threats.reduce((sum, threat) => sum + threat.potentialDamage, 0);
    if (tileDamage > worstTileDamage) worstTileDamage = tileDamage;
  }
  return { threatenedKeys, worstTileDamage };
}
type BattleOutcomeData = {
  status: 'victory' | 'defeat';
  sectorName: string;
  rounds: number;
  enemiesDestroyed: number;
  enemiesTotal: number;
  squadsLost: number;
  squadsSurviving: number;
  objectives: Array<{ text: string; met: boolean }>;
  reward?: { money: number; research: number; strategic: number };
};
const BattleView: React.FC<{
  campaign: CampaignState;
  onVictory: () => void;
  onDefeat: () => void;
  onRetreat: () => void;
  persist: () => void;
}> = ({ campaign, onVictory, onDefeat, onRetreat, persist }) => {
  const { t } = useTranslation(['battle', 'common', 'campaign']);
  const battle = campaign.activeBattle!;
  const { map } = battle.state;
  const [selected, setSelected] = useState<string | null>(null);
  const [deployMode, setDeployMode] = useState(!battle.deployed);
  const [plannedPath, setPlannedPath] = useState<HexCoordinate[] | null>(null);
  const [plannedDestination, setPlannedDestination] = useState<HexCoordinate | null>(null);
  const [invalidMoveFeedback, setInvalidMoveFeedback] = useState<{ coordinate: HexCoordinate; time: number; message: string } | null>(null);
  const [riskyMove, setRiskyMove] = useState<{ unitId: string; target: HexCoordinate; unitName: string; lethal: boolean } | null>(null);
  const [retreatConfirmOpen, setRetreatConfirmOpen] = useState(false);
  const [combatNotices, setCombatNotices] = useState<Array<{ id: number; message: string }>>([]);
  const [phaseNotice, setPhaseNotice] = useState<{ id: number; title: string; detail: string; tone: 'enemy' | 'alliance'; duration: number } | null>(null);
  const [pendingAttack, setPendingAttack] = useState<{ id: string; time: number } | null>(null);
  const [targetedEnemy, setTargetedEnemy] = useState<UnitInstance | null>(null);
  const [hoveredEnemyId, setHoveredEnemyId] = useState<string | null>(null);
  const [cameraRestoreSignal, setCameraRestoreSignal] = useState(0);
  // When a battle ends we freeze on the field and show an outcome card, instead of snapping
  // straight to the strategic map. The deferred apply (rewards, casualties, sector status) only
  // runs when the player dismisses the card via Continue.
  const [battleOutcome, setBattleOutcome] = useState<BattleOutcomeData | null>(null);
  const outcomeShownRef = useRef(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const processor = useMemo(() => new TurnProcessor(battle.state), [battle.state]);
  const visibleTiles = battle.state.vision.alliance.visibleTiles;
  const tileIndex = (coord: HexCoordinate) => coord.r * map.width + coord.q;
  const selectedUnit = selected ? battle.state.sides.alliance.units.get(selected) : undefined;
  const selectedDefinition = selectedUnit ? bundle.units.find((unit) => unit.id === selectedUnit.definitionId) : undefined;
  const retreatForecast = getBattleRetreatForecast(campaign, bundle);
  // For a selected supply truck, the best adjacent friendly unit that needs ammo (computed fresh each
  // render so the Resupply button enables/disables correctly as ammo and positions change).
  const supplyTargetId = (() => {
    if (!selectedUnit || !isSupplyUnit(selectedUnit)) return null;
    let bestId: string | null = null;
    let bestDeficit = 0;
    for (const u of battle.state.sides.alliance.units.values()) {
      if (u.id === selectedUnit.id || u.stance === 'destroyed' || u.embarkedOn) continue;
      const cap = u.stats.ammoCapacity;
      if (cap === undefined || cap === Infinity || u.currentAmmo >= cap) continue;
      const dq = Math.abs(u.coordinate.q - selectedUnit.coordinate.q);
      const dr = Math.abs(u.coordinate.r - selectedUnit.coordinate.r);
      if (Math.max(dq, dr) !== 1) continue; // adjacent (8-dir)
      const deficit = cap - u.currentAmmo;
      if (deficit > bestDeficit) { bestDeficit = deficit; bestId = u.id; }
    }
    return bestId;
  })();
  const healTargetId = (() => {
    if (!selectedUnit || selectedUnit.unitType !== 'support' || !selectedUnit.definitionId.includes('medic')) return null;
    let bestId: string | null = null;
    let worstFrac = 1;
    for (const u of battle.state.sides.alliance.units.values()) {
      if (u.id === selectedUnit.id || u.stance === 'destroyed' || u.embarkedOn) continue;
      if (u.currentHealth >= u.stats.maxHealth) continue;
      const dq = Math.abs(u.coordinate.q - selectedUnit.coordinate.q);
      const dr = Math.abs(u.coordinate.r - selectedUnit.coordinate.r);
      if (Math.max(dq, dr) !== 1) continue; // adjacent (8-dir)
      const frac = u.currentHealth / u.stats.maxHealth;
      if (frac < worstFrac) { worstFrac = frac; bestId = u.id; }
    }
    return bestId;
  })();
  // A hovered enemy previews the shot before you commit; an explicit target still wins if set.
  const hoveredEnemy = (() => {
    if (!hoveredEnemyId || !selectedUnit) return null;
    const u = battle.state.sides.otherSide.units.get(hoveredEnemyId);
    if (!u || u.stance === 'destroyed') return null;
    const idx = u.coordinate.r * battle.state.map.width + u.coordinate.q;
    if (!battle.state.vision.alliance.visibleTiles.has(idx)) return null;
    return u;
  })();
  const previewEnemy = targetedEnemy ?? hoveredEnemy;
  const targetWeaponPreview = selectedUnit && previewEnemy ? bestWeapon(selectedUnit, previewEnemy, battle.state.map, battle.state.weather) : null;
  const targetLineOfFireBlocked = Boolean(selectedUnit && previewEnemy && !targetWeaponPreview &&
    Object.keys(selectedUnit.stats.weaponRanges).some((weaponId) =>
      canWeaponTarget(selectedUnit, weaponId, previewEnemy) &&
      axialDistance(selectedUnit.coordinate, previewEnemy.coordinate) <= calculateAttackRange(selectedUnit, weaponId, battle.state.map) &&
      !hasWeaponLineOfFire(selectedUnit, weaponId, previewEnemy.coordinate, battle.state.map)
    ));
  // Show the REAL expected damage (armor + cover + wound modifiers), not raw weapon power — otherwise the
  // reticle's -N and KILL tag lie about the single most important tactical read in the game.
  const previewDamage = previewEnemy && targetWeaponPreview && selectedUnit
    ? estimateHitDamage(selectedUnit, previewEnemy, targetWeaponPreview.weapon, battle.state.map)
    : undefined;
  const previewLethal = !!previewEnemy && previewDamage !== undefined && previewDamage >= previewEnemy.currentHealth;
  const previewHitChance = previewEnemy && targetWeaponPreview && selectedUnit && !deployMode
    ? calculateHitChance({ attacker: selectedUnit, defender: previewEnemy, weaponId: targetWeaponPreview.weapon, map: battle.state.map, weather: battle.state.weather })
    : undefined;
  const previewEff = previewEnemy && targetWeaponPreview && selectedUnit
    ? typeEffectiveness(selectedUnit, targetWeaponPreview.weapon, previewEnemy)
    : 1;
  const threatenedPathTiles = useMemo(() => {
    if (!plannedPath || !selectedUnit) return undefined;
    const keys = analyzePathThreat(battle.state, selectedUnit, plannedPath).threatenedKeys;
    return keys.length ? keys : undefined;
    // recompute when the planned route or the acting unit changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedPath, selectedUnit, battle.state]);
  const [showRanges, setShowRanges] = useState(false);
  const [attackEffects, setAttackEffects] = useState<AttackEffect[]>([]);
  const attackEffectsRef = useRef(attackEffects);
  attackEffectsRef.current = attackEffects;
  const [arrivalEffects, setArrivalEffects] = useState<ArrivalEffect[]>([]);
  // Movement animation state
  const [movingUnit, setMovingUnit] = useState<MovingUnit | null>(null);
  // Battlefield ambience bed for as long as this view is mounted; weather sets the mood.
  useEffect(() => {
    AudioManager.startAmbience('battle', battle.state.weather ?? 'clear');
    return () => AudioManager.stopAmbience();
  }, [battle.state.weather]);
  const deployModeRef = useRef(deployMode);
  // Pending staged enemy-turn SFX timeouts, so they can be cancelled if the battle ends mid-stagger
  // (otherwise gunfire/explosions bleed over the victory/defeat screen).
  const aiSfxTimeoutsRef = useRef<number[]>([]);
  // Guards Auto Turn against re-entry while the player's staged gunfire plays out before the enemy turn.
  const autoTurnBusyRef = useRef(false);
  // Drives the on-screen "AUTO TURN" indicator. The phase lets the banner say whose turn is auto-playing.
  const [autoTurnPhase, setAutoTurnPhase] = useState<'player' | 'enemy' | null>(null);
  // Set when the player clicks "Stop" during Auto Turn — the auto loop checks it and hands control back.
  const autoTurnAbortRef = useRef(false);
  // True while the enemy turn animates. Together with autoTurnBusyRef it locks out player orders so a
  // stray click can't move a unit (or hijack activeFaction) mid-CPU-turn now that those turns are async.
  const enemyTurnBusyRef = useRef(false);
  const movingUnitRef = useRef<MovingUnit | null>(movingUnit);
  const validationScenarioRef = useRef(false);
  const selectedRef = useRef<string | null>(selected);
  const targetedEnemyRef = useRef<UnitInstance | null>(targetedEnemy);
  const plannedDestinationRef = useRef<HexCoordinate | null>(plannedDestination);
  useEffect(() => { deployModeRef.current = deployMode; }, [deployMode]);
  useEffect(() => { movingUnitRef.current = movingUnit; }, [movingUnit]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { targetedEnemyRef.current = targetedEnemy; }, [targetedEnemy]);
  useEffect(() => { plannedDestinationRef.current = plannedDestination; }, [plannedDestination]);
  // Pathfinder failures carry machine tokens ('unreachable'/'unit_not_found'), not display text.
  const moveFailureText = (reason?: string) => {
    if (reason === 'unreachable') return t('battle:reject.unreachable');
    if (reason === 'unit_not_found') return t('battle:reject.noSelectedUnit');
    return reason ?? t('battle:reject.moveBlocked');
  };
  const describeMoveRejection = (unitId: string, target: HexCoordinate, fallback = t('battle:reject.moveBlocked')) => {
    const unit =
      battle.state.sides.alliance.units.get(unitId) ??
      battle.state.sides.otherSide.units.get(unitId);
    if (!unit) return t('battle:reject.noSelectedUnit');
    if (target.q < 0 || target.r < 0 || target.q >= map.width || target.r >= map.height) {
      return t('battle:reject.outsideBattlefield');
    }
    const targetTile = map.tiles[tileIndex(target)];
    if (!targetTile) return t('battle:reject.outsideBattlefield');
    for (const side of Object.values(battle.state.sides)) {
      for (const other of side.units.values()) {
        if (other.id === unit.id || other.stance === 'destroyed' || other.embarkedOn) continue;
        if (other.coordinate.q === target.q && other.coordinate.r === target.r) {
          return other.faction === unit.faction ? t('battle:reject.occupiedAllied') : t('battle:reject.occupiedHostile');
        }
      }
    }
    if (!targetTile.passable || targetTile.terrain === 'structure') {
      return t('battle:reject.blockedByTerrain', { terrain: t(`common:terrain.${targetTile.terrain}`) });
    }
    if (targetTile.terrain === 'water' && unit.unitType !== 'air') {
      return t('battle:reject.blockedByWater');
    }
    if (targetTile.terrain === 'forest' && unit.unitType !== 'infantry' && unit.unitType !== 'hero') {
      return t('battle:reject.forestBlocks');
    }
    const originalAp = unit.actionPoints;
    unit.actionPoints = 999;
    const unrestrictedPath = planPathForUnit(battle.state, unitId, target);
    unit.actionPoints = originalAp;
    if (unrestrictedPath.success && unrestrictedPath.path.length > 0 && Number.isFinite(unrestrictedPath.cost)) {
      return t('battle:reject.outOfRange', { needed: compactNumber(unrestrictedPath.cost), has: displayActionPoints(originalAp) });
    }
    if (unrestrictedPath.success && unrestrictedPath.path.length === 0) {
      return t('battle:reject.alreadyAtDestination');
    }
    return fallback;
  };
  // Clean up expired attack effects
  useEffect(() => {
    if (attackEffects.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setAttackEffects(prev => prev.filter((effect) =>
        now - effect.startTime < combatEffectTiming(effect.type, effect.arc).totalMs
      ));
    }, 100);
    return () => clearInterval(timer);
  }, [attackEffects.length]);
  useEffect(() => {
    if (arrivalEffects.length === 0) return;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 4200;
      setArrivalEffects((effects) => effects.filter((effect) => effect.startTime >= cutoff));
    }, 100);
    return () => window.clearInterval(timer);
  }, [arrivalEffects.length]);
  // Cancel any staged SFX timeouts when the battle view unmounts (e.g. retreat mid-Auto-Turn), so
  // gunfire/impact sounds don't play over the strategic screen.
  useEffect(() => () => {
    aiSfxTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
    aiSfxTimeoutsRef.current = [];
  }, []);
  // Clean up movement animation when complete
  useEffect(() => {
    if (!movingUnit) return;
    const totalDuration = movingUnitDuration(movingUnit);
    const timer = setTimeout(() => {
      movingUnitRef.current = null;
      setMovingUnit(null);
    }, totalDuration + 50); // small buffer
    return () => clearTimeout(timer);
  }, [movingUnit]);
  const globalRangeOverlay = useMemo(() => {
    const tiles = new Set<string>();
    const legal = new Set<string>();
    const blocked = new Set<string>();
    if (!showRanges || !selectedUnit) return { tiles, blocked };
    for (const weapon of Object.keys(selectedUnit.stats.weaponRanges)) {
      // isoWithinRange + calculateAttackRange mirror the engine's Chebyshev range check (incl.
      // elevation bonus) — the old hexWithinRange drew a hex-metric ring the engine never uses.
      const range = calculateAttackRange(selectedUnit, weapon, map);
      for (const coord of isoWithinRange(selectedUnit.coordinate, range)) {
        if (coord.q < 0 || coord.r < 0 || coord.q >= map.width || coord.r >= map.height) continue;
        const key = `${coord.q},${coord.r}`;
        tiles.add(key);
        if (hasWeaponLineOfFire(selectedUnit, weapon, coord, map)) legal.add(key);
        else blocked.add(key);
      }
    }
    for (const key of legal) blocked.delete(key);
    return { tiles, blocked };
    // Unit instances are mutated in place by the turn processor, so identity alone cannot invalidate
    // this memo after movement or a range upgrade. Keep the mutable fields explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showRanges,
    selectedUnit,
    selectedUnit?.coordinate.q,
    selectedUnit?.coordinate.r,
    selectedUnit?.stats.weaponRanges,
    selectedUnit?.stats.weaponFireModes,
    battle.state.timeline.length,
    map
  ]);
  const globalRangeTiles = globalRangeOverlay.tiles;
  const blockedRangeTiles = globalRangeOverlay.blocked;
  const globalRangeTilesRef = useRef(globalRangeTiles);
  globalRangeTilesRef.current = globalRangeTiles;
  const blockedRangeTilesRef = useRef(blockedRangeTiles);
  blockedRangeTilesRef.current = blockedRangeTiles;
  const battleControlContextRef = useRef<{
    battle: NonNullable<CampaignState['activeBattle']>;
    map: BattlefieldMap;
    persist: () => void;
    resolveOutcome: () => void;
    buildBattleOutcome: (status: 'victory' | 'defeat') => BattleOutcomeData;
    actMove: (unitId: string, target: HexCoordinate, force?: boolean) => boolean;
    addAttackEffect: (
      attacker: UnitInstance,
      defender: UnitInstance,
      weaponId: string,
      outcome: {
        hit: boolean;
        damage: number;
        moraleDamage: number;
        killed: boolean;
        attackMode: 'normal' | 'suppressive';
      }
    ) => ReturnType<typeof combatEffectTiming>;
    t: typeof t;
  } | null>(null);
  useEffect(() => {
    const context = battleControlContextRef.current;
    if (!context) return;
    const { battle, map, persist, resolveOutcome, buildBattleOutcome, actMove, addAttackEffect, t } = context;
    // Resume a saved in-progress battle straight into play; only a fresh battle opens DEPLOYMENT.
    setDeployMode(!battle.deployed);
    // ensure vision populated immediately so tiles are interactive
    updateAllFactionsVision(battle.state);
    // A battle that was decided but never acknowledged (reloaded with the result card up) re-shows it.
    if (battle.resolved) {
      outcomeShownRef.current = true;
      setBattleOutcome(buildBattleOutcome(battle.resolved));
    }
    // default select first unit for immediate click-to-move
    const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
    if (first) setSelected(first.id);
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    const getTile = (coord: HexCoordinate) => {
      if (coord.q < 0 || coord.q >= map.width || coord.r < 0 || coord.r >= map.height) return undefined;
      return map.tiles[coord.r * map.width + coord.q];
    };
    const computeOccupied = () => {
      const occ = new Set<string>();
      for (const side of Object.values(battle.state.sides)) {
        for (const u of side.units.values()) {
          if (u.stance === 'destroyed' || u.embarkedOn) continue;
          occ.add(`${u.coordinate.q},${u.coordinate.r}`);
        }
      }
      return occ;
    };
    const battleControl = {
      movementPresentationForDefinition: (definitionId: string) => {
        const definition = bundle.units.find((candidate) => candidate.id === definitionId);
        if (!definition) return null;
        return {
          audioProfile: movementSoundProfileFor(definition.type, definition.id),
          directionalSprite: battlefieldDirectionalSprite(definition.type, definition.id)
        };
      },
      movementAudioState: () => AudioManager.getLastMovementCue(),
      rosterDefinitions: () => bundle.units.map((definition) => ({
        id: definition.id,
        faction: definition.faction,
        type: definition.type,
        weaponIds: Object.keys(definition.stats.weaponRanges),
        maxRange: Math.max(0, ...Object.values(definition.stats.weaponRanges)),
        supply: definition.type === 'support' && definition.stats.ammoCapacity === 0
      })),
      loadDefinitions: (definitionIds: string[]) => {
        validationScenarioRef.current = true;
        const requestedDefinitions = definitionIds
          .map((definitionId) => bundle.units.find((definition) => definition.id === definitionId))
          .filter((definition): definition is (typeof bundle.units)[number] => Boolean(definition));
        const spawnTiles = map.tiles
          .map((tile, index) => ({ tile, q: index % map.width, r: Math.floor(index / map.width) }))
          .filter(({ tile, q, r }) => tile.passable
            && tile.terrain !== 'water'
            && tile.terrain !== 'structure'
            && q > 0 && r > 0 && q < map.width - 1 && r < map.height - 1)
          .sort((a, b) => (a.q + a.r) - (b.q + b.r));
        if (spawnTiles.length < requestedDefinitions.length) {
          return { success: false, loaded: [], missing: definitionIds };
        }

        battle.state.sides.alliance.units.clear();
        battle.state.sides.otherSide.units.clear();
        for (const rosterId of Object.keys(battle.deployment)) delete battle.deployment[rosterId];
        const loaded: Array<{ id: string; definitionId: string; faction: string; q: number; r: number }> = [];
        const batchId = Date.now();
        requestedDefinitions.forEach((definition, index) => {
          const spawn = spawnTiles[index];
          const instance = createUnitInstance(
            definition,
            definition.faction,
            { q: spawn.q, r: spawn.r },
            `qa-${batchId}-${index}-${definition.id}`
          );
          battle.state.sides[definition.faction].units.set(instance.id, instance);
          loaded.push({
            id: instance.id,
            definitionId: instance.definitionId,
            faction: instance.faction,
            q: instance.coordinate.q,
            r: instance.coordinate.r
          });
        });

        battle.state.activeFaction = 'alliance';
        battle.state.timeline.length = 0;
        battle.deployed = true;
        battle.resolved = undefined;
        outcomeShownRef.current = false;
        deployModeRef.current = false;
        movingUnitRef.current = null;
        autoTurnAbortRef.current = false;
        setDeployMode(false);
        setBattleOutcome(null);
        setMovingUnit(null);
        setAttackEffects([]);
        setArrivalEffects([]);
        setShowRanges(false);
        setTargetedEnemy(null);
        setPendingAttack(null);
        setPlannedPath(null);
        setPlannedDestination(null);
        setInvalidMoveFeedback(null);
        updateAllFactionsVision(battle.state);
        const allTiles = new Set(map.tiles.map((_, index) => index));
        battle.state.vision.alliance.visibleTiles = allTiles;
        battle.state.vision.alliance.exploredTiles = new Set(allTiles);
        const selectedId = loaded.find((unit) => unit.faction === 'alliance')?.id ?? null;
        setSelected(selectedId);
        setCameraRestoreSignal((signal) => signal + 1);
        return {
          success: requestedDefinitions.length === definitionIds.length,
          loaded,
          missing: definitionIds.filter((definitionId) => !requestedDefinitions.some((definition) => definition.id === definitionId))
        };
      },
      activeAttackEffects: () => attackEffectsRef.current.map((effect) => ({
        id: effect.id,
        targetId: effect.targetId,
        type: effect.type,
        arc: effect.arc,
        hit: effect.hit,
        suppressive: effect.suppressive,
        moraleDamage: effect.moraleDamage,
        killed: effect.killed,
        startTime: effect.startTime
      })),
      moveFirst: () => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        const foe = Array.from(battle.state.sides.otherSide.units.values()).find((u) => u.stance !== 'destroyed');
        if (!first || !foe) return false;
        const neighbors: HexCoordinate[] = [
          { q: first.coordinate.q + 1, r: first.coordinate.r },
          { q: first.coordinate.q, r: first.coordinate.r + 1 },
          { q: first.coordinate.q + 1, r: first.coordinate.r - 1 },
          { q: first.coordinate.q - 1, r: first.coordinate.r },
          { q: first.coordinate.q, r: first.coordinate.r - 1 },
          { q: first.coordinate.q - 1, r: first.coordinate.r + 1 }
        ];
        const step = neighbors.find((n) => {
          const tile = getTile(n);
          if (!tile || !tile.passable) return false;
          return !computeOccupied().has(`${n.q},${n.r}`);
        });
        if (!step) return false;
        const proc = new TurnProcessor(battle.state);
        proc.moveUnit({ unitId: first.id, path: [step] });
        persist();
        return true;
      },
      attackFirst: () => {
        const first = Array.from(battle.state.sides.alliance.units.values())
          .filter((u) => u.stance !== 'destroyed')
          .sort((a, b) => {
            const ra = Math.max(...Object.values(a.stats.weaponRanges));
            const rb = Math.max(...Object.values(b.stats.weaponRanges));
            return rb - ra;
          })[0];
        const living = Array.from(battle.state.sides.otherSide.units.values()).filter((u) => u.stance !== 'destroyed');
        if (!first || living.length === 0) return false;
        const foe = living.sort((a, b) => axialDistance(first.coordinate, a.coordinate) - axialDistance(first.coordinate, b.coordinate))[0];
        const weapon = Object.keys(first.stats.weaponRanges).sort((a, b) => (first.stats.weaponRanges[b] ?? 0) - (first.stats.weaponRanges[a] ?? 0))[0];
        if (!weapon) return false;
        const proc = new TurnProcessor(battle.state);
        // The foe's own tile is always occupied, so pathing straight to it is always 'unreachable' —
        // path to the closest reachable tile next to the foe instead.
        const approachTile = isoNeighbors(battle.state.map, foe.coordinate)
          .map((tile) => ({ tile, path: planPathForUnit(battle.state, first.id, tile) }))
          .filter((candidate) => candidate.path.success)
          .sort((a, b) => a.path.cost - b.path.cost)[0];
        if (approachTile) {
          proc.moveUnit({ unitId: first.id, path: approachTile.path.path });
        }
        const distNow = axialDistance(first.coordinate, foe.coordinate);
        if (distNow > (first.stats.weaponRanges[weapon] ?? 0)) return false;
        const res = proc.attackUnit({ attackerId: first.id, defenderId: foe.id, weaponId: weapon });
        persist();
        return res.success;
      },
      attackUnitWith: (attackerId: string, defenderId: string, requestedWeaponId?: string) => {
        const attacker = battle.state.sides.alliance.units.get(attackerId);
        if (!attacker) return { success: false, error: `Unit ${attackerId} not found` };
        const defender = battle.state.sides.otherSide.units.get(defenderId);
        if (!defender) return { success: false, error: `Unit ${defenderId} not found` };
        const weapon = requestedWeaponId && requestedWeaponId in attacker.stats.weaponRanges
          ? requestedWeaponId
          : Object.keys(attacker.stats.weaponRanges).sort((a, b) => {
              const rangeDiff = (attacker.stats.weaponRanges[b] ?? 0) - (attacker.stats.weaponRanges[a] ?? 0);
              if (rangeDiff !== 0) return rangeDiff;
              return (attacker.stats.weaponPower[b] ?? 0) - (attacker.stats.weaponPower[a] ?? 0);
            })[0];
        if (!weapon) return { success: false, error: 'No weapon available' };
        const proc = new TurnProcessor(battle.state, { random: () => 0 });
        const res = proc.attackUnit({ attackerId, defenderId, weaponId: weapon });
        if (!res.success) {
          setCombatNotices((existing) => [{ id: nextNoticeId(), message: res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:attackFailed') }, ...existing].slice(0, 4));
        } else {
          const attackOutcome = visualOutcomeForAttack(res.events as BattleEvent[] | undefined, attackerId, defenderId);
          addAttackEffect(attacker, defender, weapon, attackOutcome);
        }
        persist();
        if (!validationScenarioRef.current) resolveOutcome();
        return { ...res, weaponId: weapon, actionPoints: attacker.actionPoints };
      },
      setActionPoints: (unitId: string, actionPoints: number) => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (unit) {
            unit.actionPoints = actionPoints;
            persist();
            return true;
          }
        }
        return false;
      },
      setHealth: (unitId: string, currentHealth: number) => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (unit) {
            unit.currentHealth = Math.max(1, Math.min(unit.stats.maxHealth, currentHealth));
            return true;
          }
        }
        return false;
      },
      endTurn: () => {
        const proc = new TurnProcessor(battle.state);
        proc.endTurn();
        persist();
        return true;
      },
      moveTo: (q: number, r: number) => {
        const first = Array.from(battle.state.sides.alliance.units.values())
          .filter((u) => u.stance !== 'destroyed')
          .sort((a, b) => b.maxActionPoints - a.maxActionPoints)[0];
        if (!first) return false;
        const path = planPathForUnit(battle.state, first.id, { q, r });
        if (!path.success || !path.path.length) return false;
        const proc = new TurnProcessor(battle.state);
        const res = proc.moveUnit({ unitId: first.id, path: path.path });
        persist();
        return res.success;
      },
      moveUnitTo: (unitId: string, q: number, r: number) => {
        const path = planPathForUnit(battle.state, unitId, { q, r });
        if (!path.success || !path.path.length) return false;
        const proc = new TurnProcessor(battle.state);
        const res = proc.moveUnit({ unitId, path: path.path });
        persist();
        return res.success;
      },
      moveUnitPath: (unitId: string, path: HexCoordinate[]) => {
        const proc = new TurnProcessor(battle.state);
        const res = proc.moveUnit({ unitId, path });
        persist();
        return res;
      },
      snapUnit: (unitId: string, q: number, r: number) => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (unit) {
            unit.coordinate = { q, r };
            unit.embarkedOn = undefined;
            updateAllFactionsVision(battle.state);
            persist();
            return true;
          }
        }
        return false;
      },
      placeVisionBlocker: (q: number, r: number) => {
        const tile = getTile({ q, r });
        if (!tile) return false;
        tile.blocksVision = true;
        tile.cover = Math.max(3, tile.cover);
        updateAllFactionsVision(battle.state);
        persist();
        return true;
      },
      placeDestructibleVisionBlocker: (q: number, r: number, hp = 1) => {
        const tile = getTile({ q, r });
        if (!tile) return false;
        tile.terrain = 'urban';
        tile.blocksVision = true;
        tile.cover = 3;
        tile.destructible = true;
        tile.hp = hp;
        updateAllFactionsVision(battle.state);
        persist();
        return true;
      },
      setWeaponFireMode: (unitId: string, weaponId: string, mode: 'direct' | 'indirect') => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (!unit || !(weaponId in unit.stats.weaponRanges)) continue;
          unit.stats.weaponFireModes = { ...unit.stats.weaponFireModes, [weaponId]: mode };
          return true;
        }
        return false;
      },
      forceDisembark: (unitId: string) => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (unit) {
            unit.embarkedOn = undefined;
            return true;
          }
        }
        return false;
      },
      visibleEnemyCount: () => {
        const vis = battle.state.vision.alliance.visibleTiles;
        let count = 0;
        for (const u of battle.state.sides.otherSide.units.values()) {
          const idx = u.coordinate.r * map.width + u.coordinate.q;
          if (vis.has(idx) && u.stance !== 'destroyed') count += 1;
        }
        return count;
      },
      revealAll: () => {
        const allTiles = new Set(map.tiles.map((_, index) => index));
        battle.state.vision.alliance.visibleTiles = allTiles;
        battle.state.vision.alliance.exploredTiles = new Set(allTiles);
        return true;
      },
      wipeEnemies: () => {
        for (const u of battle.state.sides.otherSide.units.values()) {
          u.stance = 'destroyed';
          u.currentHealth = 0;
        }
        return true;
      },
      attackTile: (q: number, r: number) => {
        const attacker = Array.from(battle.state.sides.alliance.units.values())
          .filter((u) => u.stance !== 'destroyed')
          .sort((a, b) => {
            const maxA = Math.max(...Object.values(a.stats.weaponRanges));
            const maxB = Math.max(...Object.values(b.stats.weaponRanges));
            return maxB - maxA;
          })[0];
        if (!attacker) return false;
        const weapon = Object.keys(attacker.stats.weaponRanges).sort((a, b) => {
          const rangeDiff = (attacker.stats.weaponRanges[b] ?? 0) - (attacker.stats.weaponRanges[a] ?? 0);
          if (rangeDiff !== 0) return rangeDiff;
          return (attacker.stats.weaponPower[b] ?? 0) - (attacker.stats.weaponPower[a] ?? 0);
        })[0];
        if (!weapon) return false;
        const proc = new TurnProcessor(battle.state);
        const desired = { q, r };
        const currentRange = attacker.stats.weaponRanges[weapon] ?? 0;
        if (axialDistance(attacker.coordinate, desired) > currentRange) {
          const path = planPathForUnit(battle.state, attacker.id, desired);
          if (path.success && path.path.length) {
            // walk until in range or out of AP
            const partial: HexCoordinate[] = [];
            for (const step of path.path) {
              partial.push(step);
              if (axialDistance(step, desired) <= currentRange) break;
            }
            proc.moveUnit({ unitId: attacker.id, path: partial });
          }
        }
        const distanceAfter = axialDistance(attacker.coordinate, desired);
        const maxRange = attacker.stats.weaponRanges[weapon] ?? 0;
        if (distanceAfter > maxRange) {
          return { success: false, error: 'still_out_of_range', distance: distanceAfter, range: maxRange };
        }
        const res = proc.attackTile({ attackerId: attacker.id, target: { q, r }, weaponId: weapon });
        persist();
        resolveOutcome();
        return { ...res, attackerId: attacker.id, ammoAfter: attacker.currentAmmo };
      },
      pathTo: (q: number, r: number) => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (!first) return { success: false, path: [], cost: 0, reason: 'no_unit' };
        return planPathForUnit(battle.state, first.id, { q, r });
      },
      pathForUnit: (unitId: string, q: number, r: number) => planPathForUnit(battle.state, unitId, { q, r }),
      moveSelectedTo: (q: number, r: number) => {
        const selectedUnitId = selectedRef.current;
        if (!selectedUnitId) return false;
        return actMove(selectedUnitId, { q, r });
      },
      animateUnitTo: (unitId: string, q: number, r: number) => actMove(unitId, { q, r }),
      animationState: () => movingUnitRef.current,
      deployMode: () => deployModeRef.current,
      selectionState: () => ({
        selectedUnitId: selectedRef.current,
        targetedEnemyId: targetedEnemyRef.current?.id ?? null
      }),
      planningState: () => ({
        plannedDestination: plannedDestinationRef.current
      }),
      rangeOverlayTiles: () => Array.from(globalRangeTilesRef.current).sort(),
      blockedRangeOverlayTiles: () => Array.from(blockedRangeTilesRef.current).sort(),
      objectives: () => battle.scenario.objectives.map((objective) => ({
        id: objective.id,
        kind: objective.kind,
        target: objective.target,
        optional: Boolean(objective.optional),
        actionKey: objective.actionKey,
        actionPoints: objective.actionPoints,
        completed: isObjectiveMet(objective, battle)
      })),
      replaceObjectives: (objectives: typeof battle.scenario.objectives) => {
        battle.scenario.objectives = structuredClone(objectives);
        battle.completedObjectiveIds = [];
        battle.reachClaimedRound = {};
        battle.holdProgress = {};
        battle.holdCountedRound = {};
        persist();
        return true;
      },
      deploymentRosterIds: () => Object.keys(battle.deployment),
      ammoFirst: () => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (!first) return null;
        return { ammo: first.currentAmmo, cap: first.stats.ammoCapacity ?? null };
      },
      drainAmmo: (amount = 1) => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (!first) return false;
        if (first.currentAmmo !== Infinity) {
          first.currentAmmo = Math.max(0, first.currentAmmo - amount);
        }
        return true;
      },
      embark: (carrierId: string, passengerId: string) => {
        const proc = new TurnProcessor(battle.state);
        const res = proc.embark({ carrierId, passengerId });
        persist();
        return res;
      },
      disembark: (passengerId: string, q: number, r: number) => {
        const proc = new TurnProcessor(battle.state);
        const res = proc.disembark({ passengerId, target: { q, r } });
        persist();
        return res.success;
      },
      allyPositions: () => {
        return Array.from(battle.state.sides.alliance.units.values()).map((u) => ({
          id: u.id,
          q: u.coordinate.q,
          r: u.coordinate.r,
          ap: u.actionPoints
        }));
      },
      allyUnits: () => {
        return Array.from(battle.state.sides.alliance.units.values()).map((u) => ({
          id: u.id,
          type: u.unitType,
          definitionId: u.definitionId,
          coord: u.coordinate,
          orientation: u.orientation,
          ap: u.actionPoints,
          morale: u.currentMorale,
          stance: u.stance,
          entrench: u.entrench ?? 0,
          embarkedOn: u.embarkedOn,
          carrying: u.carrying,
          cap: u.stats.transportCapacity ?? 0,
          supply: isSupplyUnit(u),
          weapons: Object.keys(u.stats.weaponRanges)
        }));
      },
      enemyUnits: () => {
        const visible = battle.state.vision.alliance.visibleTiles;
        return Array.from(battle.state.sides.otherSide.units.values()).map((u) => ({
          id: u.id,
          type: u.unitType,
          definitionId: u.definitionId,
          coord: u.coordinate,
          orientation: u.orientation,
          ap: u.actionPoints,
          stance: u.stance,
          visible: visible.has(u.coordinate.r * map.width + u.coordinate.q)
        }));
      },
      forceAllianceTurn: () => {
        battle.state.activeFaction = 'alliance';
        for (const u of battle.state.sides.alliance.units.values()) {
          u.actionPoints = u.maxActionPoints;
        }
        updateAllFactionsVision(battle.state);
        persist();
        return true;
      },
      selectUnit: (unitId?: string) => {
        const target = unitId
          ? battle.state.sides.alliance.units.get(unitId)
          : Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (!target) return false;
        setSelected(target.id);
        setPlannedPath(null);
        setPlannedDestination(null);
        setPendingAttack(null);
        setTargetedEnemy(null);
        setInvalidMoveFeedback(null);
        return true;
      },
      clearSelection: () => {
        setSelected(null);
        setPlannedPath(null);
        setPlannedDestination(null);
        setPendingAttack(null);
        setTargetedEnemy(null);
        setInvalidMoveFeedback(null);
        return true;
      },
      targetEnemy: (unitId: string) => {
        const target = battle.state.sides.otherSide.units.get(unitId);
        if (!target || target.stance === 'destroyed') return false;
        setTargetedEnemy(target);
        setPendingAttack({ id: target.id, time: Date.now() });
        setInvalidMoveFeedback(null);
        return true;
      },
      setOverwatch: (unitId?: string) => {
        const target = unitId
          ? battle.state.sides.alliance.units.get(unitId)
          : Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (!target) return false;
        const proc = new TurnProcessor(battle.state);
        const res = proc.setOverwatch(target.id);
        persist();
        return res;
      },
      setUnitMorale: (unitId: string, morale: number) => {
        const target = Object.values(battle.state.sides)
          .map((side) => side.units.get(unitId))
          .find((unit): unit is UnitInstance => Boolean(unit));
        if (!target) return false;
        target.currentMorale = Math.max(0, Math.min(100, morale));
        target.stance = target.currentMorale <= 20 ? 'routed' : target.currentMorale <= 40 ? 'suppressed' : 'ready';
        persist();
        return true;
      },
      digIn: (unitId: string) => {
        const proc = new TurnProcessor(battle.state);
        const res = proc.digIn(unitId);
        persist();
        return res;
      },
      rally: (unitId: string) => {
        const proc = new TurnProcessor(battle.state);
        const res = proc.rally(unitId);
        persist();
        return res;
      },
      suppressUnitWith: (attackerId: string, defenderId: string, weaponId?: string) => {
        const attacker = battle.state.sides.alliance.units.get(attackerId);
        const defender = battle.state.sides.otherSide.units.get(defenderId);
        if (!attacker || !defender) return { success: false, error: 'Unit not found' };
        const weapon = weaponId ?? bestWeapon(attacker, defender, battle.state.map, battle.state.weather)?.weapon;
        if (!weapon) return { success: false, error: 'No weapon available' };
        const proc = new TurnProcessor(battle.state, { random: () => 0 });
        const res = proc.suppressUnit({ attackerId, defenderId, weaponId: weapon });
        if (res.success) {
          addAttackEffect(
            attacker,
            defender,
            weapon,
            visualOutcomeForAttack(res.events as BattleEvent[] | undefined, attackerId, defenderId)
          );
        }
        persist();
        return res;
      },
      attackTileWith: (attackerId: string, q: number, r: number, weaponId: string) => {
        const proc = new TurnProcessor(battle.state, { random: () => 0 });
        const res = proc.attackTile({ attackerId, target: { q, r }, weaponId });
        persist();
        return res;
      },
      killAllEnemies: () => {
        let killed = 0;
        for (const unit of battle.state.sides.otherSide.units.values()) {
          if (unit.stance !== 'destroyed') {
            unit.stance = 'destroyed';
            unit.currentHealth = 0;
            killed++;
          }
        }
        persist();
        return `Killed ${killed} enemies`;
      },
      killAllAllies: () => {
        let killed = 0;
        for (const unit of battle.state.sides.alliance.units.values()) {
          if (unit.stance !== 'destroyed') {
            unit.stance = 'destroyed';
            unit.currentHealth = 0;
            killed++;
          }
        }
        persist();
        resolveOutcome();
        return `Killed ${killed} allies`;
      },
      checkVictory: () => {
        const status = evaluateBattleOutcome(battle);
        const enemies = Array.from(battle.state.sides.otherSide.units.values());
        const survivingEnemies = enemies.filter((u) => u.stance !== 'destroyed');
        return { status, totalEnemies: enemies.length, surviving: survivingEnemies.length };
      }
    };
    const devWindow = window as typeof window & { __battleControl?: typeof battleControl };
    devWindow.__battleControl = battleControl;
    return () => {
      delete devWindow.__battleControl;
    };
  }, [battle.state, map.width, map.height]);
  const handleSelect = (unit: UnitInstance) => {
    if (battle.state.activeFaction !== 'alliance') return;
    if (unit.faction !== 'alliance') return;
    AudioManager.play('select');
    setSelected(unit.id);
    setPlannedPath(null);
    setPlannedDestination(null);
    setPendingAttack(null);
    clearTargeting(true);
    setInvalidMoveFeedback(null);
  };
  const resolveOutcome = () => {
    // evaluateBattleOutcome ticks hold objectives (idempotent per round); a change means progress.
    const holdBefore = JSON.stringify(battle.holdProgress);
    const status = evaluateBattleOutcome(battle);
    if (status === 'ongoing' && JSON.stringify(battle.holdProgress) !== holdBefore) {
      AudioManager.play('objective');
    }
    if (status === 'victory' || status === 'defeat') {
      if (outcomeShownRef.current) return; // already showing the result card; don't re-fire
      outcomeShownRef.current = true;
      // cancel pending staged enemy SFX so gunfire/explosions don't play over the result screen
      aiSfxTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
      aiSfxTimeoutsRef.current = [];
      AudioManager.duckAmbience();
      AudioManager.play(status === 'victory' ? 'victory' : 'defeat');
      setBattleOutcome(buildBattleOutcome(status));
      // Persist that the battle is decided (reward still applied on Continue). A reload now re-shows
      // the card instead of dropping the victory's reward/territory unlock.
      battle.resolved = status;
      persist();
    }
  };
  // Snapshot the just-finished battle into a result card. Reads battle.state directly (still intact —
  // applyBattleOutcome, which mutates the campaign, is deferred until the player hits Continue).
  const buildBattleOutcome = (status: 'victory' | 'defeat'): BattleOutcomeData => {
    const enemyUnits = Array.from(battle.state.sides.otherSide.units.values());
    const allyUnits = Array.from(battle.state.sides.alliance.units.values());
    const isDead = (u: UnitInstance) => u.stance === 'destroyed' || u.currentHealth <= 0;
    const territory = campaign.territories.find((t) => t.id === battle.territoryId);
    // Count only deployed ROSTER squads — exclude the ephemeral supply truck and NPC allied support
    // (which aren't in campaign.army), mirroring applyBattleOutcome's casualty accounting.
    const deployedTacticalIds = new Set(
      Object.entries(battle.deployment)
        .filter(([rosterId]) => campaign.army.some((a) => a.id === rosterId))
        .map(([, tacticalId]) => tacticalId)
    );
    const rosterUnits = allyUnits.filter((u) => deployedTacticalIds.has(u.id));
    return {
      status,
      sectorName: localizedScenarioName(battle.scenario.id, battle.scenario.name),
      rounds: battle.state.round,
      enemiesTotal: enemyUnits.length,
      enemiesDestroyed: enemyUnits.filter(isDead).length,
      squadsLost: rosterUnits.filter(isDead).length,
      squadsSurviving: rosterUnits.filter((u) => !isDead(u)).length,
      objectives: (battle.scenario.objectives ?? []).map((o) => ({
        text: localizedObjectiveText(battle.scenario.id, o.id, o.description),
        met: isObjectiveMet(o, battle)
      })),
      reward: status === 'victory' && territory ? { ...territory.reward } : undefined
    };
  };
  // Player dismissed the result card → now commit the outcome to the campaign and leave the battle.
  const confirmBattleOutcome = () => {
    if (!battleOutcome) return;
    const status = battleOutcome.status;
    applyBattleOutcome(campaign, bundle, status);
    persist();
    setBattleOutcome(null);
    if (status === 'victory') onVictory();
    else onDefeat();
  };
  const addCombatNotice = (message: string, ttlMs = 1800) => {
    const id = nextNoticeId(); // monotonic — Date.now() collided when several notices fired in one ms
    setCombatNotices((existing) => [{ id, message }, ...existing].slice(0, 4));
    window.setTimeout(() => {
      setCombatNotices((existing) => existing.filter((notice) => notice.id !== id));
    }, ttlMs);
  };
  // Impact audio for a connecting hit: weight/timbre/stereo from the target, plus a critical-health
  // sting when this blow drops a survivor below 25% (edge-triggered so it fires once, after the hit).
  const playImpact = (defender: UnitInstance, damage: number, hpBeforeRatio: number, delayMs = 0) => {
    const killed = defender.currentHealth <= 0;
    const opts = {
      intensity: Math.min(1, (damage || 0) / 25),
      material: impactMaterialFor(defender),
      pan: impactPanFor(defender, battle.state.map)
    };
    const emit = () => {
      AudioManager.play(killed ? 'death' : 'hit', opts);
      if (!killed) {
        const hpAfter = defender.currentHealth / (defender.stats.maxHealth || 100);
        if (hpBeforeRatio >= 0.25 && hpAfter < 0.25 && hpAfter > 0) {
          window.setTimeout(() => AudioManager.play('lowHealth'), 320);
        }
      }
    };
    if (delayMs > 0) aiSfxTimeoutsRef.current.push(window.setTimeout(emit, delayMs));
    else emit();
  };
  // Visualize reaction/overwatch fire provoked by a move: muzzle + HIT/MISS + shot/impact sound, anchored
  // to the tile the mover was crossing (defenderAt) and timed to when its glide reaches that tile. Used by
  // the player's move, the auto-player turn, AND the enemy turn — so the player's overwatch shots are never
  // invisible and a reaction kill never reads as "the enemy died for no reason".
  const playReactionVfx = (moverId: string, moving: MovingUnit | null, timelineBefore: number) => {
    let shots = 0;
    for (const ev of battle.state.timeline.slice(timelineBefore)) {
      if (ev.kind !== 'unit:attacked' || ev.defenderId !== moverId) continue;
      const shooter = findBattleUnit(ev.attackerId);
      const target = findBattleUnit(ev.defenderId);
      if (!shooter || !target) continue;
      const reactAt = ev.defenderAt ?? target.coordinate;
      const delay = (moving ? arrivalDelayForPath(moving, reactAt) : 150) + shots * 40;
      if (shots === 0) aiSfxTimeoutsRef.current.push(window.setTimeout(() => AudioManager.play('reaction'), Math.max(0, delay - 120)));
      const killed = ev.defenderRemainingHealth === 0;
      const sfx = firingSound(shooter, target, ev.weapon);
      const timing = addAttackEffect(shooter, target, ev.weapon, {
        hit: ev.hit !== false,
        damage: ev.damage ?? 0,
        moraleDamage: ev.moraleDamage ?? 0,
        killed,
        attackMode: ev.attackMode ?? 'normal'
      }, delay, reactAt);
      aiSfxTimeoutsRef.current.push(window.setTimeout(() => {
        AudioManager.play(sfx);
        if (ev.hit !== false) window.setTimeout(() => AudioManager.play(killed ? 'death' : 'hit', { intensity: Math.min(1, (ev.damage ?? 0) / 25), material: impactMaterialFor(target), pan: impactPanFor(target, battle.state.map) }), timing.impactAtMs);
      }, delay));
      shots += 1;
    }
  };
  function clearTargeting(restoreCamera = false) {
    if (restoreCamera && targetedEnemy) {
      setCameraRestoreSignal((current) => current + 1);
    }
    setTargetedEnemy(null);
    setPendingAttack(null);
  }
  const showPhaseNotice = (title: string, detail: string, tone: 'enemy' | 'alliance' = 'alliance', duration = 1300) => {
    const id = nextNoticeId(); // monotonic — Date.now() collided when several notices fired in one ms
    setPhaseNotice({ id, title, detail, tone, duration });
    window.setTimeout(() => {
      setPhaseNotice((current) => current?.id === id ? null : current);
    }, duration);
  };
  const presentTacticalEvents = (events: TriggeredTacticalEvent[]) => {
    if (events.length === 0) return;
    const startedAt = Date.now();
    setArrivalEffects((effects) => [
      ...effects,
      ...events.flatMap((event) => event.units.map((unit) => ({
        id: `${event.id}:${unit.id}:${startedAt}`,
        coordinate: unit.coordinate,
        faction: event.faction,
        startTime: startedAt
      })))
    ]);
    const event = events[0];
    const count = events.reduce((total, current) => total + current.units.length, 0);
    showPhaseNotice(
      t(`battle:scriptedEvents.${event.messageKey}.title`),
      t(`battle:scriptedEvents.${event.messageKey}.detail`, { count }),
      event.faction === 'otherSide' ? 'enemy' : 'alliance',
      4200
    );
    const arcaneArrival = ['portalSurge', 'nightAmbush', 'signalEaterAwakes', 'glassChoirMarches', 'ashCrownDescends']
      .includes(event.messageKey);
    AudioManager.play(arcaneArrival ? 'magic' : 'objective');
  };
  const findBattleUnit = (unitId: string) => {
    for (const side of Object.values(battle.state.sides)) {
      const unit = side.units.get(unitId);
      if (unit) return unit;
    }
    return undefined;
  };
  const executeObjectiveAction = (unitId: string, objectiveId: string, announce = true) => {
    const result = performObjectiveAction(battle, unitId, objectiveId);
    if (!result.success) {
      if (announce) {
        showToast(result.errorKey ? t(`errors:${result.errorKey}`) : t('errors:objectiveActionInvalid'), 'error');
      }
      return result;
    }

    const objective = battle.scenario.objectives.find((candidate) => candidate.id === objectiveId)!;
    const action = t(`actions:objective.action.${objective.actionKey}`);
    if (announce) {
      addCombatNotice(t('battle:notice.objectiveActionDetail', { action }));
      showPhaseNotice(
        t('battle:notice.objectiveActionTitle'),
        t('battle:notice.objectiveActionDetail', { action }),
        'alliance',
        2200
      );
      AudioManager.play('objective');
    }
    presentTacticalEvents(processTacticalEvents(campaign, bundle));
    persist();
    resolveOutcome();
    return result;
  };
  const addAttackEffect = (
    attacker: UnitInstance,
    defender: UnitInstance,
    weaponId: string,
    outcome: { hit: boolean; damage: number; moraleDamage: number; killed: boolean; attackMode: 'normal' | 'suppressive' },
    delay = 0,
    atCoord?: { q: number; r: number }
  ) => {
    const to = atCoord ?? defender.coordinate;
    const presentation = combatEffectForShot(attacker.definitionId, weaponId, outcome.attackMode);
    const effectType = presentation.type;
    const arc = isIndirectFire(attacker, weaponId);
    const timing = combatEffectTiming(effectType, arc);
    const noticeTone = attacker.faction === 'alliance' ? 'alliance' : 'enemy';
    const noticeTitle = presentation.suppressive
      ? t('battle:notice.suppressionTitle')
      : outcome.hit ? t('battle:notice.hitTitle') : t('battle:notice.missTitle');
    const noticeDetail = presentation.suppressive
      ? t('battle:notice.suppressionDetail', {
          defender: unitDisplayName(defender.id, battle.state),
          morale: outcome.moraleDamage
        })
      : outcome.hit
        ? t('battle:notice.hitDetail', { defender: unitDisplayName(defender.id, battle.state), damage: outcome.damage })
        : t('battle:notice.missDetail', { attacker: unitDisplayName(attacker.id, battle.state), defender: unitDisplayName(defender.id, battle.state) });
    window.setTimeout(() => showPhaseNotice(noticeTitle, noticeDetail, noticeTone), delay);
    setAttackEffects(prev => [...prev, {
      id: `${attacker.id}-${defender.id}-${nextEffectId()}`,
      targetId: defender.id,
      fromQ: attacker.coordinate.q,
      fromR: attacker.coordinate.r,
      toQ: to.q,
      toR: to.r,
      startTime: Date.now() + delay,
      type: effectType,
      arc,
      damage: outcome.damage,
      moraleDamage: outcome.moraleDamage,
      hit: outcome.hit,
      killed: outcome.killed,
      suppressive: presentation.suppressive
    }]);
    return timing;
  };
  const rejectMove = (coord: HexCoordinate, message = t('battle:reject.moveBlocked')) => {
    AudioManager.play('error');
    const time = Date.now();
    setInvalidMoveFeedback({ coordinate: { ...coord }, time, message });
    addCombatNotice(message);
    window.setTimeout(() => {
      setInvalidMoveFeedback((current) => current?.time === time ? null : current);
    }, 1800);
  };
  const actMove = (unitId: string, target: HexCoordinate, force = false) => {
    if (autoTurnBusyRef.current || enemyTurnBusyRef.current) return false; // CPU is acting
    if (deployModeRef.current) return false;
    if (movingUnitRef.current) return false; // Don't start new movement while animating
    const unit = battle.state.sides.alliance.units.get(unitId);
    const targetInBounds = target.q >= 0 && target.r >= 0 && target.q < map.width && target.r < map.height;
    const rejectionCoord = targetInBounds ? target : (unit?.coordinate ?? { q: 0, r: 0 });
    const path = planPathForUnit(battle.state, unitId, target);
    if (!path.success || path.cost === undefined || path.path.length === 0) {
      rejectMove(rejectionCoord, describeMoveRejection(unitId, target, moveFailureText(path.reason)));
      return false;
    }
    if (!unit) return false;
    // Warn before walking a fragile unit into enemy reaction fire — the route crosses tiles where
    // enemies can shoot, and either the unit is already low or one tile's fire could outright kill it.
    if (!force) {
      const fullPath = [unit.coordinate, ...path.path];
      const { threatenedKeys, worstTileDamage } = analyzePathThreat(battle.state, unit, fullPath);
      if (threatenedKeys.length > 0) {
        const lowHp = unit.currentHealth <= unit.stats.maxHealth * 0.4;
        const lethal = unit.currentHealth <= worstTileDamage;
        if (lowHp || lethal) {
          const def = bundle.units.find((d) => d.id === unit.definitionId);
          setRiskyMove({ unitId, target, unitName: localizedUnitName(unit.definitionId, def?.name ?? unit.definitionId), lethal });
          return false;
        }
      }
    }
    const startCoord = { q: unit.coordinate.q, r: unit.coordinate.r };
    const timelineBefore = battle.state.timeline.length;
    const moveResult = processor.moveUnit({ unitId, path: path.path });
    if (!moveResult.success) {
      setPlannedPath(null);
      setPlannedDestination(null);
      rejectMove(rejectionCoord, moveResult.errorKey ? t(`errors:${moveResult.errorKey}`) : t('battle:reject.moveOrderBlocked'));
      return false;
    }
    // Set up the glide FIRST so we know its timing, then sync the reaction-fire VFX to it — otherwise the
    // engine resolves reaction fire instantly against the destination and the muzzle/HIT appeared on the
    // target tile before the unit had visually arrived ("enemies shoot an empty destination").
    const unitType = unit.unitType;
    const isTruck = unitType === 'support' && unit.definitionId.toLowerCase().includes('truck');
    const isVehicleMove = (unitType === 'vehicle' || unitType === 'artillery' || isTruck) && !isFootCrew(unit.definitionId);
    const moveProfile = movementSoundProfileFor(unitType, unit.definitionId);
    const finalCoord = { q: unit.coordinate.q, r: unit.coordinate.r };
    const actualPath: HexCoordinate[] = [];
    for (const step of path.path) {
      actualPath.push(step);
      if (step.q === finalCoord.q && step.r === finalCoord.r) break;
    }
    const fullPath = [startCoord, ...actualPath];
    const stepDuration = isVehicleMove ? VEHICLE_STEP_DURATION_MS : FOOT_STEP_DURATION_MS;
    const definitionId = unit.definitionId.toLowerCase();
    const usesDirectionalTurns = definitionId.includes('m113') || definitionId === 'supply-truck';
    const preAlignDuration = isVehicleMove ? (usesDirectionalTurns ? 0 : 150) : 0;
    let moving: MovingUnit | null = null;
    if (fullPath.length >= 2) {
      moving = {
        unitId,
        path: fullPath,
        startTime: Date.now(),
        stepDuration,
        preAlignDuration,
        segmentTurnDuration: usesDirectionalTurns ? 90 : 0
      };
      // realistic engine/track/footstep audio matched to how long this glide actually takes
      AudioManager.playMovement(moveProfile, movingUnitDuration(moving));
      movingUnitRef.current = moving;
      flushSync(() => {
        setMovingUnit(moving);
      });
    } else {
      AudioManager.playMovement(moveProfile, stepDuration);
    }
    playReactionVfx(unitId, moving, timelineBefore);
    setSelected(unitId);
    setPlannedPath(null);
    setPlannedDestination(null);
    setInvalidMoveFeedback(null);
    persist();
    if (!validationScenarioRef.current) resolveOutcome();
    return true;
  };
  battleControlContextRef.current = { battle, map, persist, resolveOutcome, buildBattleOutcome, actMove, addAttackEffect, t };
  // Glide a unit's sprite along its path after the engine has already committed the move, and return the
  // animation length in ms so a scripted (auto/AI) loop can await it. Mirrors actMove's visual setup —
  // without it, auto-played and enemy moves snap the sprite straight to the destination (teleport).
  const beginMoveAnimation = (unitId: string, startCoord: HexCoordinate, path: HexCoordinate[]): MovingUnit | null => {
    const unit = findBattleUnit(unitId);
    if (!unit || path.length === 0) return null;
    const finalCoord = { q: unit.coordinate.q, r: unit.coordinate.r };
    const actualPath: HexCoordinate[] = [];
    for (const step of path) {
      actualPath.push(step);
      if (step.q === finalCoord.q && step.r === finalCoord.r) break;
    }
    const fullPath = [startCoord, ...actualPath];
    if (fullPath.length < 2) return null;
    const unitType = unit.unitType;
    const def = unit.definitionId.toLowerCase();
    const isTruck = unitType === 'support' && def.includes('truck');
    const isVehicleMove = (unitType === 'vehicle' || unitType === 'artillery' || isTruck) && !isFootCrew(def);
    const moveProfile = movementSoundProfileFor(unitType, def);
    const usesDirectionalTurns = def.includes('m113') || def === 'supply-truck';
    const moving: MovingUnit = {
      unitId,
      path: fullPath,
      startTime: Date.now(),
      stepDuration: isVehicleMove ? VEHICLE_STEP_DURATION_MS : FOOT_STEP_DURATION_MS,
      preAlignDuration: isVehicleMove ? (usesDirectionalTurns ? 0 : 150) : 0,
      segmentTurnDuration: usesDirectionalTurns ? 90 : 0
    };
    AudioManager.playMovement(moveProfile, movingUnitDuration(moving)); // realistic engine/track/footstep for the whole glide
    movingUnitRef.current = moving;
    flushSync(() => {
      setMovingUnit(moving);
    });
    return moving;
  };
  const actSupply = (supplierId: string) => {
    if (deployModeRef.current || !supplyTargetId) return;
    const proc = new TurnProcessor(battle.state);
    const res = proc.supply({ supplierId, targetId: supplyTargetId });
    if (res.success) {
      AudioManager.play('select');
      addCombatNotice(t('battle:notice.resupplied'));
      persist();
      resolveOutcome();
    } else {
      AudioManager.play('error');
      showToast(res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:resupplyFailed'), 'error');
    }
  };
  const actHeal = (medicId: string) => {
    if (deployModeRef.current || !healTargetId) return;
    const proc = new TurnProcessor(battle.state);
    const res = proc.heal({ medicId, targetId: healTargetId });
    if (res.success) {
      AudioManager.play('select');
      addCombatNotice(t('battle:notice.stabilized'));
      persist();
      resolveOutcome();
    } else {
      AudioManager.play('error');
      showToast(res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:healFailed'), 'error');
    }
  };
  const actAttack = (attackerId: string, defender: UnitInstance) => {
    if (autoTurnBusyRef.current || enemyTurnBusyRef.current || movingUnitRef.current) return; // CPU acting, or a unit is still gliding
    // Exit deploy mode when attacking. Same synchronous exit as the click-to-move path: without
    // battle.deployed a reload would reopen DEPLOYMENT, and the ref must flip before actMove reads it.
    if (deployMode) {
      deployModeRef.current = false;
      setDeployMode(false);
      battle.deployed = true;
      battle.state.activeFaction = 'alliance';
    }
    const attacker = battle.state.sides.alliance.units.get(attackerId);
    if (!attacker) {
      AudioManager.play('error');
      return;
    }
    const weapon = bestWeapon(attacker, defender, battle.state.map, battle.state.weather);
    if (!weapon) {
      // Try to use any weapon
      const anyWeapon = Object.keys(attacker.stats.weaponRanges)[0];
      if (anyWeapon) {
        const hpBefore = defender.currentHealth / (defender.stats.maxHealth || 100);
        const result = processor.attackUnit({ attackerId, defenderId: defender.id, weaponId: anyWeapon });
        if (result.success) {
          const attackOutcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, attackerId, defender.id);
          // Play attack sound only on success
          AudioManager.play(firingSound(attacker, defender, anyWeapon));
          const timing = addAttackEffect(attacker, defender, anyWeapon, attackOutcome);
          // Impact sound only when the shot actually connects (matches the primary attack branch);
          // keying off raw currentHealth played 'hit' even on a clean miss.
          if (attackOutcome.hit) {
            playImpact(defender, attackOutcome.damage, hpBefore, timing.impactAtMs);
          }
          persist();
          resolveOutcome();
        } else {
          AudioManager.play('error');
          const reason = result.errorKey ? t(`errors:${result.errorKey}`) : t('errors:attackFailed');
          showToast(reason, 'error');
          addCombatNotice(reason);
        }
      }
      return;
    }
    const hpBefore = defender.currentHealth / (defender.stats.maxHealth || 100);
    const result = processor.attackUnit({ attackerId, defenderId: defender.id, weaponId: weapon.weapon });
    if (!result.success) {
      AudioManager.play('error');
      const reason = result.errorKey ? t(`errors:${result.errorKey}`) : t('errors:attackFailed');
      showToast(reason, 'error');
      addCombatNotice(reason);
    } else {
      const attackOutcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, attackerId, defender.id);
      // Play attack sound and effects only on success
      AudioManager.play(firingSound(attacker, defender, weapon.weapon));
      const timing = addAttackEffect(attacker, defender, weapon.weapon, attackOutcome);
      // Impact sound only when the shot actually connects (was playing "hit" even on a miss).
      if (attackOutcome.hit) {
        playImpact(defender, attackOutcome.damage, hpBefore, timing.impactAtMs);
      }
    }
    persist();
    resolveOutcome();
  };
  const actSuppress = (attackerId: string, defender: UnitInstance) => {
    if (autoTurnBusyRef.current || enemyTurnBusyRef.current || movingUnitRef.current) return;
    const attacker = battle.state.sides.alliance.units.get(attackerId);
    if (!attacker) return;
    const weapon = bestWeapon(attacker, defender, battle.state.map, battle.state.weather);
    if (!weapon) {
      AudioManager.play('error');
      addCombatNotice(t('battle:fireControl.attackUnavailable'));
      return;
    }

    const hpBefore = defender.currentHealth / (defender.stats.maxHealth || 100);
    const result = processor.suppressUnit({ attackerId, defenderId: defender.id, weaponId: weapon.weapon });
    if (!result.success) {
      AudioManager.play('error');
      const reason = result.errorKey ? t(`errors:${result.errorKey}`) : t('errors:suppressionFailed');
      showToast(reason, 'error');
      addCombatNotice(reason);
      return;
    }

    const attackOutcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, attackerId, defender.id);
    AudioManager.play(firingSound(attacker, defender, weapon.weapon));
    const timing = addAttackEffect(attacker, defender, weapon.weapon, attackOutcome);
    if (attackOutcome.hit) playImpact(defender, attackOutcome.damage, hpBefore, timing.impactAtMs);
    persist();
    resolveOutcome();
  };
  const handleHexClick = (coord: HexCoordinate) => {
    if (autoTurnBusyRef.current || enemyTurnBusyRef.current) return; // ignore clicks while the CPU plays
    // Clear targeted enemy when clicking elsewhere. Only enemies on a CURRENTLY VISIBLE tile count as a
    // target — you can't target (or attack) a unit hidden in fog, which would otherwise put a reticle and
    // a "HIT" number on an apparently empty tile.
    const foe = Array.from(battle.state.sides.otherSide.units.values()).find(
      (u) => u.coordinate.q === coord.q && u.coordinate.r === coord.r && u.stance !== 'destroyed'
        && visibleTiles.has(coord.r * battle.state.map.width + coord.q)
    );
    if (!foe) {
      clearTargeting(true);
    }
    if (deployMode) {
      const ally = Array.from(battle.state.sides.alliance.units.values()).find(
        (u) => u.coordinate.q === coord.q && u.coordinate.r === coord.r && u.stance !== 'destroyed'
      );
      if (ally) {
        handleSelect(ally);
        return;
      }
      // Check if clicking on enemy - allow attack even in deploy mode
      if (foe && selected) {
        setTargetedEnemy(foe);
        return;
      }
      if (selected) {
        const isStartTile = battle.startTiles.some((s) => s.q === coord.q && s.r === coord.r);
        if (isStartTile) {
          const unit = battle.state.sides.alliance.units.get(selected);
          if (!unit || unit.embarkedOn) return; // can't reposition a loaded passenger
          // deployment reposition inside start zone — refuse any tile already held by a live unit on
          // either side (a fog-hidden enemy could otherwise be stacked onto)
          const occupied = Object.values(battle.state.sides).some((side) =>
            Array.from(side.units.values()).some(
              (u) => u.id !== selected && u.stance !== 'destroyed' && !u.embarkedOn
                && u.coordinate.q === coord.q && u.coordinate.r === coord.r
            )
          );
          if (occupied) return;
          unit.coordinate = { ...coord };
          updateAllFactionsVision(battle.state);
          persist();
        } else {
          // clicking outside start zone exits deployment and performs a move like classic behavior.
          // deployModeRef must flip synchronously or actMove (which reads the ref) bails on the stale value.
          deployModeRef.current = false;
          setDeployMode(false);
          battle.deployed = true;
          battle.state.activeFaction = 'alliance';
          actMove(selected, coord);
        }
      }
      return;
    }
    // If nothing selected, auto-select the first ready ally to allow quick move clicks. The old
    // force-flip of activeFaction here could hijack a stuck enemy turn; runAiTurn's finally-backstop
    // now guarantees the handoff instead.
    if (!selected) {
      const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
      if (first) setSelected(first.id);
    }
    const ally = Array.from(battle.state.sides.alliance.units.values()).find(
      (u) => u.coordinate.q === coord.q && u.coordinate.r === coord.r && u.stance !== 'destroyed'
    );
    if (ally) {
      handleSelect(ally);
      return;
    }
    if (foe) {
      setPlannedPath(null);
      setPlannedDestination(null);
      setInvalidMoveFeedback(null);
      if (!selected) {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed' && !u.embarkedOn);
        if (first) {
          setSelected(first.id);
          setTargetedEnemy(foe);
        }
        return;
      }
      // Double-click to attack (extended to 1.5 seconds for easier use)
      const now = Date.now();
      if (pendingAttack && pendingAttack.id === foe.id && now - pendingAttack.time < 1500) {
        actAttack(selected, foe);
        setPendingAttack(null);
        setTargetedEnemy(null);
      } else {
        setPendingAttack({ id: foe.id, time: now });
        setTargetedEnemy(foe);
      }
      return;
    }
    if (selected && !ally && !foe) {
      // First click: preview path + destination ring, second click: commit
      const key = coordinateKey(coord);
      if (plannedDestination && coordinateKey(plannedDestination) === key) {
        actMove(selected, coord);
        return;
      }
      const path = planPathForUnit(battle.state, selected, coord);
      if (!path.success || path.path.length === 0) {
        rejectMove(coord, describeMoveRejection(selected, coord, moveFailureText(path.reason)));
        return;
      }
      const unit = battle.state.sides.alliance.units.get(selected);
      const withOrigin = unit ? [unit.coordinate, ...path.path] : path.path;
      setPlannedPath(withOrigin);
      setPlannedDestination(coord);
      setInvalidMoveFeedback(null);
    }
  };
  const runAiTurn = async () => {
    // Also bail if Auto Turn is mid-flight or a unit is still animating — otherwise clicking End Turn
    // during Auto Turn starts a second concurrent enemy turn over the same state (double round/AP).
    if (deployMode || enemyTurnBusyRef.current || autoTurnBusyRef.current || movingUnitRef.current) return;
    enemyTurnBusyRef.current = true;
    // drop any staged SFX still pending from a prior enemy turn
    aiSfxTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
    aiSfxTimeoutsRef.current = [];
    const aiProcessor = new TurnProcessor(battle.state);
    aiProcessor.endTurn(); // player ends, AI starts
    showPhaseNotice(t('battle:notice.enemyTurnTitle'), t('battle:notice.enemyTurnDetail'), 'enemy');
    let decisionsMade = 0;
    let attacksMade = 0;
    let phaseUpdated = false;
    // AI skill tracks the SECTOR's difficulty, not the strategic turn — otherwise a player who never ends
    // strategic turns farms diff-5 sectors at 'normal', and early-ended turns inflict 'brutal' on diff-1.
    const sectorDifficulty = campaign.territories.find((t) => t.id === battle.territoryId)?.difficulty ?? 2;
    const enemyTier = getEnemyDifficultyTier(campaign.difficulty, sectorDifficulty);
    const activeEnemies = Array.from(battle.state.sides.otherSide.units.values())
      .filter((unit) => unit.stance !== 'destroyed').length;
    // The old global cap of two attacks let a large enemy army leave most of its AP unused. Scale the
    // animation-safe attack budget with surviving force size so both sides get a comparable turn.
    const maxEnemyAttacks = getEnemyActionBudget(campaign.difficulty, activeEnemies);
    const maxEnemyDecisions = getEnemyDecisionBudget(campaign.difficulty, activeEnemies);
    // Units whose chosen action the engine rejected this turn. We skip only those when re-deciding so a
    // single bad action doesn't forfeit the rest of the AI's units (decideNextAIAction returns one
    // globally-best action, so without this the turn would end on the first rejection).
    const failedUnitIds = new Set<string>();
    try {
      while (battle.state.activeFaction === 'otherSide' && decisionsMade < maxEnemyDecisions) {
        decisionsMade += 1;
        // If the player's already been wiped out (or the enemy is), stop the enemy turn here so the
        // outcome card shows immediately rather than after the rest of the queued enemy actions.
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;
        const objectiveTargets = battle.scenario.objectives
          .map((o) => o.target)
          .filter((t): t is HexCoordinate => Boolean(t));
        const holdTargets = battle.scenario.objectives.filter((o) => o.kind === 'hold').map((o) => o.target).filter(Boolean) as HexCoordinate[];
        const reachTargets = battle.scenario.objectives.filter((o) => o.kind === 'reach').map((o) => o.target).filter(Boolean) as HexCoordinate[];
        const avoid = new Set<string>();
        battle.state.map.tiles.forEach((tile, idx) => {
          if (tile.destructible && (tile.hp ?? 0) > 0) {
            const q = idx % battle.state.map.width;
            const r = Math.floor(idx / battle.state.map.width);
            avoid.add(`${q},${r}`);
          }
        });
        // Fog-fair: the enemy only fires at player units its own side can see (movement still advances on
        // all). Symmetric with the player's Auto Turn, and required now that the engine rejects attacks on
        // unseen targets — otherwise the AI would keep proposing rejected shots at fogged players.
        const foeSeen = battle.state.vision.otherSide.visibleTiles;
        const foeVisibleIds = new Set<string>();
        for (const u of battle.state.sides.alliance.units.values()) {
          if (u.stance === 'destroyed' || u.embarkedOn) continue;
          if (foeSeen.has(u.coordinate.r * battle.state.map.width + u.coordinate.q)) foeVisibleIds.add(u.id);
        }
        const action = decideNextAIAction(battle.state, 'otherSide', {
          objectiveTargets,
          holdTargets,
          reachTargets,
          defendBias: true,
          avoidTiles: avoid,
          allowDemolition: true,
          difficulty: enemyTier,
          excludeUnitIds: failedUnitIds,
          visibleEnemyIds: foeVisibleIds
        });
        if (action.type === 'endTurn') {
          aiProcessor.endTurn();
          break;
        } else if (action.type === 'move') {
          // A rejected action would otherwise be re-decided identically forever (deterministic AI);
          // skip just this unit so the remaining units still act this turn.
          const mover = findBattleUnit(action.unitId);
          const startCoord = mover ? { q: mover.coordinate.q, r: mover.coordinate.r } : null;
          const tlBefore = battle.state.timeline.length;
          const moveRes = aiProcessor.moveUnit(action);
          if (!moveRes.success) { failedUnitIds.add(action.unitId); continue; }
          // Animate an enemy move whose DESTINATION the player can see (mirrors the sprite fog cull) — OR
          // one that drew the player's overwatch fire, so the reaction is never invisible and a reaction
          // kill doesn't read as "the enemy died for no reason". A silent fog move with no reaction stays
          // silent (no "hear, not see"). mover.coordinate is now the post-move destination.
          const destVisible = !!mover && battle.state.vision.alliance.visibleTiles.has(mover.coordinate.r * battle.state.map.width + mover.coordinate.q);
          const drewReaction = battle.state.timeline.slice(tlBefore).some((e) => e.kind === 'unit:attacked' && e.defenderId === action.unitId);
          let mMoving: MovingUnit | null = null;
          if (mover && startCoord && (destVisible || drewReaction)) {
            mMoving = beginMoveAnimation(action.unitId, startCoord, action.path);
          }
          playReactionVfx(action.unitId, mMoving, tlBefore);
          if (mMoving) { const dur = movingUnitDuration(mMoving); if (dur > 0) await sleep(dur + 90); }
        } else if (action.type === 'attack') {
          const attacker = findBattleUnit(action.attackerId);
          const defender = findBattleUnit(action.defenderId);
          const defHpBefore = defender ? defender.currentHealth / (defender.stats.maxHealth || 100) : 1;
          const result = aiProcessor.attackUnit(action);
          if (!result.success) { failedUnitIds.add(action.attackerId); continue; }
          if (attacker && defender) {
            const outcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, action.attackerId, action.defenderId);
            const timing = addAttackEffect(attacker, defender, action.weaponId, outcome, 0);
            const enemySfx = firingSound(attacker, defender, action.weaponId);
            const enemyKilled = defender.stance === 'destroyed';
            const enemyHit = outcome.hit;
            AudioManager.play(enemySfx);
            if (enemyKilled || enemyHit) playImpact(defender, outcome.damage, defHpBefore, timing.impactAtMs);
            attacksMade += 1;
            if (!phaseUpdated) {
              phaseUpdated = true;
              showPhaseNotice(t('battle:notice.enemyPhaseTitle'), t('battle:notice.enemyPhaseDetail', { unit: unitDisplayName(action.attackerId, battle.state) }), 'enemy');
            }
            await sleep(enemyKilled ? 140 : enemyHit ? 70 : 0); // let the kill/hit land before moving on
            await sleep(700);
            if (attacksMade >= maxEnemyAttacks) {
              aiProcessor.endTurn();
              break;
            }
          }
        } else if (action.type === 'suppress') {
          const attacker = findBattleUnit(action.attackerId);
          const defender = findBattleUnit(action.defenderId);
          const defHpBefore = defender ? defender.currentHealth / (defender.stats.maxHealth || 100) : 1;
          const result = aiProcessor.suppressUnit(action);
          if (!result.success) { failedUnitIds.add(action.attackerId); continue; }
          if (attacker && defender) {
            const outcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, action.attackerId, action.defenderId);
            const timing = addAttackEffect(attacker, defender, action.weaponId, outcome, 0);
            const visible = battle.state.vision.alliance.visibleTiles.has(
              defender.coordinate.r * battle.state.map.width + defender.coordinate.q
            );
            if (visible) {
              AudioManager.play(firingSound(attacker, defender, action.weaponId));
              if (outcome.hit) playImpact(defender, outcome.damage, defHpBefore, timing.impactAtMs);
              await sleep(700);
            }
            attacksMade += 1;
            if (attacksMade >= maxEnemyAttacks) {
              aiProcessor.endTurn();
              break;
            }
          }
        } else if (action.type === 'attackTile') {
          // Snapshot visibility BEFORE the demolition — destroying the tile recomputes vision. Only the
          // blast on a tile the player can see should boom (and the destroyed structure is the visual).
          const tileVisible = battle.state.vision.alliance.visibleTiles.has(action.target.r * battle.state.map.width + action.target.q);
          const tileRes = aiProcessor.attackTile({ attackerId: action.unitId, target: action.target, weaponId: action.weaponId });
          if (tileRes && tileRes.success === false) { failedUnitIds.add(action.unitId); continue; }
          if (tileVisible) { AudioManager.play('explosion'); await sleep(650); }
        } else if (action.type === 'supply') {
          const supRes = aiProcessor.supply({ supplierId: action.supplierId, targetId: action.targetId });
          if (!supRes.success) { failedUnitIds.add(action.supplierId); continue; }
          // Enemy resupply has no on-screen effect, so the 'select' blip was audio with nothing to see.
          await sleep(250);
        } else if (action.type === 'heal') {
          const healRes = aiProcessor.heal({ medicId: action.medicId, targetId: action.targetId });
          if (!healRes.success) { failedUnitIds.add(action.medicId); continue; }
          await sleep(250);
        } else if (action.type === 'digIn') {
          const digInRes = aiProcessor.digIn(action.unitId);
          if (!digInRes.success) { failedUnitIds.add(action.unitId); continue; }
          await sleep(180);
        } else if (action.type === 'rally') {
          const rallyRes = aiProcessor.rally(action.unitId);
          if (!rallyRes.success) { failedUnitIds.add(action.unitId); continue; }
          await sleep(180);
        }
      }
    } finally {
      // Backstop: never leave control stuck on the enemy turn — the decision cap tripped, or the
      // engine threw mid-loop. Runs in finally so a throw can't skip it while the busy flag clears.
      if (battle.state.activeFaction === 'otherSide') {
        aiProcessor.endTurn();
      }
      presentTacticalEvents(processTacticalEvents(campaign, bundle));
      persist();
      if (evaluateBattleOutcome(battle) === 'ongoing') {
        AudioManager.play('turnStart'); // control handed back to the player
      }
      resolveOutcome();
      enemyTurnBusyRef.current = false;
    }
  };
  // "Auto Turn": let the computer play the player's turn — commit deployment, then drive every
  // alliance unit with the same planner the enemy uses, and finally hand off to the enemy turn.
  const runAutoPlayerTurn = async () => {
    if (autoTurnBusyRef.current || enemyTurnBusyRef.current) return;
    if (deployModeRef.current) {
      deployModeRef.current = false;
      setDeployMode(false);
      battle.deployed = true;
      battle.state.activeFaction = 'alliance';
      updateAllFactionsVision(battle.state);
    }
    if (battle.state.activeFaction !== 'alliance') return;
    autoTurnBusyRef.current = true;
    autoTurnAbortRef.current = false;
    setAutoTurnPhase('player');
    aiSfxTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
    aiSfxTimeoutsRef.current = [];
    const proc = new TurnProcessor(battle.state);
    // Only evac/reach and required interaction tiles are passed as goals. We deliberately do NOT pass hold tiles or enemy
    // coordinates: passing hold tiles parks the squad defensively (verified: hold sectors then time out
    // instead of winning by elimination), and enemy coordinates trip the planner's "contest" lane into
    // out-of-range attacks. With no goal the planner advances on the nearest enemy — seek-and-destroy.
    const requiredObjectiveRosterIds = battle.scenario.objectives
      .filter((objective) => !objective.optional && (objective.kind === 'reach' || objective.kind === 'interact'))
      .flatMap((objective) => objective.unitIds ?? []);
    const objectiveUnitIds = requiredObjectiveRosterIds.length > 0
      ? new Set(requiredObjectiveRosterIds
          .map((rosterId) => battle.deployment[rosterId])
          .filter((unitId): unitId is string => Boolean(unitId)))
      : undefined;
    const failedUnitIds = new Set<string>();
    // Backstop against the planner walking a unit in circles: remember every tile each unit has stood on
    // this turn. If it's told to step back onto one, bench it for the rest of the turn instead of thrashing.
    const visitedTiles = new Map<string, Set<string>>();
    const tileKey = (c: HexCoordinate) => `${c.q},${c.r}`;
    const autoDifficultyRules = getCampaignDifficultyRules(campaign.difficulty);
    let safety = 0;
    while (battle.state.activeFaction === 'alliance' && safety < 80) {
      safety += 1;
      if (autoTurnAbortRef.current) break; // player clicked Stop — hand the rest of the turn back to them
      const pendingInteraction = battle.scenario.objectives
        .filter((objective) => objective.kind === 'interact' && !objective.optional && !isObjectiveMet(objective, battle))
        .flatMap((objective) => Array.from(battle.state.sides.alliance.units.values()).map((unit) => ({ objective, unit })))
        .find(({ objective, unit }) => checkObjectiveAction(battle, unit.id, objective.id).success);
      if (pendingInteraction) {
        setSelected(pendingInteraction.unit.id);
        executeObjectiveAction(pendingInteraction.unit.id, pendingInteraction.objective.id);
        await sleep(300);
        if (evaluateBattleOutcome(battle) !== 'ongoing') break;
        continue;
      }
      // Fog of war: the squad may only fire at enemies on tiles we can currently see. Recomputed each
      // step because advancing reveals more of the map. (Movement still seeks all enemies, to scout.)
      const seenTiles = battle.state.vision.alliance.visibleTiles;
      const visibleEnemyIds = new Set<string>();
      for (const e of battle.state.sides.otherSide.units.values()) {
        if (e.stance === 'destroyed' || e.embarkedOn) continue;
        if (seenTiles.has(e.coordinate.r * battle.state.map.width + e.coordinate.q)) visibleEnemyIds.add(e.id);
      }
      const reachTargets = battle.scenario.objectives
        .filter((objective) => (
          !objective.optional
          && (objective.kind === 'reach' || objective.kind === 'interact')
          && !isObjectiveMet(objective, battle)
        ))
        .map((objective) => objective.target)
        .filter(Boolean) as HexCoordinate[];
      const action = decideNextAIAction(battle.state, 'alliance', {
        objectiveTargets: reachTargets,
        objectiveUnitIds,
        reachTargets,
        defendBias: false,
        aggression: autoDifficultyRules.playerAutoAggression,
        difficulty: autoDifficultyRules.playerAutoDifficulty,
        allowDemolition: false,
        excludeUnitIds: failedUnitIds,
        visibleEnemyIds
      });
      if (action.type === 'endTurn') break;
      if (action.type === 'move') {
        const mover = findBattleUnit(action.unitId);
        const startCoord = mover ? { q: mover.coordinate.q, r: mover.coordinate.r } : null;
        const dest = action.path[action.path.length - 1];
        const seen = visitedTiles.get(action.unitId) ?? new Set<string>();
        if (dest && seen.has(tileKey(dest))) { failedUnitIds.add(action.unitId); continue; } // would revisit → cycle
        if (startCoord) seen.add(tileKey(startCoord));
        if (dest) seen.add(tileKey(dest));
        visitedTiles.set(action.unitId, seen);
        const tlBefore = battle.state.timeline.length;
        const moveRes = proc.moveUnit(action);
        if (!moveRes.success) { failedUnitIds.add(action.unitId); continue; }
        setSelected(action.unitId);
        let mMoving: MovingUnit | null = null;
        if (startCoord) {
          mMoving = beginMoveAnimation(action.unitId, startCoord, action.path);
        }
        playReactionVfx(action.unitId, mMoving, tlBefore); // enemy overwatch fire on our auto-move
        if (mMoving) { const dur = movingUnitDuration(mMoving); if (dur > 0) await sleep(dur + 90); }
      } else if (action.type === 'attack') {
        const attacker = findBattleUnit(action.attackerId);
        const defender = findBattleUnit(action.defenderId);
        const defHpBefore = defender ? defender.currentHealth / (defender.stats.maxHealth || 100) : 1;
        const result = proc.attackUnit(action);
        if (!result.success) { failedUnitIds.add(action.attackerId); continue; }
        if (attacker && defender) {
          setSelected(action.attackerId);
          const outcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, action.attackerId, action.defenderId);
          const timing = addAttackEffect(attacker, defender, action.weaponId, outcome, 0);
          const sfx = firingSound(attacker, defender, action.weaponId);
          const killed = defender.stance === 'destroyed';
          const hit = outcome.hit;
          AudioManager.play(sfx);
          if (killed || hit) playImpact(defender, outcome.damage, defHpBefore, timing.impactAtMs);
          await sleep(killed ? 140 : hit ? 70 : 0); // let the kill/hit land before moving on
          await sleep(700);
        }
      } else if (action.type === 'suppress') {
        const attacker = findBattleUnit(action.attackerId);
        const defender = findBattleUnit(action.defenderId);
        const defHpBefore = defender ? defender.currentHealth / (defender.stats.maxHealth || 100) : 1;
        const result = proc.suppressUnit(action);
        if (!result.success) { failedUnitIds.add(action.attackerId); continue; }
        if (attacker && defender) {
          setSelected(action.attackerId);
          const outcome = visualOutcomeForAttack(result.events as BattleEvent[] | undefined, action.attackerId, action.defenderId);
          const timing = addAttackEffect(attacker, defender, action.weaponId, outcome, 0);
          AudioManager.play(firingSound(attacker, defender, action.weaponId));
          if (outcome.hit) playImpact(defender, outcome.damage, defHpBefore, timing.impactAtMs);
          await sleep(700);
        }
      } else if (action.type === 'attackTile') {
        const tileRes = proc.attackTile({ attackerId: action.unitId, target: action.target, weaponId: action.weaponId });
        if (tileRes && tileRes.success === false) { failedUnitIds.add(action.unitId); continue; }
        AudioManager.play('explosion');
        await sleep(650);
      } else if (action.type === 'supply') {
        const supRes = proc.supply({ supplierId: action.supplierId, targetId: action.targetId });
        if (!supRes.success) { failedUnitIds.add(action.supplierId); continue; }
        AudioManager.play('select');
        await sleep(250);
      } else if (action.type === 'heal') {
        const healRes = proc.heal({ medicId: action.medicId, targetId: action.targetId });
        if (!healRes.success) { failedUnitIds.add(action.medicId); continue; }
        AudioManager.play('select');
        await sleep(250);
      } else if (action.type === 'digIn') {
        const digInRes = proc.digIn(action.unitId);
        if (!digInRes.success) { failedUnitIds.add(action.unitId); continue; }
        AudioManager.play('objective');
        await sleep(180);
      } else if (action.type === 'rally') {
        const rallyRes = proc.rally(action.unitId);
        if (!rallyRes.success) { failedUnitIds.add(action.unitId); continue; }
        AudioManager.play('turnStart');
        await sleep(180);
      }
    }
    clearTargeting(true);
    setSelected(null);
    updateAllFactionsVision(battle.state);
    persist();
    resolveOutcome();
    // If the player stopped Auto Turn, hand control back (don't trigger the enemy turn) so they can
    // finish the turn manually with the remaining units.
    if (autoTurnAbortRef.current) {
      autoTurnBusyRef.current = false;
      setAutoTurnPhase(null);
      autoTurnAbortRef.current = false;
      return;
    }
    // Hand off to the enemy turn. Keep the busy lock HELD across the handoff sleep — clearing it early
    // (the old bug) opened a window where End Turn could launch a second concurrent enemy turn (double
    // round/AP) and where stray player orders could fire. runAiTurn bails while the lock is true, so we
    // release it on the very line before calling it.
    if (evaluateBattleOutcome(battle) === 'ongoing') {
      setAutoTurnPhase('enemy');
      await sleep(400);
      if (evaluateBattleOutcome(battle) === 'ongoing') {
        autoTurnBusyRef.current = false;
        await runAiTurn();
      } else {
        autoTurnBusyRef.current = false;
      }
    } else {
      autoTurnBusyRef.current = false;
    }
    setAutoTurnPhase(null);
  };
  return (
    <div className="battle-screen">
      <div className="battle-map-layer">
        <React.Suspense
          fallback={(
            <div className="battlefield-loader" role="status" aria-live="polite">
              <div className="battlefield-loader-radar" aria-hidden="true" />
              <strong>{t('battle:loading.title')}</strong>
              <span>{t('battle:loading.detail')}</span>
            </div>
          )}
        >
          <BattlefieldStage
            battleState={battle.state}
            onSelectUnit={(id) => {
              const unit = battle.state.sides.alliance.units.get(id);
              if (unit) handleSelect(unit);
            }}
            onSelectTile={(coord) => handleHexClick(coord)}
            selectedUnitId={selected ?? undefined}
            plannedPath={plannedPath ?? undefined}
            plannedDestination={plannedDestination ?? undefined}
            threatenedTiles={threatenedPathTiles}
            invalidMoveFeedback={invalidMoveFeedback}
            targetUnitId={previewEnemy?.id}
            restoreCameraSignal={cameraRestoreSignal}
            deployMode={deployMode}
            targetHitChance={previewEnemy && targetWeaponPreview ? targetWeaponPreview.hit / 100 : undefined}
            targetDamagePreview={previewDamage}
            targetLethal={previewLethal}
            onUnitHover={setHoveredEnemyId}
            viewerFaction="alliance"
            width={viewport.width}
            height={viewport.height}
            cameraMode="follow"
            rangeOverlayCoords={showRanges ? globalRangeTiles : undefined}
            blockedRangeOverlayCoords={showRanges ? blockedRangeTiles : undefined}
            objectiveCoords={battle.scenario.objectives.map((objective) => objective.target).filter((coord): coord is HexCoordinate => Boolean(coord))}
            startZoneCoords={deployMode ? battle.startTiles : undefined}
            attackEffects={attackEffects}
            arrivalEffects={arrivalEffects}
            movingUnit={movingUnit}
          />
        </React.Suspense>
      </div>
      <div className="battle-ui-layer">
        {autoTurnPhase ? (
          <div className={`auto-turn-banner ${autoTurnPhase}`}>
            <span className="auto-turn-spinner" />
            <strong>{t('battle:autoTurn.label')}</strong>
            <span>{autoTurnPhase === 'player' ? t('battle:autoTurn.playerPhase') : t('battle:autoTurn.enemyPhase')}</span>
            {autoTurnPhase === 'player' ? (
              <button className="auto-turn-stop" onClick={() => { autoTurnAbortRef.current = true; }}>{t('battle:autoTurn.stopAndTakeOver')}</button>
            ) : null}
          </div>
        ) : null}
        {phaseNotice ? (
          <div className={`battle-phase-notice ${phaseNotice.tone}`} style={{ animationDuration: `${phaseNotice.duration}ms` }}>
            <strong>{phaseNotice.title}</strong>
            <span>{phaseNotice.detail}</span>
          </div>
        ) : null}
        {deployMode ? (
          <div className="deploy-banner">
            <strong>{t('battle:deploy.title')}</strong>
            <span>{t('battle:deploy.hint')}</span>
            <span className="deploy-count">
              {t('battle:deploy.unitsReady', { count: Array.from(battle.state.sides.alliance.units.values()).filter((u) => u.stance !== 'destroyed').length })}
            </span>
          </div>
        ) : null}
        {riskyMove ? (
          <div className="risky-move-backdrop" role="alertdialog" aria-label={t('battle:risky.ariaLabel')}>
            <div className="risky-move-dialog">
              <strong>{t('battle:risky.title')}</strong>
              <p>
                {riskyMove.lethal
                  ? t('battle:risky.routeLethal', { unit: riskyMove.unitName })
                  : t('battle:risky.routeWounded', { unit: riskyMove.unitName })}
              </p>
              <div className="risky-move-actions">
                <button
                  className="risky-move-confirm"
                  onClick={() => {
                    const move = riskyMove;
                    setRiskyMove(null);
                    actMove(move.unitId, move.target, true);
                  }}
                >
                  {t('battle:risky.moveAnyway')}
                </button>
                <button className="risky-move-cancel" onClick={() => setRiskyMove(null)}>
                  {t('common:action.cancel')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {retreatConfirmOpen ? (
          <div className="risky-move-backdrop" role="alertdialog" aria-label={t('battle:retreat.ariaLabel')}>
            <div className="risky-move-dialog retreat-confirm-dialog">
              <strong>{t('battle:retreat.title')}</strong>
              <p>{t('battle:retreat.losses', { count: retreatForecast.lostUnitIds.length })}</p>
              <p>{t('battle:retreat.heroRecovery')}</p>
              <div className="risky-move-actions">
                <button
                  className="risky-move-confirm"
                  onClick={() => {
                    setRetreatConfirmOpen(false);
                    retreatFromBattle(campaign, bundle);
                    persist();
                    onRetreat();
                  }}
                >
                  {t('battle:retreat.confirm')}
                </button>
                <button className="risky-move-cancel" onClick={() => setRetreatConfirmOpen(false)}>
                  {t('common:action.cancel')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showRanges && selectedUnit ? (
          <div className="battle-mode-badge">
            <span>{t('battle:rangeOverlay.label')}</span>
            <strong>{localizedUnitName(selectedUnit.definitionId, selectedDefinition?.name ?? selectedUnit.definitionId)}</strong>
            <small className="range-overlay-key">
              <i className="available" /><span>{t('battle:rangeOverlay.available')}</span>
              <i className="blocked" /><span>{t('battle:rangeOverlay.blockedByTerrain')}</span>
            </small>
          </div>
        ) : null}
        <div className="battle-top-bar">
          <div className="mission-info">
            <h2>{localizedScenarioName(battle.scenario.id, battle.scenario.name)}</h2>
            <p className="muted">{localizedScenarioBrief(battle.scenario.id, battle.scenario.brief)}</p>
            {!deployMode ? (
              <ObjectiveHud
                battle={battle}
                selectedUnitId={selected ?? undefined}
                onObjectiveAction={(objectiveId) => {
                  if (selected) executeObjectiveAction(selected, objectiveId);
                }}
              />
            ) : null}
          </div>
        </div>
        <div className="battle-bottom-bar">
          <div className={`unit-card selected-unit-card${selected ? '' : ' empty'}`}>
            <h3>{t('battle:panel.selectedUnit')}</h3>
            {selected ? (
              (() => {
                const unit = battle.state.sides.alliance.units.get(selected);
                if (!unit) return <p className="muted">{t('battle:panel.none')}</p>;
                const carrier = unit.stats.transportCapacity && unit.stats.transportCapacity > 0;
                const embarked = unit.embarkedOn;
                const tile = battle.state.map.tiles[unit.coordinate.r * battle.state.map.width + unit.coordinate.q];
                const def = bundle.units.find(d => d.id === unit.definitionId);
                const healthPct = Math.max(0, Math.min(100, Math.round((unit.currentHealth / unit.stats.maxHealth) * 100)));
                const apPct = Math.max(0, Math.min(100, Math.round((unit.actionPoints / unit.maxActionPoints) * 100)));
                const moralePct = Math.max(0, Math.min(100, unit.currentMorale));
                const displayName = localizedUnitName(unit.definitionId, def?.name ?? unit.definitionId);
                const nextLevelExperience = nextExperienceLevelThreshold(unit.experience);
                return (
                  <div className="unit-details">
                    <div className="unit-monitor">
                      <div className={`unit-scope unit-scope-${unit.unitType}`}>
                        <img
                          className="unit-scope-portrait"
                          src={unitPortrait(unit.unitType, unit.definitionId, true)}
                          alt={displayName}
                          draggable={false}
                        />
                      </div>
                      <div className="unit-readout">
                        <span>{t(`common:unitType.${unit.unitType}`)}</span>
                        <strong>{displayName}</strong>
                      </div>
                    </div>
                    <div className="unit-stats">
                      <strong>{displayName}</strong>
                      <p className="unit-stat-line">
                        HP <span className={unit.currentHealth < unit.stats.maxHealth * 0.5 ? 'warn' : ''}>{compactNumber(unit.currentHealth)}</span>/{compactNumber(unit.stats.maxHealth)}
                        <i style={{ '--unit-stat-percent': `${healthPct}%` } as React.CSSProperties} />
                      </p>
                      <p className="unit-stat-line">
                        AP {displayActionPoints(unit.actionPoints)}/{displayActionPoints(unit.maxActionPoints)}
                        <i style={{ '--unit-stat-percent': `${apPct}%` } as React.CSSProperties} />
                      </p>
                      <p>{t('battle:panel.ammo')} {unit.stats.ammoCapacity ? `${unit.currentAmmo}/${unit.stats.ammoCapacity}` : '∞'}</p>
                    </div>
                    <div className="unit-status">
                      <p className="unit-stat-line">
                        {t('battle:panel.morale')} {unit.currentMorale}
                        <i style={{ '--unit-stat-percent': `${moralePct}%` } as React.CSSProperties} />
                      </p>
                      {(() => {
                        const coverVal = (tile?.cover ?? 0) + (unit.entrench ?? 0);
                        const coverWord = coverVal >= 3 ? t('battle:panel.coverHeavy') : coverVal === 2 ? t('battle:panel.coverSolid') : coverVal === 1 ? t('battle:panel.coverLight') : t('battle:panel.coverNone');
                        return (
                          <>
                            <p>{t('battle:panel.cover')} <b>{coverWord}</b>{coverVal > 0 ? ` · ${t(`common:terrain.${tile?.terrain ?? 'plain'}`)}` : ''}</p>
                            <div className="unit-tags">
                              {coverVal > 0 && <span className="badge badge-cover">{t('battle:panel.inCover')}</span>}
                              {tile?.blocksVision && <span className="badge badge-conceal">{t('battle:panel.concealed')}</span>}
                              {unit.statusEffects.has('overwatch') && <span className="badge">{t('battle:panel.overwatch')}</span>}
                              {(unit.entrench ?? 0) > 0 && <span className="badge">{t('battle:panel.dugIn')}</span>}
                            </div>
                          </>
                        );
                      })()}
                      {carrier && <p>{t('battle:panel.cargo')} {unit.carrying?.length ?? 0}/{unit.stats.transportCapacity}</p>}
                    </div>
                    <div className="unit-armory">
                      <p className="unit-armory-top">
                        <span>{t('battle:panel.armor')} <b>{unit.stats.armor}</b></span>
                        <span>{t('battle:panel.level')} <b>{unit.level}</b></span>
                        <span>
                          {t('battle:panel.experience')} <b>{unit.experience}</b>
                          {nextLevelExperience != null
                            ? `/${nextLevelExperience}`
                            : ` · ${t('battle:panel.maxLevel')}`}
                        </span>
                      </p>
                      {Object.keys(unit.stats.weaponRanges).map((wid) => {
                        const roleLabel: Record<string, string> = {
                          ap: 'AP', he: 'HE', autocannon: 'AC', smallarms: 'SA',
                          aa: 'AA', arrow: 'BOW', fire: 'FIRE', melee: 'MELEE', magic: 'PSI'
                        };
                        const role = weaponDamageRole(wid);
                        const atk = Math.round((unit.stats.weaponPower[wid] ?? 0) * calculateStrengthModifier(unit));
                        const acc = Math.round((unit.stats.weaponAccuracy[wid] ?? 0.6) * 100);
                        return (
                          <p key={wid} className="unit-weapon-line">
                            <span className={`wep-role wep-${role}`}>{roleLabel[role] ?? role}</span>
                            <span className="wep-name">{wid}</span>
                            <span>ATK {atk}</span>
                            <span>RNG {unit.stats.weaponRanges[wid]}</span>
                            <span>ACC {acc}%</span>
                          </p>
                        );
                      })}
                    </div>
                    <div className="unit-actions">
                      {!deployMode && !embarked && (
                        <PostureActions
                          battleState={battle.state}
                          unit={unit}
                          onDigIn={() => {
                            const proc = new TurnProcessor(battle.state);
                            const res = proc.digIn(unit.id);
                            if (!res.success) {
                              AudioManager.play('error');
                              showToast(res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:cannotDigIn'), 'error');
                              return;
                            }
                            AudioManager.play('objective');
                            persist();
                          }}
                          onRally={() => {
                            const proc = new TurnProcessor(battle.state);
                            const res = proc.rally(unit.id);
                            if (!res.success) {
                              AudioManager.play('error');
                              showToast(res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:cannotRally'), 'error');
                              return;
                            }
                            AudioManager.play('turnStart');
                            persist();
                          }}
                        />
                      )}
                      {carrier && (
                        <button
                          className="sm-btn"
                          onClick={() => {
                            const adj = Array.from(battle.state.sides.alliance.units.values()).find(
                              (u) =>
                                u.id !== unit.id &&
                                !u.embarkedOn &&
                                u.stance !== 'destroyed' &&
                                axialDistance(u.coordinate, unit.coordinate) <= 1 &&
                                (u.unitType === 'infantry' || u.unitType === 'support' || u.unitType === 'hero')
                            );
                            if (adj) {
                              const proc = new TurnProcessor(battle.state);
                              proc.embark({ carrierId: unit.id, passengerId: adj.id });
                              persist();
                            }
                          }}
                        >
                          {t('battle:action.embarkAdj')}
                        </button>
                      )}
                      {carrier && (unit.carrying?.length ?? 0) > 0 && (
                        <button
                          className="sm-btn"
                          onClick={() => {
                            const passengerId = unit.carrying?.[0];
                            if (!passengerId) return;
                            const neighbors = isoNeighbors(battle.state.map, unit.coordinate);
                            const open = neighbors.find((c) => {
                              const tile = battle.state.map.tiles[c.r * battle.state.map.width + c.q];
                              if (!tile?.passable) return false;
                              for (const side of Object.values(battle.state.sides)) {
                                for (const u of side.units.values()) {
                                  if (u.stance !== 'destroyed' && !u.embarkedOn && coordinateKey(u.coordinate) === coordinateKey(c)) {
                                    return false;
                                  }
                                }
                              }
                              return true;
                            });
                            if (open) {
                              const proc = new TurnProcessor(battle.state);
                              proc.disembark({ passengerId, target: open });
                              persist();
                            }
                          }}
                        >
                          {t('battle:action.unload')}
                        </button>
                      )}
                      {embarked && (
                        <button
                          className="sm-btn"
                          onClick={() => {
                            const carrierUnit = battle.state.sides.alliance.units.get(embarked);
                            if (!carrierUnit) return;
                            const neighbors = isoNeighbors(battle.state.map, carrierUnit.coordinate);
                            const open = neighbors.find((c) => {
                              const tile = battle.state.map.tiles[c.r * battle.state.map.width + c.q];
                              if (!tile?.passable) return false;
                              for (const side of Object.values(battle.state.sides)) {
                                for (const u of side.units.values()) {
                                  if (
                                    u.stance !== 'destroyed' &&
                                    !u.embarkedOn &&
                                    coordinateKey(u.coordinate) === coordinateKey(c)
                                  ) {
                                    return false;
                                  }
                                }
                              }
                              return true;
                            });
                            if (open) {
                              const proc = new TurnProcessor(battle.state);
                              proc.disembark({ passengerId: unit.id, target: open });
                              persist();
                            }
                          }}
                        >
                          {t('battle:action.disembark')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="muted">{t('battle:panel.selectUnitHint')}</p>
            )}
          </div>
          {targetedEnemy && selected && (
            <div className="unit-card target-card">
              <h3>{t('battle:panel.fireControl')}</h3>
              {(() => {
                const attacker = battle.state.sides.alliance.units.get(selected);
                const def = bundle.units.find(d => d.id === targetedEnemy.definitionId);
                const weapon = attacker ? bestWeapon(attacker, targetedEnemy, battle.state.map, battle.state.weather) : null;
                const canAttackNow = Boolean(attacker && weapon && canAffordAttack(attacker));
                const canSuppressNow = canAttackNow
                  && attacker?.stance === 'ready'
                  && !attacker.statusEffects.has('suppression-used');
                const attackBlockReason = !weapon
                  ? targetLineOfFireBlocked
                    ? t('battle:fireControl.blockedByTerrain')
                    : t('battle:fireControl.blockedByRange')
                  : attacker && !canAffordAttack(attacker)
                    ? attacker.currentAmmo !== Infinity && attacker.currentAmmo <= 0 ? t('errors:noAmmo') : t('battle:fireControl.need2Ap')
                    : '';
                const distance = attacker ? axialDistance(attacker.coordinate, targetedEnemy.coordinate) : 999;
                return (
                  <div className="fire-control">
                    <div className="fire-control-target">
                      <span>{t('battle:fireControl.hostileContact')}</span>
                      <strong>{localizedUnitName(targetedEnemy.definitionId, def?.name ?? targetedEnemy.unitType)}</strong>
                      <small>HP {targetedEnemy.currentHealth}/{targetedEnemy.stats.maxHealth}</small>
                    </div>
                    <div className="fire-control-metrics">
                      <span>
                        <strong>{distance}</strong>
                        {t('battle:fireControl.hex')}
                      </span>
                      {weapon ? (
                        <>
                          <span>
                            <strong>{weapon.hit}%</strong>
                            {t('battle:fireControl.hit')}
                          </span>
                          <span>
                            <strong>{weapon.weapon}</strong>
                            {t('battle:fireControl.weapon')}
                          </span>
                        </>
                      ) : (
                        <span className="fire-control-warning">
                          <strong>{t('battle:fireControl.blocked')}</strong>
                          {t('battle:fireControl.range')}
                        </span>
                      )}
                      {attackBlockReason && (
                        <span className="fire-control-warning">
                          <strong>{attackBlockReason}</strong>
                          {t('battle:fireControl.status')}
                        </span>
                      )}
                    </div>
                    <div className="unit-actions target-actions">
                      <button
                        className="primary-btn"
                        disabled={!canAttackNow}
                        onClick={() => {
                          if (!canAttackNow) {
                            addCombatNotice(attackBlockReason || t('battle:fireControl.attackUnavailable'));
                            AudioManager.play('error');
                            return;
                          }
                          actAttack(selected, targetedEnemy);
                          clearTargeting(false);
                        }}
                      >
                        {t('common:action.attack')}
                      </button>
                      <button
                        className="sm-btn suppress-btn"
                        disabled={!canSuppressNow}
                        title={canSuppressNow ? t('actions:suppress.tooltip') : t('actions:suppress.reasonUnavailable')}
                        onClick={() => {
                          if (!canSuppressNow) return;
                          actSuppress(selected, targetedEnemy);
                          clearTargeting(false);
                        }}
                      >
                        {t('actions:suppress.label')}
                      </button>
                      <button
                        className="sm-btn"
                        onClick={() => clearTargeting(true)}
                      >
                        {t('common:action.cancel')}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {previewEnemy && !deployMode && selectedUnit ? (
            <div className="target-card">
              <h3>{t('battle:panel.target')}</h3>
              <div className="target-intel">
                <strong>{unitDisplayName(previewEnemy.id, battle.state)}</strong>
                <p className="unit-stat-line">
                  HP {compactNumber(previewEnemy.currentHealth)}/{compactNumber(previewEnemy.stats.maxHealth)}
                  <i style={{ '--unit-stat-percent': `${Math.max(0, Math.min(100, Math.round((previewEnemy.currentHealth / previewEnemy.stats.maxHealth) * 100)))}%` } as React.CSSProperties} />
                </p>
                {targetWeaponPreview ? (
                  <>
                    <p className="target-hit">{t('battle:fireControl.hit')} <b>{Math.round((previewHitChance ?? 0) * 100)}%</b>
                      <span className="target-dmg">{t('battle:panel.dmgApprox')} <b>{previewDamage ?? 0}</b></span>
                    </p>
                    <p className={`target-eff ${previewEff >= 1.2 ? 'eff-strong' : previewEff <= 0.65 ? 'eff-weak' : 'eff-ok'}`}>
                      {targetWeaponPreview.weapon}: {previewEff >= 1.2 ? t('battle:panel.effStrong') : previewEff <= 0.65 ? t('battle:panel.effWeak') : t('battle:panel.effOk')} <span>×{previewEff.toFixed(2)}</span>
                    </p>
                    {previewLethal ? <span className="badge badge-kill">{t('battle:panel.likelyKill')}</span> : null}
                  </>
                ) : (
                  <p className="muted">{targetLineOfFireBlocked
                    ? t('battle:panel.lineOfFireBlocked')
                    : t('battle:panel.noWeaponCanHit')}</p>
                )}
              </div>
            </div>
          ) : null}
          <div className="battle-log-panel">
            <h3>{t('battle:panel.combatLog')}</h3>
            <div className="log-entries">
              {combatNotices.length > 0 || battle.state.timeline.length > 0 ? (
                <>
                  {combatNotices.map((notice) => (
                    <div key={`notice-${notice.id}`} className="log-line log-line-alert">{notice.message}</div>
                  ))}
                  {battle.state.timeline.filter((e) => e.kind !== 'unit:xp').slice(-5 + combatNotices.length).reverse().map((e, idx) => {
                    const logTone = e.kind === 'unit:attacked'
                      ? e.hit ? ' log-line-hit' : ' log-line-miss'
                      : e.kind === 'unit:defeated'
                        ? ' log-line-kill'
                        : '';
                    return (
                      <div key={idx} className={`log-line${logTone}`}>{formatBattleEvent(e, battle.state)}</div>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="log-line log-line-muted">{t('battle:panel.tacticalLinkReady')}</div>
                  <div className="log-line log-line-muted">{t('battle:panel.sensorGridOnline')}</div>
                  <div className="log-line log-line-muted">{t('battle:panel.awaitingFireOrder')}</div>
                </>
              )}
            </div>
          </div>
          <div className="battle-controls">
            <button
              className={showRanges ? 'active' : undefined}
              aria-pressed={showRanges}
              onClick={() => setShowRanges((v) => !v)}
            >
              {showRanges ? t('battle:action.hideRanges') : t('battle:action.showRanges')}
            </button>
            <OverwatchButton unit={deployMode ? undefined : selectedUnit} onOverwatch={() => {
              if (!selectedUnit || deployMode) return;
              const proc = new TurnProcessor(battle.state);
              const res = proc.setOverwatch(selectedUnit.id);
              if (!res.success) {
                AudioManager.play('error');
                showToast(res.errorKey ? t(`errors:${res.errorKey}`) : t('errors:cannotSetOverwatch'), 'error');
                return;
              }
              persist();
            }} />
            <SupplyButton
              unit={deployMode ? undefined : selectedUnit}
              hasTarget={!!supplyTargetId}
              onSupply={() => { if (selectedUnit) actSupply(selectedUnit.id); }}
            />
            <HealButton
              unit={deployMode ? undefined : selectedUnit}
              hasTarget={!!healTargetId}
              onHeal={() => { if (selectedUnit) actHeal(selectedUnit.id); }}
            />
            <button
              className={deployMode ? 'primary-btn' : 'end-turn-btn'}
              disabled={!!autoTurnPhase}
              onClick={() => {
                if (autoTurnPhase) return; // Auto Turn owns the turn handoff — no manual End Turn
                if (deployMode) {
                  setDeployMode(false);
                  battle.deployed = true;
                  updateAllFactionsVision(battle.state);
                  persist();
                  return;
                }
                runAiTurn();
              }}
            >
              {deployMode ? t('common:action.startBattle') : t('common:action.endTurn')}
            </button>
            <button
              className={`auto-turn-btn${autoTurnPhase ? ' running' : ''}`}
              title={autoTurnPhase
                ? t('battle:autoTurn.stopTooltip')
                : t('battle:autoTurn.startTooltip')}
              disabled={autoTurnPhase === 'enemy'}
              onClick={() => {
                if (autoTurnPhase) { autoTurnAbortRef.current = true; }
                else { runAutoPlayerTurn(); }
              }}
            >
              {autoTurnPhase ? t('common:action.stopAuto') : deployMode ? t('common:action.autoDeployAndPlay') : t('common:action.autoTurn')}
            </button>
            <button
              className="secondary-btn"
              disabled={!!autoTurnPhase}
              onClick={() => {
                // Retreating mid-CPU-turn unmounts the view under a still-running async battle loop
                // (which keeps mutating state and playing sounds over the strategic screen).
                if (autoTurnPhase || autoTurnBusyRef.current || enemyTurnBusyRef.current) return;
                setRetreatConfirmOpen(true);
              }}
            >
              {t('common:action.retreat')}
            </button>
          </div>
          <div className="command-rack" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      {battleOutcome ? (
        <div className={`battle-outcome-overlay ${battleOutcome.status}`}>
          <div className="battle-outcome-card">
            <div className="battle-outcome-stamp">
              {battleOutcome.status === 'victory' ? t('battle:outcome.sectorSecured') : t('battle:outcome.missionFailed')}
            </div>
            <p className="battle-outcome-sector">{battleOutcome.sectorName}</p>
            <p className="battle-outcome-flavor">
              {battleOutcome.status === 'victory'
                ? t('battle:outcome.victoryFlavor')
                : t('battle:outcome.defeatFlavor')}
            </p>
            {battleOutcome.objectives.length ? (
              <ul className="battle-outcome-objectives">
                {battleOutcome.objectives.map((o, i) => (
                  <li key={i} className={o.met ? 'met' : 'failed'}>
                    <span className="obj-mark">{o.met ? '✓' : '✕'}</span>
                    <span>{o.text}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="battle-outcome-stats">
              <div><dt>{t('battle:outcome.enemiesDestroyed')}</dt><dd>{battleOutcome.enemiesDestroyed}/{battleOutcome.enemiesTotal}</dd></div>
              <div><dt>{t('battle:outcome.squadsSurviving')}</dt><dd>{battleOutcome.squadsSurviving}</dd></div>
              <div><dt>{t('battle:outcome.squadsLost')}</dt><dd className={battleOutcome.squadsLost > 0 ? 'loss' : ''}>{battleOutcome.squadsLost}</dd></div>
              <div><dt>{t('battle:outcome.rounds')}</dt><dd>{battleOutcome.rounds}</dd></div>
            </dl>
            {battleOutcome.reward ? (
              <div className="battle-outcome-spoils">
                <span className="spoils-label">{t('battle:outcome.spoils')}</span>
                <span className="spoils-item">+{battleOutcome.reward.money} <em>CR</em></span>
                <span className="spoils-item">+{battleOutcome.reward.research} <em>RP</em></span>
                <span className="spoils-item">+{battleOutcome.reward.strategic} <em>SP</em></span>
              </div>
            ) : null}
            <button className="primary-btn battle-outcome-continue" onClick={confirmBattleOutcome}>
              {battleOutcome.status === 'victory' ? t('battle:outcome.returnToHq') : t('battle:outcome.regroupAtHq')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
function loadAllSummaries(): (SaveSlot | null)[] {
  if (typeof window === 'undefined') return [null, null, null];
  return [1, 2, 3].map((slot) => {
    const saved = window.localStorage.getItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`);
    if (!saved) return null;
    try {
      const data = JSON.parse(saved);
      // Stored summaries nest resources; MainMenu's SaveSlot wants them flat.
      return {
        slot,
        difficulty: data.difficulty ?? 'commander',
        turn: data.turn,
        money: data.resources?.money ?? 0,
        research: data.resources?.research ?? 0,
        strategic: data.resources?.strategic ?? 0,
        territories: data.territories ?? 0,
        updated: data.updated ?? 0,
        activeBattle: data.activeBattle ?? false,
      };
    } catch {
      return null;
    }
  });
}

function deleteSavedCampaign(slot: number) {
  window.localStorage.removeItem(`${CAMPAIGN_STORAGE_KEY}:${slot}`);
  window.localStorage.removeItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`);
}
export function App() {
  const { t } = useTranslation(['common', 'campaign']);
  const { campaign, mutate, persist, reset, slot, changeSlot } = useCampaign();
  const dismissPopups = () => mutate((s) => { s.popups = []; });
  const [mode, setMode] = useState<'menu' | 'strategic' | 'battle'>('menu');
  const [savedSlots, setSavedSlots] = useState<(SaveSlot | null)[]>(() => loadAllSummaries());
  // Campaign-end sting. Ref-guarded so the frequent strategic re-renders can't re-trigger it.
  const campaignOutcomeStingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!campaign.outcome) { campaignOutcomeStingRef.current = null; return; }
    if (campaignOutcomeStingRef.current === campaign.outcome) return;
    campaignOutcomeStingRef.current = campaign.outcome;
    AudioManager.play(campaign.outcome === 'victory' ? 'victory' : 'defeat');
  }, [campaign.outcome]);
  const reportBattleLaunchError = useCallback((err: unknown) => {
    const reason = err instanceof CampaignError
      ? t(`campaign:errors.${err.key}`, err.params)
      : err instanceof Error ? err.message : t('campaign:errors.genericLaunchFailed');
    mutate((state) => {
      const existing = state.popups ?? [];
      state.popups = existing.some((popup) => popup.key === 'deploymentBlocked' && popup.params?.reason === reason)
        ? existing
        : [...existing, { turn: state.turn, key: 'deploymentBlocked', params: { reason }, kind: 'warning' }];
      state.log.push({ key: 'launchBlocked', params: { reason } });
    });
    showToast(reason, 'warning');
  }, [mutate, t]);
  // Reload saved slots when returning to menu
  useEffect(() => {
    if (mode === 'menu') {
      setSavedSlots(loadAllSummaries());
    }
  }, [mode]);
  const startBattle = (territoryId: string, selectedUnitIds: string[]) => {
    try {
      mutate((state) => {
        startBattleForTerritory(state, bundle, territoryId, selectedUnitIds);
      });
      setMode('battle');
    } catch (err) {
      reportBattleLaunchError(err);
    }
  };
  const handleNewGame = (newSlot: number, difficulty: CampaignDifficulty) => {
    changeSlot(newSlot);
    reset(difficulty);
    setMode('strategic');
  };
  const handleContinue = (continueSlot: number) => {
    const loaded = changeSlot(continueSlot);
    setMode(loaded.activeBattle ? 'battle' : 'strategic');
  };
  const handleDeleteSave = (deletedSlot: number) => {
    deleteSavedCampaign(deletedSlot);
    if (deletedSlot === slot) changeSlot(deletedSlot);
    setSavedSlots(loadAllSummaries());
  };
  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    const campaignControl = {
      mode: () => mode,
      newCampaign: (nextSlot = 1, difficulty: CampaignDifficulty = 'commander') => {
        changeSlot(nextSlot);
        reset(difficulty);
        setMode('strategic');
        return true;
      },
      startBattle: (territoryId?: string) => {
        let started = false;
        try {
          mutate((state) => {
            state.activeBattle = undefined;
            const territory = territoryId
              ? state.territories.find((t) => t.id === territoryId)
              : state.territories.find((t) => t.status === 'available');
            if (!territory) return;
            territory.status = 'available';
            startBattleForTerritory(state, bundle, territory.id);
            started = true;
          });
        } catch (err) {
          reportBattleLaunchError(err);
          return false;
        }
        if (started) {
          setMode('battle');
        }
        return started;
      },
      endTurn: (count = 1) => {
        mutate((state) => {
          for (let i = 0; i < count; i += 1) {
            endStrategicTurn(state, bundle);
          }
        });
        return true;
      },
      startResearch: (topicId: string) => {
        try {
          mutate((state) => startResearch(state, bundle, topicId));
          return true;
        } catch {
          return false;
        }
      },
      convertResearch: (amount = 3) => {
        try {
          mutate((state) => convertStrategicToResearch(state, amount));
          return true;
        } catch {
          return false;
        }
      },
      setArmyUnitHealth: (unitId: string, health: number) => {
        let updated = false;
        mutate((state) => {
          const unit = state.army.find((candidate) => candidate.id === unitId);
          const definition = unit ? bundle.units.find((candidate) => candidate.id === unit.definitionId) : undefined;
          if (!unit || !definition) return;
          unit.currentHealth = Math.max(1, Math.min(definition.stats.maxHealth, health));
          updated = true;
        });
        return updated;
      },
      setMoney: (amount: number) => {
        mutate((state) => { state.resources.money = Math.max(0, amount); });
        return true;
      },
      dismissPopups: () => {
        mutate((state) => {
          state.popups = [];
        });
        return true;
      },
      territories: () => campaign.territories.map((t) => ({
        id: t.id,
        scenarioId: t.scenarioId,
        status: t.status,
        name: t.name
      })),
      army: () => campaign.army.map((unit) => ({
        id: unit.id,
        definitionId: unit.definitionId,
        health: unit.currentHealth,
        experience: unit.experience,
        tier: unit.tier
      })),
      formations: () => campaign.formations.map((formation) => ({
        id: formation.id,
        units: [...formation.units]
      })),
      research: () => ({
        active: campaign.research.inProgress ? { ...campaign.research.inProgress } : null,
        paused: { ...campaign.research.paused },
        completed: Array.from(campaign.research.completed)
      })
    };
    const devWindow = window as typeof window & { __campaignControl?: typeof campaignControl };
    devWindow.__campaignControl = campaignControl;
    return () => {
      delete devWindow.__campaignControl;
    };
  }, [campaign, mode, changeSlot, mutate, reset, reportBattleLaunchError]);
  // Show menu
  if (mode === 'menu') {
    return (
      <>
        <ToastContainer />
        <MainMenu
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          onDeleteSave={handleDeleteSave}
          savedSlots={savedSlots}
          currentSlot={slot}
        />
      </>
    );
  }
  // Show battle
  if (campaign.activeBattle && mode === 'battle') {
    return (
      <>
        <ToastContainer />
        <BattleView
          campaign={campaign}
          onVictory={() => setMode('strategic')}
          onDefeat={() => setMode('strategic')}
          onRetreat={() => setMode('strategic')}
          persist={persist}
        />
      </>
    );
  }
  // Show strategic HQ
  const availableUnits = bundle.units
    .filter((u) => u.faction === 'alliance')
    .map((u) => {
      const ownedCount = campaign.army.filter((unit) => unit.definitionId === u.id).length;
      const reserveCount = campaign.reserves.filter((unit) => unit.definitionId === u.id).length;
      const unlocked = isUnitUnlocked(campaign, bundle, u.id);
      const canAfford = campaign.resources.money >= u.cost;
      const uniqueHeroAlreadyQueued = u.type === 'hero' && (ownedCount > 0 || reserveCount > 0);
      const unlockingTopic = bundle.research.find((topic) => topic.unlocks.includes(u.id));
      return {
        id: u.id,
        name: localizedUnitName(u.id, u.name),
        unitType: u.type,
        unlocked,
        cost: u.cost,
        canAfford,
        canRecruit: unlocked && canAfford && !uniqueHeroAlreadyQueued,
        ownedCount,
        reserveCount,
        requiredResearch: unlockingTopic
          ? localizedResearchName(unlockingTopic.id, unlockingTopic.name)
          : undefined,
      };
    });
  const toArmyUnit = (u: (typeof campaign.army)[number]) => {
    const def = bundle.units.find((d) => d.id === u.definitionId)!;
    const isFieldUnit = campaign.army.some((unit) => unit.id === u.id);
    const refillQuotes = Object.fromEntries((['rookie', 'veteran', 'elite'] as const).map((quality) => [
      quality,
      isFieldUnit
        ? projectUnitService(campaign, bundle, u.id, { kind: 'refill', quality })
        : { cost: 0, experienceAfter: u.experience, tierAfter: u.tier }
    ])) as Record<'rookie' | 'veteran' | 'elite', ReturnType<typeof projectUnitService>>;
    const rearmOptions = isFieldUnit
      ? getUnitRearmOptions(campaign, bundle, u.id).map((candidate) => {
          const quote = projectUnitService(campaign, bundle, u.id, { kind: 'rearm', definitionId: candidate.id });
          return {
            definitionId: candidate.id,
            name: localizedUnitName(candidate.id, candidate.name),
            cost: quote.cost,
            experienceAfter: quote.experienceAfter,
            tierAfter: quote.tierAfter
          };
        })
      : [];
    return {
      id: u.id,
      definitionId: u.definitionId,
      name: localizedUnitName(u.definitionId, def?.name ?? u.definitionId),
      unitType: def?.type ?? 'unit',
      tier: u.tier,
      currentHealth: u.currentHealth ?? def?.stats.maxHealth ?? 100,
      maxHealth: def?.stats.maxHealth ?? 100,
      experience: u.experience ?? 0,
      level: experienceLevelFor(u.experience ?? 0),
      refillQuotes,
      rearmOptions,
      formationId: campaign.formations.find((formation) => formation.units.includes(u.id))?.id,
      availableOnTurn: u.availableOnTurn,
    };
  };
  const armyUnits = campaign.army.map(toArmyUnit);
  const reserveUnits = campaign.reserves.map(toArmyUnit);
  const territories = campaign.territories.map((t) => ({
    id: t.id,
    name: localizedTerritoryName(t),
    brief: localizedTerritoryBrief(t),
    status: t.status,
    remainingTimer: t.remainingTimer,
    mapPosition: t.mapPosition,
    requires: t.requires,
    region: t.region,
    difficulty: t.difficulty,
  }));
  const researchTopics = bundle.research.map((topic) => ({
    ...topic,
    name: localizedResearchName(topic.id, topic.name),
    description: localizedResearchDescription(topic.id, topic.description),
  }));
  const operationPlans = Object.fromEntries(campaign.territories.map((territory) => [
    territory.id,
    getOperationDeploymentPlan(campaign, bundle, territory.id)
  ]));
  return (
    <>
      <ToastContainer />
      {campaign.outcome ? (
        <div className="gameover-overlay">
          <div className={`gameover-panel ${campaign.outcome}`}>
            <h1>{campaign.outcome === 'victory' ? t('campaign:gameover.won') : t('campaign:gameover.lost')}</h1>
            <p className="gameover-flavor">
              {campaign.outcome === 'victory'
                ? t('campaign:gameover.victoryFlavor')
                : t('campaign:gameover.defeatFlavor')}
            </p>
            <dl className="gameover-summary">
              <div className="gameover-stat">
                <dt>{t('campaign:gameover.sectorsCleared')}</dt>
                <dd>{campaign.territories.filter((t) => t.status === 'cleared').length}/{campaign.territories.length}</dd>
              </div>
              <div className="gameover-stat">
                <dt>{t('campaign:gameover.turnsTaken')}</dt>
                <dd>{campaign.turn}</dd>
              </div>
              <div className="gameover-stat">
                <dt>{t('campaign:gameover.unitsSurviving')}</dt>
                <dd>{campaign.army.length}{campaign.reserves.length ? ` (${t('campaign:gameover.reserveSuffix', { count: campaign.reserves.length })})` : ''}</dd>
              </div>
              <div className="gameover-stat">
                <dt>{t('campaign:gameover.techResearched')}</dt>
                <dd>{campaign.research.completed.size}</dd>
              </div>
            </dl>
            <div className="gameover-actions">
              <button className="primary-btn" onClick={() => { reset(campaign.difficulty); }}>{t('campaign:gameover.newCampaign')}</button>
              <button className="secondary-btn" onClick={() => setMode('menu')}>{t('campaign:gameover.mainMenu')}</button>
            </div>
          </div>
        </div>
      ) : null}
      <StrategicHQ
        campaignDifficulty={campaign.difficulty}
        turn={campaign.turn}
        operationAvailable={campaign.lastOperationTurn !== campaign.turn}
        warClock={campaign.globalTimer}
        money={campaign.resources.money}
        research={campaign.resources.research}
        strategic={campaign.resources.strategic}
        army={armyUnits}
        reserves={reserveUnits}
        formations={campaign.formations}
        territories={territories}
        operationPlans={operationPlans}
        researchTopics={researchTopics}
        currentResearch={campaign.research.inProgress ?? null}
        pausedResearch={campaign.research.paused}
        completedResearch={campaign.research.completed}
        log={campaign.log}
        popups={campaign.popups}
        onStartBattle={startBattle}
        onEndTurn={() => mutate((s) => endStrategicTurn(s, bundle))}
        onRecruit={(id, tier) => {
          try {
            mutate((s) => recruitUnit(s, bundle, id, tier));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericRecruitFailed');
            showToast(reason, 'error');
          }
        }}
        onRefill={(id, tier) => {
          try {
            mutate((s) => refillUnit(s, bundle, id, tier));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericRefillFailed');
            showToast(reason, 'error');
          }
        }}
        onRearm={(id, definitionId) => {
          try {
            mutate((s) => rearmUnit(s, bundle, id, definitionId));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericRearmFailed');
            showToast(reason, 'error');
          }
        }}
        onSetFormation={(id, formationId) => {
          try {
            mutate((s) => setUnitFormation(s, id, formationId));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericFormationFailed');
            showToast(reason, 'error');
          }
        }}
        onDismiss={(id) => mutate((s) => dismissUnit(s, bundle, id))}
        onResearch={(topic) => {
          try {
            mutate((s) => startResearch(s, bundle, topic));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericResearchFailed');
            showToast(reason, 'error');
          }
        }}
        onPauseResearch={() => {
          try {
            mutate((s) => pauseResearch(s, bundle));
          } catch (err) {
            const reason = err instanceof CampaignError ? t(`campaign:errors.${err.key}`, err.params) : t('campaign:errors.genericResearchFailed');
            showToast(reason, 'error');
          }
        }}
        onConvertMoney={(amt) => mutate((s) => convertStrategicToMoney(s, amt))}
        onConvertResearch={(amt) => mutate((s) => convertStrategicToResearch(s, amt))}
        onBack={() => setMode('menu')}
        onDismissPopups={dismissPopups}
        availableUnits={availableUnits}
      />
    </>
  );
}
export default App;
