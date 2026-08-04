import type { CampaignDifficulty, CampaignState } from '@spellcross/core';
import type { EquipmentCategory } from '@spellcross/data';
import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { clearToasts } from './Toast.js';
import { unitPortrait } from './unitVisuals.js';
import i18n from '../i18n/index.js';
import type { LocalizedOperationDossier } from '../operationDossiers.js';
import { AudioManager } from '../services/AudioManager.js';

interface Territory {
  id: string;
  name: string;
  brief: string;
  status: string;
  remainingTimer?: number;
  mapPosition?: { x: number; y: number };
  requires?: string[];
  requiresAny?: string[];
  route?: { territoryId: string; result: 'victory' | 'defeat' };
  act?: 1 | 2;
  region?: string;
  difficulty?: number;
}

interface ArmyUnit {
  id: string;
  definitionId: string;
  name: string;
  unitType: string;
  tier: string;
  currentHealth: number;
  maxHealth: number;
  experience: number;
  level: number;
  refillQuotes: Record<'rookie' | 'veteran' | 'elite', {
    cost: number;
    experienceAfter: number;
    tierAfter: string;
  }>;
  rearmOptions: Array<{
    definitionId: string;
    name: string;
    cost: number;
    experienceAfter: number;
    tierAfter: string;
    equipmentResetCount: number;
  }>;
  equipmentOptions: Array<{
    id: string;
    category: EquipmentCategory;
    name: string;
    description: string;
    cost: number;
    unlocked: boolean;
    fitted: boolean;
    requiredResearch: string;
    preview: Array<{
      stat: 'armor' | 'morale' | 'mobility' | 'vision' | 'weaponPower' | 'range' | 'accuracy';
      before: number;
      after: number;
      weaponId?: string;
      percent?: boolean;
    }>;
  }>;
  formationId?: string;
  availableOnTurn?: number;
}

interface FormationSummary {
  id: string;
  name: string;
  units: string[];
  baseBonus: { attack: number; defense: number; morale: number };
  bonus: { attack: number; defense: number; morale: number };
  capacity: number;
  overstrength: boolean;
  shockMoralePenalty: number;
  commandShockUntilTurn?: number;
  officerId?: string;
  officerName?: string;
  officerRankName?: string;
  assignedUnitId?: string;
}

interface OfficerSummary {
  id: string;
  profileId: string;
  name: string;
  callsign: string;
  description: string;
  recruitCost: number;
  bonus: { attack: number; defense: number; morale: number };
  status: 'available' | 'active' | 'fallen';
  rankId?: string;
  rankName?: string;
  capacity?: number;
  service: number;
  assignedUnitId?: string;
  assignedUnitName?: string;
  assignedFormationId?: string;
  assignedFormationName?: string;
  canRecruit: boolean;
  nextRank?: {
    id: string;
    name: string;
    cost: number;
    requiredService: number;
    capacity: number;
    bonus: { attack: number; defense: number; morale: number };
    ready: boolean;
    canAfford: boolean;
  };
}

interface OperationPlan {
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

interface ResearchTopic {
  id: string;
  name: string;
  description: string;
  cost: number;
  unlocks?: string[];
  requires?: string[];
}

interface StrategicHQProps {
  campaignDifficulty: CampaignDifficulty;
  turn: number;
  operationAvailable: boolean;
  warClock: number;
  money: number;
  research: number;
  strategic: number;
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  formations: FormationSummary[];
  officers: OfficerSummary[];
  territories: Territory[];
  operationPlans: Record<string, OperationPlan>;
  operationDossiers: Record<string, LocalizedOperationDossier>;
  researchTopics: ResearchTopic[];
  currentResearch: { topicId: string; remaining: number } | null;
  pausedResearch: Record<string, number>;
  completedResearch: Set<string>;
  log: CampaignState['log'];
  popups?: CampaignState['popups'];
  onStartBattle: (territoryId: string, selectedUnitIds: string[]) => void;
  onEndTurn: () => void;
  onRecruit: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRefill: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRearm: (unitId: string, definitionId: string) => void;
  onSetEquipment: (unitId: string, category: EquipmentCategory, equipmentId?: string) => void;
  onSetFormation: (unitId: string, formationId?: string) => void;
  onRecruitOfficer: (profileId: string) => void;
  onPromoteOfficer: (officerId: string) => void;
  onAssignOfficer: (officerId: string, unitId?: string) => void;
  onDismiss: (unitId: string) => void;
  onResearch: (topicId: string) => void;
  onPauseResearch: () => void;
  onConvertMoney: (amount: number) => void;
  onConvertResearch: (amount: number) => void;
  onBack: () => void;
  onDismissPopups?: () => void;
  availableUnits: {
    id: string;
    name: string;
    unitType: string;
    unlocked: boolean;
    cost: number;
    canAfford: boolean;
    canRecruit: boolean;
    ownedCount: number;
    reserveCount: number;
    requiredResearch?: string;
  }[];
}

function rosterPortrait(definitionId: string, unitType: string) {
  return unitPortrait(unitType, definitionId, true);
}

function officerInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function signedCommandValue(value: number) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

const recruitFilters = ['all', 'infantry', 'vehicle', 'artillery', 'air', 'support', 'hero'] as const;
type RecruitFilter = (typeof recruitFilters)[number];
type HQModal = 'planner' | 'service';

const HQ_MODAL_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function defaultDeploymentSelection(plan: OperationPlan) {
  const selected = [...plan.requiredUnitIds];
  for (const unitId of plan.availableUnitIds) {
    if (selected.length >= plan.capacity) break;
    if (!selected.includes(unitId)) selected.push(unitId);
  }
  return selected;
}

function researchBranch(topic: ResearchTopic) {
  const key = `${topic.id} ${topic.name} ${(topic.unlocks ?? []).join(' ')}`.toLowerCase();
  if (topic.id === 'mobile-fire-support' || topic.id === 'deep-fires-network') return 'artillery';
  if (key.includes('optics') || key.includes('recon') || key.includes('ranger') || key.includes('sniper')) return 'recon';
  if (key.includes('armor') || key.includes('plating') || key.includes('leopard') || key.includes('tank')) return 'armor';
  if (key.includes('ammo') || key.includes('corps') || key.includes('infantry') || key.includes('mortar')) return 'infantry';
  if (key.includes('supply')) return 'logistics';
  if (key.includes('arcane') || key.includes('wyrm') || key.includes('sky')) return 'arcane';
  if (key.includes('siege') || key.includes('artillery')) return 'artillery';
  return 'doctrine';
}

function researchBranchLabel(branch: string, t: TFunction<'hq'>) {
  switch (branch) {
    case 'recon':
      return t('branch.recon');
    case 'armor':
      return t('branch.armor');
    case 'infantry':
      return t('branch.infantry');
    case 'logistics':
      return t('branch.logistics');
    case 'arcane':
      return t('branch.warding');
    case 'artillery':
      return t('branch.siege');
    default:
      return t('branch.doctrine');
  }
}

function armySectionKey(unit: ArmyUnit) {
  const key = `${unit.definitionId} ${unit.name} ${unit.unitType}`.toLowerCase();
  if (unit.unitType === 'hero' || key.includes('captain')) return 'command';
  if (key.includes('ranger') || key.includes('recon') || key.includes('sniper')) return 'recon';
  if (unit.unitType === 'vehicle' || unit.unitType === 'artillery' || key.includes('m113') || key.includes('tank')) return 'vehicles';
  if (unit.unitType === 'support' || key.includes('truck') || key.includes('medic')) return 'support';
  return 'infantry';
}

function equipmentWeaponLabel(weaponId: string) {
  return weaponId
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function equipmentStatValue(value: number, percent?: boolean) {
  return percent ? `${Math.round(value * 100)}%` : Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function armySectionLabel(section: string, t: TFunction<'hq'>) {
  switch (section) {
    case 'command':
      return t('army.section.command');
    case 'recon':
      return t('army.section.recon');
    case 'vehicles':
      return t('army.section.vehicles');
    case 'support':
      return t('army.section.support');
    default:
      return t('army.section.infantry');
  }
}

function regionLabel(region: string, t: TFunction<'hq'>) {
  switch (region) {
    case 'France':
      return t('region.france');
    case 'Germany':
      return t('region.germany');
    case 'Austria':
      return t('region.austria');
    case 'Poland':
      return t('region.poland');
    case 'Ukraine':
      return t('region.ukraine');
    case 'Belgium':
      return t('region.belgium');
    case 'Czech Republic':
      return t('region.czechRepublic');
    case 'Denmark':
      return t('region.denmark');
    case 'Netherlands':
      return t('region.netherlands');
    case 'Switzerland':
      return t('region.switzerland');
    case 'The Rift':
      return t('region.theRift');
    case 'Shatterline':
      return t('region.shatterline');
    default:
      return region;
  }
}

// Campaign log entries carry an i18n key + params (see CampaignLogEntry in @spellcross/core) so they
// render in the active locale instead of always English.
// Log/popup params from packages/core carry a raw English content name (territory/topic/unit)
// alongside its stable id, since the engine itself stays locale-agnostic. Re-resolve the display
// name through the active locale before interpolating it into the translated sentence.
function localizedLogParams(params?: Record<string, string | number>) {
  if (!params) return params;
  const resolved = { ...params };
  if (typeof params.territoryId === 'string' && typeof params.territory === 'string') {
    resolved.territory = i18n.t(`territories:${params.territoryId}.name`, { defaultValue: params.territory });
  }
  if (typeof params.targetId === 'string' && typeof params.target === 'string') {
    resolved.target = i18n.t(`territories:${params.targetId}.name`, { defaultValue: params.target });
  }
  if (typeof params.topicId === 'string' && typeof params.topic === 'string') {
    resolved.topic = i18n.t(`research:${params.topicId}.name`, { defaultValue: params.topic });
  }
  if (typeof params.unitId === 'string' && typeof params.name === 'string') {
    resolved.name = i18n.t(`units:${params.unitId}.name`, { defaultValue: params.name });
  }
  if (typeof params.campaignId === 'string' && typeof params.name === 'string') {
    resolved.name = i18n.t(`campaign:names.${params.campaignId}`, { defaultValue: params.name });
  }
  if (typeof params.tier === 'string') {
    resolved.tier = i18n.t(`hq:army.tier.${params.tier}`, { defaultValue: params.tier });
  }
  if (typeof params.quality === 'string') {
    resolved.quality = i18n.t(`hq:army.tier.${params.quality}`, { defaultValue: params.quality });
  }
  if (typeof params.equipmentId === 'string' && typeof params.equipment === 'string') {
    resolved.equipment = i18n.t(`hq:service.packages.${params.equipmentId}.name`, {
      defaultValue: params.equipment
    });
  }
  if (typeof params.category === 'string') {
    resolved.category = i18n.t(`hq:service.categories.${params.category}`, {
      defaultValue: params.category
    });
  }
  if (typeof params.officerId === 'string' && typeof params.officer === 'string') {
    resolved.officer = i18n.t(`hq:army.officerProfiles.${params.officerId}.name`, {
      defaultValue: params.officer
    });
  }
  if (typeof params.rankId === 'string' && typeof params.rank === 'string') {
    resolved.rank = i18n.t(`hq:army.officerRanks.${params.rankId}`, {
      defaultValue: params.rank
    });
  }
  if (typeof params.formationId === 'string' && typeof params.formation === 'string') {
    resolved.formation = i18n.t(`hq:army.formationName.${params.formationId}`, {
      defaultValue: params.formation
    });
  }
  return resolved;
}

function formatCampaignLogEntry(entry: CampaignState['log'][number], t: TFunction<'campaign'>) {
  return t(`campaign:log.${entry.key}`, localizedLogParams(entry.params));
}

type CampaignPopup = NonNullable<CampaignState['popups']>[number];
function popupTitle(popup: CampaignPopup, t: TFunction<'campaign'>) {
  return t(`campaign:popups.${popup.key}.title`, localizedLogParams(popup.params));
}
function popupBody(popup: CampaignPopup, t: TFunction<'campaign'>) {
  return t(`campaign:popups.${popup.key}.body`, localizedLogParams(popup.params));
}

// Strategic Map View Component with visual Europe map
const StrategicMapView: React.FC<{
  territories: Territory[];
  selectedTerritory: string | null;
  onSelectTerritory: (id: string | null) => void;
  onStartBattle: (id: string) => void;
  log: CampaignState['log'];
  operationAvailable: boolean;
}> = ({ territories, selectedTerritory, onSelectTerritory, onStartBattle, log, operationAvailable }) => {
  // Aliased to `translate` (not `t`) — this component uses `t` pervasively as a loop variable name for
  // Territory objects (`territories.map((t) => t.status)` etc.), which would shadow the i18n function.
  const { t: translate } = useTranslation(['hq', 'territories', 'campaign']);
  const actTwoUnlocked = territories.some((territory) => (
    territory.act === 2 && territory.status !== 'locked'
  ));
  const selectedAct = territories.find((territory) => territory.id === selectedTerritory)?.act ?? 1;
  const [mapAct, setMapAct] = useState<1 | 2>(() => (
    selectedAct === 2 && actTwoUnlocked ? 2 : actTwoUnlocked ? 2 : 1
  ));
  const mapSvgRef = useRef<SVGSVGElement>(null);
  const [territoryHitRadius, setTerritoryHitRadius] = useState(3.2);
  useEffect(() => {
    const map = mapSvgRef.current;
    if (!map || typeof ResizeObserver === 'undefined') return;

    const updateHitRadius = () => {
      const bounds = map.getBoundingClientRect();
      const renderedScale = Math.min(bounds.width / 100, bounds.height / 80);
      if (renderedScale <= 0) return;
      const nextRadius = Math.max(3.2, 12.1 / renderedScale);
      setTerritoryHitRadius((current) => Math.abs(current - nextRadius) < 0.001 ? current : nextRadius);
    };

    updateHitRadius();
    const observer = new ResizeObserver(updateHitRadius);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!actTwoUnlocked && mapAct === 2) setMapAct(1);
  }, [actTwoUnlocked, mapAct]);
  useEffect(() => {
    if (selectedTerritory && selectedAct === 2 && actTwoUnlocked) setMapAct(2);
  }, [actTwoUnlocked, selectedAct, selectedTerritory]);
  const mapTerritories = useMemo(() => (
    territories.filter((territory) => (territory.act ?? 1) === mapAct)
  ), [mapAct, territories]);
  const selected = mapTerritories.find(t => t.id === selectedTerritory);
  const statusCounts = useMemo(() => ({
    cleared: mapTerritories.filter((t) => t.status === 'cleared').length,
    available: mapTerritories.filter((t) => t.status === 'available').length,
    locked: mapTerritories.filter((t) => t.status === 'locked').length,
    failed: mapTerritories.filter((t) => t.status === 'failed').length,
    resolved: mapTerritories.filter((t) => t.status === 'resolved').length,
    bypassed: mapTerritories.filter((t) => t.status === 'bypassed').length
  }), [mapTerritories]);
  const urgentTerritory = useMemo(() => (
    mapTerritories
      .filter((t) => t.status === 'available' && t.remainingTimer != null)
      .sort((a, b) => (a.remainingTimer ?? 99) - (b.remainingTimer ?? 99))[0]
  ), [mapTerritories]);
  const nextLockedTerritory = useMemo(() => (
    mapTerritories.find((t) => t.status === 'locked')
  ), [mapTerritories]);
  const rapidResponseOperations = useMemo(() => (
    mapTerritories.filter((territory) => territory.status === 'available' && !territory.mapPosition)
  ), [mapTerritories]);

  const connections = useMemo(() => {
    const lines: Array<{ from: Territory; to: Territory; routed: boolean; alternative: boolean }> = [];
    for (const t of mapTerritories) {
      if (t.mapPosition) {
        for (const reqId of t.requires ?? []) {
          const req = mapTerritories.find(r => r.id === reqId);
          if (req?.mapPosition) {
            lines.push({ from: req, to: t, routed: false, alternative: false });
          }
        }
        for (const reqId of t.requiresAny ?? []) {
          const req = mapTerritories.find(r => r.id === reqId);
          if (req?.mapPosition) {
            lines.push({ from: req, to: t, routed: false, alternative: true });
          }
        }
      }
      if (t.route && t.mapPosition) {
        const source = mapTerritories.find((territory) => territory.id === t.route?.territoryId);
        if (source?.mapPosition) lines.push({ from: source, to: t, routed: true, alternative: false });
      }
    }
    return lines;
  }, [mapTerritories]);

  const selectTheater = (act: 1 | 2) => {
    if (act === 2 && !actTwoUnlocked) return;
    setMapAct(act);
    const currentSelection = territories.find((territory) => territory.id === selectedTerritory);
    if ((currentSelection?.act ?? 1) === act) return;
    const candidates = territories.filter((territory) => (territory.act ?? 1) === act);
    const nextSelection = candidates.find((territory) => territory.status === 'available')
      ?? candidates.find((territory) => territory.status === 'failed')
      ?? candidates.find((territory) => territory.status === 'cleared')
      ?? candidates[0];
    onSelectTerritory(nextSelection?.id ?? null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'cleared': return '#22c55e';
      case 'available': return '#eab308';
      case 'locked': return '#6b7280';
      case 'failed': return '#ef4444';
      case 'resolved': return '#38bdf8';
      case 'bypassed': return '#59636c';
      default: return '#6b7280';
    }
  };

  // Short map-pin label per territory, keyed by the stable id (not the localized display name) — the
  // old version derived this by taking the first word of `name`, which breaks once names are translated
  // (e.g. Slovak "Parížske okolie".split(' ')[0] => "Parížske", not a place name).
  const mapLabelForTerritory = (id: string) => translate(`territories:mapLabel.${id}`, { defaultValue: id.replace(/^sector-/, '') });

  const getDifficultyStars = (diff: number = 1) => '★'.repeat(diff) + '☆'.repeat(5 - diff);
  const selectedRequirements = selected?.requires ?? selected?.requiresAny ?? [];
  const requirementComplete = (territory?: Territory) => (
    territory?.status === 'cleared' || territory?.status === 'resolved'
  );

  return (
    <div className="strategic-map-view">
      {/* Main map area */}
      <div className="strategic-map-container">
        <div className="map-theater-switch" aria-label={translate('hq:map.theater')}>
          <span>{translate('hq:map.theater')}</span>
          <button
            type="button"
            aria-pressed={mapAct === 1}
            onClick={() => selectTheater(1)}
          >
            {translate('hq:map.actOneTheater')}
          </button>
          <button
            type="button"
            aria-pressed={mapAct === 2}
            disabled={!actTwoUnlocked}
            onClick={() => selectTheater(2)}
          >
            {translate('hq:map.actTwoTheater')}
          </button>
        </div>
        <svg
          ref={mapSvgRef}
          viewBox="0 0 100 80"
          className="strategic-map-svg"
          preserveAspectRatio="xMidYMid meet"
          data-theater={mapAct}
        >
          <defs>
            <radialGradient id="mapGradientActOne" cx="85%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#493036" />
              <stop offset="52%" stopColor="#394b39" />
              <stop offset="100%" stopColor="#263946" />
            </radialGradient>
            <radialGradient id="mapGradientActTwo" cx="50%" cy="42%" r="72%">
              <stop offset="0%" stopColor="#3d3154" />
              <stop offset="48%" stopColor="#253c3d" />
              <stop offset="100%" stopColor="#101923" />
            </radialGradient>
            <pattern id="paperGrain" width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="transparent" />
              <circle cx="1" cy="1" r="0.16" fill="#2e2419" opacity="0.22" />
              <circle cx="3" cy="2" r="0.12" fill="#fff1c0" opacity="0.16" />
            </pattern>
            <pattern id="mapGrid" width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#283331" strokeWidth="0.08" opacity="0.55" />
            </pattern>
            <linearGradient id="frontGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#182544" stopOpacity="0.42" />
              <stop offset="58%" stopColor="#4a1d24" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#7a2326" stopOpacity="0.5" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="0.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Map background */}
          <rect
            x="0"
            y="0"
            width="100"
            height="80"
            fill={`url(#mapGradientAct${mapAct === 1 ? 'One' : 'Two'})`}
          />
          <rect x="0" y="0" width="100" height="80" fill="url(#paperGrain)" opacity="0.55" />
          <rect x="0" y="0" width="100" height="80" fill="url(#mapGrid)" opacity="0.42" />
          {mapAct === 1 ? (
            <g className="europe-cartography">
              <path d="M 0,0 L 100,0 L 100,80 L 75,80 C 62,72 53,66 40,63 C 26,60 12,54 0,47 Z" fill="#111d2a" opacity="0.28" />
              <path d="M 52,10 C 60,15 69,15 79,24 C 88,31 92,38 96,50 L 100,80 L 64,80 C 76,69 86,60 91,47 C 96,34 83,22 70,17 C 62,14 56,15 52,10 Z" fill="url(#frontGradient)" />
              <path d="M 12,55 C 24,46 36,48 48,52 C 58,55 67,53 78,46" fill="none" stroke="#273f52" strokeWidth="0.36" opacity="0.45" />
              <path d="M 48,17 C 49,25 52,31 55,39 C 57,45 56,51 52,57" fill="none" stroke="#25394b" strokeWidth="0.28" opacity="0.42" />
              <path d="M 36,28 C 44,31 52,31 59,35 C 67,39 75,38 84,42" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.5" />
              <path d="M 22,44 C 32,48 43,50 52,57" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.42" />
              <path d="M 61,22 C 70,27 79,29 89,35" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.48" />
              <path
                d="M 15,25 Q 20,20 30,18 L 50,12 Q 55,15 60,14 L 70,18 Q 80,22 85,30 L 88,45 Q 85,55 80,60 L 70,65 Q 60,68 50,65 L 40,60 Q 30,55 25,50 L 20,40 Q 15,35 15,25"
                fill="none"
                stroke="#3d3125"
                strokeWidth="0.45"
                opacity="0.65"
              />
              <path d="M 17,26 Q 26,22 36,21 Q 46,19 53,15" fill="none" stroke="#5d513d" strokeWidth="0.18" opacity="0.5" />
              <path d="M 28,54 Q 39,58 52,63 Q 60,66 69,64" fill="none" stroke="#5d513d" strokeWidth="0.16" opacity="0.42" />
              <path d="M 72,22 Q 81,28 86,39 Q 87,48 82,57" fill="none" stroke="#5d513d" strokeWidth="0.16" opacity="0.45" />
              {[
                ['Paris', 25, 44],
                ['Lyon', 30, 57],
                ['Amsterdam', 32, 28],
                ['Berlin', 49, 33],
                ['Prague', 50, 42],
                ['Vienna', 53, 53],
                ['Warsaw', 61, 38],
                ['Kyiv', 75, 43]
              ].map(([name, x, y]) => (
                <circle key={name} cx={x} cy={y} r="0.45" fill="#1b2422" opacity="0.7" />
              ))}
              <text x="20" y="50" className="region-label">{translate('hq:region.france')}</text>
              <text x="42" y="41" className="region-label">{translate('hq:region.germany')}</text>
              <text x="53" y="59" className="region-label">{translate('hq:region.austria')}</text>
              <text x="69" y="35" className="region-label">{translate('hq:region.poland')}</text>
              <text x="76" y="62" className="region-label">{translate('hq:region.ukraine')}</text>
            </g>
          ) : (
            <g className="shatterline-cartography">
              <path className="shatterland" d="M 4,17 C 15,9 27,14 35,8 C 45,1 57,12 66,7 C 78,1 93,9 98,22 L 94,67 C 83,77 70,68 61,74 C 50,81 41,69 31,74 C 20,79 7,68 3,54 Z" />
              <path className="rift-band" d="M 2,43 C 18,32 29,48 43,38 C 57,27 67,47 80,34 C 88,26 94,32 100,25" />
              <path className="rift-band secondary" d="M 8,63 C 21,51 35,65 48,55 C 61,46 75,61 94,49" />
              <path className="horizon-fault" d="M 11,22 L 23,17 L 31,25 L 43,15 L 54,24 L 66,13 L 78,23 L 91,17" />
              <path className="horizon-fault lower" d="M 14,53 L 24,46 L 35,57 L 47,48 L 59,58 L 72,49 L 84,57" />
              {[18, 34, 50, 66, 82].map((x, index) => (
                <g key={x} className="echo-spire" transform={`translate(${x} ${index % 2 ? 64 : 16})`}>
                  <path d="M -1.2,3 L 0,-3 L 1.2,3 Z" />
                  <circle cx="0" cy="0" r="2.2" />
                </g>
              ))}
              <text x="50" y="11" className="shatterline-label">{translate('hq:region.shatterline')}</text>
            </g>
          )}

          {/* Connection lines */}
          {connections.map((conn, i) => (
            <line
              key={i}
              x1={conn.from.mapPosition!.x}
              y1={conn.from.mapPosition!.y}
              x2={conn.to.mapPosition!.x}
              y2={conn.to.mapPosition!.y}
                stroke={conn.to.status === 'locked' ? '#555d58' : '#8a907b'}
                strokeWidth="0.3"
                strokeDasharray={conn.routed ? '0.55,0.65' : conn.alternative ? '2,0.8' : conn.to.status === 'locked' ? '1,1' : 'none'}
                opacity={conn.to.status === 'locked' ? 0.54 : 0.72}
                className={conn.routed ? 'route-connection' : conn.alternative ? 'alternative-connection' : undefined}
              />
          ))}

          {selected?.mapPosition && (
            <g className="active-front-vector">
              <line
                x1={selected.mapPosition.x}
                y1={selected.mapPosition.y}
                x2={mapAct === 1 ? 87 : 95}
                y2={mapAct === 1 ? 52 : 40}
              />
              <path d={`M ${selected.mapPosition.x + 2.2},${selected.mapPosition.y + 0.4} L ${selected.mapPosition.x + 4.6},${selected.mapPosition.y - 1.2} L ${selected.mapPosition.x + 5.4},${selected.mapPosition.y + 1.4}`} />
            </g>
          )}

          {mapAct === 1 && (
            <>
              <path
                d="M 88,52 L 94,47 L 94,50 L 97,50 L 97,54 L 94,54 L 94,57 Z"
                fill="#ef4444"
                opacity="0.24"
              />
              <text x="91" y="60" className="invasion-label">{translate('hq:map.invasion')}</text>
            </>
          )}

          {/* Territory markers */}
          {mapTerritories.map(t => {
            if (!t.mapPosition) return null;
            const isSelected = t.id === selectedTerritory;
            const isSeaAnchor = t.id === 'sector-blacksea';
            const color = getStatusColor(t.status);
            const markerFill = t.status === 'locked' || t.status === 'bypassed'
              ? (isSeaAnchor ? '#243745' : '#27272a')
              : color;
            const markerStroke = isSelected
              ? '#ffffff'
              : (t.status === 'locked' && isSeaAnchor ? '#7f95a3' : color);

            return (
              <g
                key={t.id}
                className={`territory-marker territory-${t.status} ${isSelected ? 'selected' : ''}`}
                data-territory-id={t.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${t.name}, ${translate(`hq:status.${t.status}`)}${
                  t.remainingTimer != null
                    ? `, ${translate('hq:territory.turnsBadge', { turns: t.remainingTimer })}`
                    : ''
                }`}
                onClick={() => onSelectTerritory(t.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelectTerritory(t.id);
                }}
              >
                <circle
                  cx={t.mapPosition.x}
                  cy={t.mapPosition.y}
                  r={territoryHitRadius}
                  fill="transparent"
                  className="territory-hit-area"
                />

                {/* Pulse effect for available territories */}
                {t.status === 'available' && (
                  <circle
                    cx={t.mapPosition.x}
                    cy={t.mapPosition.y}
                    r="2.5"
                    fill="none"
                    stroke={color}
                    strokeWidth="0.2"
                    opacity="0.4"
                    className="pulse-ring"
                  />
                )}

                {isSelected && (
                  <>
                    <circle
                      cx={t.mapPosition.x}
                      cy={t.mapPosition.y}
                      r="3.1"
                      fill="none"
                      stroke="#f8d56b"
                      strokeWidth="0.22"
                      className="selected-front-ring"
                    />
                    <circle
                      cx={t.mapPosition.x}
                      cy={t.mapPosition.y}
                      r="4"
                      fill="none"
                      stroke="#f8d56b"
                      strokeWidth="0.12"
                      opacity="0.38"
                    />
                  </>
                )}

                {/* Main marker */}
                <circle
                  cx={t.mapPosition.x}
                  cy={t.mapPosition.y}
                  r={isSelected ? 2 : 1.5}
                  fill={markerFill}
                  stroke={markerStroke}
                  strokeWidth={isSelected ? 0.4 : 0.2}
                  filter={t.status === 'available' ? 'url(#glow)' : undefined}
                  className="territory-node"
                  style={{ cursor: 'pointer' }}
                />
                {t.status === 'bypassed' && (
                  <line
                    x1={t.mapPosition.x - 1.25}
                    y1={t.mapPosition.y + 1.25}
                    x2={t.mapPosition.x + 1.25}
                    y2={t.mapPosition.y - 1.25}
                    className="bypassed-slash"
                  />
                )}

                {/* Timer badge */}
                {t.remainingTimer != null && t.status === 'available' && (
                  <g>
                    <circle cx={t.mapPosition.x + 2} cy={t.mapPosition.y - 2} r="1" fill="#ef4444" />
                    <text x={t.mapPosition.x + 2} y={t.mapPosition.y - 1.5} className="timer-text">
                      {t.remainingTimer}
                    </text>
                  </g>
                )}

                {/* Territory name */}
                <text
                  x={t.mapPosition.x > 92 ? 99 : t.mapPosition.x}
                  dx={t.id === 'sector-blacksea' ? 2 : undefined}
                  y={t.mapPosition.y + 3.5}
                  className={`territory-name ${t.status} ${t.mapPosition.x > 92 ? 'map-edge-label' : ''}`}
                >
                  {mapLabelForTerritory(t.id)}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="map-status-strip">
          <span><b>{statusCounts.available}</b> {translate('hq:map.activeFronts')}</span>
          <span><b>{statusCounts.cleared + statusCounts.resolved}</b> {translate('hq:map.secured')}</span>
          <span><b>{statusCounts.locked}</b> {translate('hq:map.locked')}</span>
          <strong>{urgentTerritory ? translate('hq:map.timedCrisis', { territory: urgentTerritory.name, turns: urgentTerritory.remainingTimer }) : translate('hq:map.noTimedCrisis')}</strong>
        </div>

        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-item"><span className="legend-dot cleared"></span> {translate('hq:status.cleared')}</div>
          <div className="legend-item"><span className="legend-dot available"></span> {translate('hq:status.available')}</div>
          <div className="legend-item"><span className="legend-dot locked"></span> {translate('hq:status.locked')}</div>
          <div className="legend-item"><span className="legend-dot failed"></span> {translate('hq:status.failed')}</div>
          <div className="legend-item"><span className="legend-dot resolved"></span> {translate('hq:status.resolved')}</div>
          <div className="legend-item"><span className="legend-dot bypassed"></span> {translate('hq:status.bypassed')}</div>
        </div>
      </div>

      {/* Side panel - territory info */}
      <div className="territory-info-panel">
        {rapidResponseOperations.length > 0 && (
          <section className="rapid-response-operations" aria-label={translate('hq:territory.rapidResponse')}>
            <header>
              <span>{translate('hq:territory.rapidResponse')}</span>
              <b>{rapidResponseOperations.length}</b>
            </header>
            <div className="rapid-response-list">
              {rapidResponseOperations.map((territory) => (
                <button
                  type="button"
                  className="rapid-response-operation"
                  aria-pressed={selectedTerritory === territory.id}
                  key={territory.id}
                  onClick={() => onSelectTerritory(territory.id)}
                >
                  <span>{territory.name}</span>
                  <small>{territory.remainingTimer != null
                    ? translate('hq:territory.turnsBadge', { turns: territory.remainingTimer })
                    : translate('hq:status.available')}</small>
                </button>
              ))}
            </div>
          </section>
        )}
        {selected ? (
          <>
            {selected.act === 2 && (
              <div className="territory-act-banner" data-act="2">
                <span>{translate('hq:territory.actLabel', { act: 'II' })}</span>
                <b>{translate('hq:territory.actTwoTitle')}</b>
              </div>
            )}
            <h2>{selected.name}</h2>
            <div className="territory-region">{selected.region ? regionLabel(selected.region, translate) : null}</div>
            <div className="territory-difficulty">
              {translate('hq:territory.difficulty')}: <span className="stars">{getDifficultyStars(selected.difficulty)}</span>
            </div>
            <div className="territory-metrics">
              <span><b>{translate(`hq:status.${selected.status}`).toUpperCase()}</b>{translate('hq:territory.status')}</span>
              <span><b>{selected.remainingTimer ?? '-'}</b>{translate('hq:territory.turns')}</span>
              <span><b>{selected.difficulty ?? 1}/5</b>{translate('hq:territory.risk')}</span>
            </div>
            <div className="territory-intel">
              <span><b>{translate('hq:territory.entry')}</b>{selected.status === 'locked' ? translate('hq:territory.entryBlocked') : selected.status === 'available' ? translate('hq:territory.entryOpen') : translate('hq:territory.entryClosed')}</span>
              <span><b>{translate('hq:territory.pressure')}</b>{selected.remainingTimer != null ? translate('hq:territory.turnClock', { turns: selected.remainingTimer }) : translate('hq:territory.noActiveTimer')}</span>
              <span><b>{translate('hq:territory.chain')}</b>{
                selected.requires?.length
                  ? translate('hq:territory.prerequisiteCount', { count: selected.requires.length })
                  : selected.requiresAny?.length
                    ? translate('hq:territory.prerequisiteAnyCount', { count: selected.requiresAny.length })
                    : translate('hq:territory.frontlineSector')
              }</span>
            </div>
            <p className="territory-brief">{selected.brief}</p>

            <div className="territory-status-badge" data-status={selected.status}>
              {translate(`hq:status.${selected.status}`).toUpperCase()}
              {selected.remainingTimer != null && ` • ${translate('hq:territory.turnsBadge', { turns: selected.remainingTimer })}`}
            </div>

            {selectedRequirements.length > 0 && selected.status === 'locked' && (
              <div className="territory-requires">
                <strong>{translate(selected.requiresAny?.length ? 'hq:territory.requiresAny' : 'hq:territory.requires')}</strong>
                <ul>
                  {selectedRequirements.map(reqId => {
                    const req = territories.find(t => t.id === reqId);
                    const done = requirementComplete(req);
                    return (
                      <li key={reqId} className={done ? 'done' : ''}>
                        {req?.name || reqId} {done && '✓'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {selected.status === 'available' && (
              <button
                className="attack-btn-large"
                disabled={!operationAvailable}
                title={!operationAvailable ? translate('hq:territory.operationCommittedHint') : undefined}
                onClick={() => onStartBattle(selected.id)}
              >
                ⚔ {translate(operationAvailable ? 'hq:territory.launchAttack' : 'hq:territory.operationCommitted')}
              </button>
            )}

            {(selected.status === 'cleared' || selected.status === 'resolved') && (
              <div className="territory-reward-earned">
                <span className="checkmark">✓</span> {translate(
                  selected.status === 'cleared' ? 'hq:territory.sectorSecured' : 'hq:territory.operationResolved'
                )}
              </div>
            )}
          </>
        ) : (
          <div className="no-selection">
            <p>{translate('hq:map.selectTerritoryHint')}</p>
            <div className="quick-stats">
              <div>{translate('hq:status.cleared')}: {mapTerritories.filter(t => t.status === 'cleared').length}</div>
              <div>{translate('hq:status.available')}: {mapTerritories.filter(t => t.status === 'available').length}</div>
              <div>{translate('hq:map.remaining')}: {mapTerritories.filter(t => t.status === 'locked').length}</div>
            </div>
            <div className="front-intel-grid">
              <span><b>{translate('hq:map.primaryThreat')}</b>{urgentTerritory?.name ?? translate('hq:map.noTimedCrisis')}</span>
              <span><b>{translate('hq:map.nextLock')}</b>{nextLockedTerritory?.name ?? translate('hq:map.allRoutesOpen')}</span>
              <span><b>{translate('hq:map.readiness')}</b>{statusCounts.available} {translate('hq:map.activeFronts')}</span>
            </div>
          </div>
        )}

        {/* Operations log */}
        <div className="mini-log">
          <h4>{translate('hq:map.recentEvents')}</h4>
          {log.slice(-4).map((entry, idx) => (
            <div key={idx} className="log-entry">{formatCampaignLogEntry(entry, translate)}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const StrategicHQ: React.FC<StrategicHQProps> = ({
  campaignDifficulty, turn, operationAvailable, warClock, money, research, strategic,
  army, reserves, formations, officers, territories, operationPlans, operationDossiers, researchTopics, currentResearch, pausedResearch, completedResearch,
  log, onStartBattle, onEndTurn, onRecruit, onRefill, onRearm, onSetEquipment, onSetFormation,
  onRecruitOfficer, onPromoteOfficer, onAssignOfficer, onDismiss,
  onResearch, onPauseResearch, onConvertMoney, onConvertResearch, onBack, popups, onDismissPopups, availableUnits
}) => {
  const { t } = useTranslation(['hq', 'common', 'campaign']);
  const [activeTab, setActiveTab] = useState<'map' | 'army' | 'research'>('map');
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const [recruitFilter, setRecruitFilter] = useState<RecruitFilter>('all');
  const [planningTerritoryId, setPlanningTerritoryId] = useState<string | null>(null);
  const [selectedDeploymentIds, setSelectedDeploymentIds] = useState<string[]>([]);
  const [serviceUnitId, setServiceUnitId] = useState<string | null>(null);
  const [equipmentCategory, setEquipmentCategory] = useState<EquipmentCategory>('offense');
  const activeDialogRef = useRef<HTMLElement>(null);
  const modalTriggerRef = useRef<HTMLElement | null>(null);
  const activeModal: HQModal | null = planningTerritoryId ? 'planner' : serviceUnitId ? 'service' : null;

  useEffect(() => {
    if (!activeModal) return;
    const dialog = activeDialogRef.current;
    if (!dialog) return;

    const focusableControls = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(HQ_MODAL_FOCUSABLE_SELECTOR),
    );
    focusableControls()[0]?.focus();

    const handleModalKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeModal === 'planner') setPlanningTerritoryId(null);
        else setServiceUnitId(null);
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = focusableControls();
      const firstControl = controls[0];
      const lastControl = controls.at(-1);
      if (!firstControl || !lastControl) return;

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstControl || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastControl.focus();
      } else if (!event.shiftKey && (activeElement === lastControl || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstControl.focus();
      }
    };
    window.addEventListener('keydown', handleModalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleModalKeyDown);
      if (modalTriggerRef.current?.isConnected) modalTriggerRef.current.focus();
      modalTriggerRef.current = null;
    };
  }, [activeModal]);

  const switchTab = (tab: 'map' | 'army' | 'research') => {
    clearToasts();
    setActiveTab(tab);
  };
  const formationName = (formation: FormationSummary) => t(`army.formationName.${formation.id}`, {
    defaultValue: formation.name
  });
  const openDeploymentPlanner = (territoryId: string) => {
    const plan = operationPlans[territoryId];
    if (!plan) return;
    modalTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    AudioManager.play('briefing');
    setSelectedDeploymentIds(defaultDeploymentSelection(plan));
    setPlanningTerritoryId(territoryId);
  };
  const openUnitService = (unitId: string, trigger: HTMLButtonElement) => {
    modalTriggerRef.current = trigger;
    setServiceUnitId(unitId);
  };
  const applyFormationToDeployment = (formation: FormationSummary) => {
    if (!planningTerritoryId) return;
    const plan = operationPlans[planningTerritoryId];
    const allowed = new Set(plan.availableUnitIds);
    const chosen = new Set(plan.requiredUnitIds);
    for (const unitId of formation.units) {
      if (allowed.has(unitId) && chosen.size < plan.capacity) chosen.add(unitId);
    }
    setSelectedDeploymentIds(Array.from(chosen));
  };
  const toggleDeploymentUnit = (unitId: string) => {
    if (!planningTerritoryId) return;
    const plan = operationPlans[planningTerritoryId];
    if (plan.requiredUnitIds.includes(unitId)) return;
    setSelectedDeploymentIds((current) => {
      if (current.includes(unitId)) return current.filter((id) => id !== unitId);
      if (current.length >= plan.capacity) return current;
      return [...current, unitId];
    });
  };
  const researchById = useMemo(
    () => new Map(researchTopics.map((topic) => [topic.id, topic])),
    [researchTopics]
  );
  const researchDepths = useMemo(() => {
    const depths = new Map<string, number>();
    const visit = (topic: ResearchTopic, trail = new Set<string>()): number => {
      const cached = depths.get(topic.id);
      if (cached != null) return cached;
      if (trail.has(topic.id)) return 0;
      const nextTrail = new Set(trail);
      nextTrail.add(topic.id);
      const prerequisites = topic.requires ?? [];
      const depth = prerequisites.length === 0
        ? 0
        : Math.max(...prerequisites.map((id) => {
            const requiredTopic = researchById.get(id);
            return requiredTopic ? visit(requiredTopic, nextTrail) + 1 : 0;
          }));
      depths.set(topic.id, depth);
      return depth;
    };
    researchTopics.forEach((topic) => visit(topic));
    return depths;
  }, [researchById, researchTopics]);
  const researchColumns = useMemo(() => {
    const columns: ResearchTopic[][] = [];
    for (const topic of researchTopics) {
      const depth = researchDepths.get(topic.id) ?? 0;
      columns[depth] ??= [];
      columns[depth].push(topic);
    }
    return columns;
  }, [researchDepths, researchTopics]);
  const activeResearchTopic = currentResearch ? researchById.get(currentResearch.topicId) : undefined;
  const activeResearchProgress = activeResearchTopic && currentResearch
    ? Math.max(0, Math.min(100, Math.round(((activeResearchTopic.cost - currentResearch.remaining) / activeResearchTopic.cost) * 100)))
    : 0;
  const visibleReports = popups?.slice(-3) ?? [];
  const archivedReportCount = Math.max(0, (popups?.length ?? 0) - visibleReports.length);
  const latestOutcomeReport = [...(popups ?? [])].reverse().find((popup) => popup.kind === 'loss' || popup.kind === 'reward');
  const armyByType = useMemo(() => (
    army.reduce<Record<string, number>>((acc, unit) => {
      acc[unit.unitType] = (acc[unit.unitType] ?? 0) + 1;
      return acc;
    }, {})
  ), [army]);
  const armySections = useMemo(() => {
    const sections = ['command', 'infantry', 'recon', 'vehicles', 'support'].map((section) => ({
      section,
      units: [] as ArmyUnit[]
    }));
    const bySection = new Map(sections.map((section) => [section.section, section.units]));
    army.forEach((unit) => {
      const units = bySection.get(armySectionKey(unit)) ?? bySection.get('infantry');
      units?.push(unit);
    });
    return sections.filter((section) => section.units.length > 0);
  }, [army]);
  const unitOccurrences = useMemo(() => {
    const totals = new Map<string, number>();
    const indexes = new Map<string, number>();
    const occurrences = new Map<string, { index: number; count: number }>();
    army.forEach((unit) => totals.set(unit.definitionId, (totals.get(unit.definitionId) ?? 0) + 1));
    army.forEach((unit) => {
      const index = (indexes.get(unit.definitionId) ?? 0) + 1;
      indexes.set(unit.definitionId, index);
      occurrences.set(unit.id, { index, count: totals.get(unit.definitionId) ?? 1 });
    });
    return occurrences;
  }, [army]);
  const planningTerritory = planningTerritoryId
    ? territories.find((territory) => territory.id === planningTerritoryId)
    : undefined;
  const planningPlan = planningTerritoryId ? operationPlans[planningTerritoryId] : undefined;
  const planningDossier = planningTerritoryId ? operationDossiers[planningTerritoryId] : undefined;
  const planningUnits = planningPlan
    ? planningPlan.availableUnitIds.flatMap((unitId) => {
        const unit = army.find((candidate) => candidate.id === unitId);
        return unit ? [unit] : [];
      })
    : [];
  const automaticSupportUnits = planningPlan
    ? planningPlan.automaticSupportDefinitionIds.flatMap((definitionId) => {
        const unit = availableUnits.find((candidate) => candidate.id === definitionId);
        return unit ? [unit] : [];
      })
    : [];
  const missionSupportUnits = planningPlan
    ? planningPlan.missionSupport.flatMap((support) => {
        const unit = availableUnits.find((candidate) => candidate.id === support.definitionId);
        return unit ? [{ ...support, unit }] : [];
      })
    : [];
  const unavailableRequiredUnits = planningPlan
    ? planningPlan.unavailableRequiredUnitIds.flatMap((unitId) => {
        const unit = army.find((candidate) => candidate.id === unitId);
        return unit ? [unit] : [];
      })
    : [];
  const deploymentCanConfirm = Boolean(planningPlan)
    && unavailableRequiredUnits.length === 0
    && selectedDeploymentIds.length <= (planningPlan?.capacity ?? 0)
    && (selectedDeploymentIds.length > 0 || Boolean(planningPlan?.canDeployWithoutRoster));
  const inactiveCommandFormations = planningPlan
    ? formations.filter((formation) => (
        formation.assignedUnitId
        && !selectedDeploymentIds.includes(formation.assignedUnitId)
        && formation.units.some((unitId) => selectedDeploymentIds.includes(unitId))
      ))
    : [];
  const serviceUnit = serviceUnitId ? army.find((unit) => unit.id === serviceUnitId) : undefined;
  const activeEquipmentOptions = serviceUnit?.equipmentOptions.filter(
    (option) => option.category === equipmentCategory
  ) ?? [];
  const forceFocusUnit = army.find((unit) => armySectionKey(unit) === 'command')
    ?? army.find((unit) => armySectionKey(unit) === 'vehicles')
    ?? army[0];
  const forceFocusHealth = forceFocusUnit
    ? Math.max(0, Math.min(100, Math.round((forceFocusUnit.currentHealth / forceFocusUnit.maxHealth) * 100)))
    : 0;
  const woundedUnits = army.filter((unit) => unit.currentHealth < unit.maxHealth).length;
  const readyResearchCount = researchTopics.filter((topic) => {
    if (completedResearch.has(topic.id)) return false;
    return (topic.requires ?? []).every((id) => completedResearch.has(id));
  }).length;
  const recommendedResearchId = useMemo(() => (
    researchTopics.find((topic) => {
      if (completedResearch.has(topic.id)) return false;
      if (currentResearch?.topicId === topic.id) return false;
      return (topic.requires ?? []).every((id) => completedResearch.has(id));
    })?.id
  ), [completedResearch, currentResearch, researchTopics]);
  const focusResearchTopic = activeResearchTopic
    ?? (recommendedResearchId ? researchById.get(recommendedResearchId) : undefined)
    ?? researchTopics.find((topic) => !completedResearch.has(topic.id))
    ?? researchTopics[0];
  const focusResearchBranch = focusResearchTopic ? researchBranch(focusResearchTopic) : 'doctrine';
  const focusResearchUnlocks = focusResearchTopic?.unlocks?.length
    ? focusResearchTopic.unlocks.map((id) => i18n.t(`units:${id}.name`, { defaultValue: id })).join(' / ')
    : t('research.forceMultiplier');
  const focusResearchRequires = focusResearchTopic?.requires?.length
    ? focusResearchTopic.requires.map((id) => researchById.get(id)?.name ?? id).join(' / ')
    : t('research.baselineDoctrine');
  const focusResearchPathIds = useMemo(() => {
    const pathIds = new Set<string>();
    const collect = (topic?: ResearchTopic) => {
      if (!topic || pathIds.has(topic.id)) return;
      pathIds.add(topic.id);
      (topic.requires ?? []).forEach((id) => collect(researchById.get(id)));
    };
    collect(focusResearchTopic);
    return pathIds;
  }, [focusResearchTopic, researchById]);
  React.useEffect(() => {
    if (selectedTerritory && territories.some((territory) => territory.id === selectedTerritory)) return;
    const defaultTerritory = territories.find((territory) => territory.status === 'available')
      ?? territories.find((territory) => territory.status === 'failed')
      ?? territories.find((territory) => territory.status === 'locked');
    setSelectedTerritory(defaultTerritory?.id ?? null);
  }, [selectedTerritory, territories]);

  // Quieter HQ ambience bed while planning between battles.
  React.useEffect(() => {
    AudioManager.startAmbience('hq');
    return () => AudioManager.stopAmbience();
  }, []);
  const activeTabStyle: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.05)',
    borderBottomColor: 'var(--accent)',
    color: 'var(--accent)'
  };
  const inactiveTabStyle: React.CSSProperties = {
    background: 'transparent',
    borderBottomColor: 'transparent',
    color: 'var(--text-dim)'
  };

  return (
    <div className="strategic-hq">
      {/* Top status bar */}
      <div className="hq-topbar">
        <div className="hq-title">
          <button className="back-btn" onClick={onBack}>◀ {t('topbar.menu')}</button>
          <h1>{t('topbar.fieldHq')}</h1>
          <span className="turn-info">
            {t('topbar.turnClock', { turn, warClock })}
            <b className={`campaign-difficulty ${campaignDifficulty}`}>{t(`topbar.difficulty.${campaignDifficulty}`)}</b>
          </span>
        </div>
        <div className="hq-resources">
          <div className="resource">
            <span className="resource-icon">CR</span>
            <span className="resource-value">{Math.round(money)}</span>
            <span className="resource-label">{t('topbar.credits')}</span>
          </div>
          <div className="resource">
            <span className="resource-icon">RP</span>
            <span className="resource-value">{Math.round(research)}</span>
            <span className="resource-label">{t('topbar.research')}</span>
          </div>
          <div className="resource">
            <span className="resource-icon">SP</span>
            <span className="resource-value">{Math.round(strategic)}</span>
            <span className="resource-label">SP</span>
          </div>
        </div>
        <button className="end-turn-btn" onClick={onEndTurn}>
          {t('topbar.endTurn')} ▶
        </button>
      </div>

      {/* Tab navigation */}
      <div className="hq-tabs">
        <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} data-active={activeTab === 'map'} style={activeTab === 'map' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('map')}>
          <span className="tab-code">OPS</span>
          <span>{t('topbar.territories')}</span>
        </button>
        <button className={`tab ${activeTab === 'army' ? 'active' : ''}`} data-active={activeTab === 'army'} style={activeTab === 'army' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('army')}>
          <span className="tab-code">TOE</span>
          <span>{t('topbar.armyCount', { count: army.length })}</span>
        </button>
        <button className={`tab ${activeTab === 'research' ? 'active' : ''}`} data-active={activeTab === 'research'} style={activeTab === 'research' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('research')}>
          <span className="tab-code">R&amp;D</span>
          <span>{t('topbar.research')}</span>
        </button>
      </div>

      {/* Content area */}
      <div className="hq-content">
        {latestOutcomeReport && (
          <section className={`hq-outcome hq-outcome-${latestOutcomeReport.kind}`} aria-label={t('outcome.latestOutcomeAriaLabel')}>
            <div className="hq-outcome-code">{latestOutcomeReport.kind === 'loss' ? t('outcome.redStatus') : t('outcome.secured')}</div>
            <div>
              <span>{t('outcome.operationResult')}</span>
              <h2>{popupTitle(latestOutcomeReport, t)}</h2>
              <p>{popupBody(latestOutcomeReport, t)}</p>
            </div>
            <div className="hq-outcome-actions">
              <b>{latestOutcomeReport.kind === 'loss' ? t('outcome.unitsReady', { count: army.length }) : `${Math.round(money)} CR`}</b>
              <small>{latestOutcomeReport.kind === 'loss' ? t('outcome.openArmyHint') : t('outcome.rewardsPostedHint')}</small>
              {onDismissPopups && (
                <button onClick={onDismissPopups}>{t('outcome.acknowledge')}</button>
              )}
            </div>
          </section>
        )}

        {visibleReports.length > 0 && (
          <div className="hq-alerts" role="region" aria-live="polite" aria-label={t('outcome.operationReportsAriaLabel')}>
            <div className="hq-alerts-header">
              <span>{t('outcome.operationReports')}</span>
              <b>{popups?.length ?? visibleReports.length}</b>
            </div>
            <div className="hq-alert-list">
              {visibleReports.map((popup, index) => (
                <div key={`${popup.key}-${index}`} className={`hq-alert hq-alert-${popup.kind}`}>
                  <strong>{popupTitle(popup, t)}</strong>
                  <span>{popupBody(popup, t)}</span>
                </div>
              ))}
            </div>
            {archivedReportCount > 0 && (
              <small className="hq-alert-archive">{t('outcome.earlierReports', { count: archivedReportCount })}</small>
            )}
            {onDismissPopups && (
              <button className="dismiss-alerts" onClick={onDismissPopups}>{t('outcome.clearReports')}</button>
            )}
          </div>
        )}

        {activeTab === 'map' && (
          <StrategicMapView
            territories={territories}
            selectedTerritory={selectedTerritory}
            onSelectTerritory={setSelectedTerritory}
            onStartBattle={openDeploymentPlanner}
            log={log}
            operationAvailable={operationAvailable}
          />
        )}

        {activeTab === 'army' && (
          <div className="army-view">
            <div className="army-roster">
              <div className="view-heading">
                <div>
                  <span>{t('army.forceRoster')}</span>
                  <h3>{t('army.yourForces')}</h3>
                </div>
                <div className="army-kpis">
                  <span><b>{army.length}</b> {t('army.ready')}</span>
                  <span><b>{reserves.length}</b> {t('army.transit')}</span>
                  <span><b>{woundedUnits}</b> {t('army.damaged')}</span>
                </div>
              </div>
              {army.length > 0 && (
                <div className="army-type-strip">
                  {Object.entries(armyByType).map(([type, count]) => (
                    <span key={type}><b>{count}</b>{t(`common:unitType.${type}`)}</span>
                  ))}
                </div>
              )}
              <section className="formation-command" aria-label={t('army.formations')}>
                <div className="formation-command-heading">
                  <div>
                    <span>{t('army.taskGroups')}</span>
                    <h4>{t('army.formations')}</h4>
                  </div>
                  <small>{t('army.formationHint')}</small>
                </div>
                <div className="formation-cards">
                  {formations.map((formation) => (
                    <article
                      key={formation.id}
                      className={`formation-card formation-card-${formation.id} ${formation.overstrength ? 'formation-overstrength' : ''}`}
                    >
                      <span>{formation.id.toUpperCase()}</span>
                      <b>{formationName(formation)}</b>
                      <small>{t('army.formationStrength', {
                        members: formation.units.length,
                        capacity: formation.capacity
                      })}</small>
                      <p className="formation-command-line">
                        {formation.officerName
                          ? t('army.formationLedBy', {
                              officer: formation.officerName,
                              rank: formation.officerRankName
                            })
                          : t('army.formationUnled')}
                      </p>
                      <div>
                        <i>{t('army.bonusAttack', { value: signedCommandValue(formation.bonus.attack) })}</i>
                        <i>{t('army.bonusDefense', { value: signedCommandValue(formation.bonus.defense) })}</i>
                        <i>{t('army.bonusMorale', { value: signedCommandValue(formation.bonus.morale) })}</i>
                      </div>
                      {formation.overstrength && (
                        <em className="formation-alert">{t('army.formationOverstrength')}</em>
                      )}
                      {formation.shockMoralePenalty > 0 && (
                        <em className="formation-shock">
                          {t('army.commandShock', {
                            penalty: formation.shockMoralePenalty,
                            turn: (formation.commandShockUntilTurn ?? turn + 1) - 1
                          })}
                        </em>
                      )}
                    </article>
                  ))}
                </div>
                <div className="officer-corps-heading">
                  <div>
                    <span>{t('army.officerDesk')}</span>
                    <h4>{t('army.officerCorps')}</h4>
                  </div>
                  <small>{t('army.officerCorpsHint')}</small>
                </div>
                <div className="officer-grid">
                  {officers.map((officer, index) => {
                    const carrierOptions = army.filter((unit) => {
                      if (unit.unitType === 'hero' || !unit.formationId) return false;
                      const formation = formations.find((candidate) => candidate.id === unit.formationId);
                      const carrierOccupied = officers.some((candidate) => (
                        candidate.id !== officer.id
                        && candidate.status === 'active'
                        && candidate.assignedUnitId === unit.id
                      ));
                      return !carrierOccupied && (!formation?.officerId || formation.officerId === officer.id);
                    });
                    return (
                      <article
                        key={officer.profileId}
                        className={`officer-card officer-${officer.status}`}
                        style={{ '--officer-index': index } as React.CSSProperties}
                      >
                        <header>
                          <span className="officer-portrait" aria-hidden="true">
                            <b>{officerInitials(officer.name)}</b>
                            <i />
                          </span>
                          <span className="officer-identity">
                            <small>{officer.callsign}</small>
                            <strong>{officer.name}</strong>
                            <em>{officer.status === 'available'
                              ? t('army.officerCandidate')
                              : officer.status === 'fallen'
                                ? t('army.officerFallen')
                                : officer.rankName}</em>
                          </span>
                          <span className={`officer-status officer-status-${officer.status}`}>
                            {t(`army.officerStatus.${officer.status}`)}
                          </span>
                        </header>
                        <p>{officer.description}</p>
                        <div className="officer-aura" aria-label={t('army.officerAura')}>
                          <i>{t('army.bonusAttack', { value: signedCommandValue(officer.bonus.attack) })}</i>
                          <i>{t('army.bonusDefense', { value: signedCommandValue(officer.bonus.defense) })}</i>
                          <i>{t('army.bonusMorale', { value: signedCommandValue(officer.bonus.morale) })}</i>
                        </div>
                        {officer.status === 'available' && (
                          <button
                            className="officer-recruit"
                            aria-label={t(officer.canRecruit ? 'army.recruitOfficerFor' : 'army.recruitOfficerShortFor', {
                              officer: officer.name,
                              cost: officer.recruitCost
                            })}
                            disabled={!officer.canRecruit}
                            onClick={() => onRecruitOfficer(officer.profileId)}
                          >
                            {officer.canRecruit
                              ? t('army.recruitOfficer', { cost: officer.recruitCost })
                              : t('army.recruitOfficerShort', { cost: officer.recruitCost })}
                          </button>
                        )}
                        {officer.status === 'fallen' && (
                          <div className="officer-memorial">
                            <b>{t('army.memorialRoll')}</b>
                            <small>{t('army.memorialHint')}</small>
                          </div>
                        )}
                        {officer.status === 'active' && (
                          <div className="officer-service">
                            <div className="officer-service-line">
                              <span>{t('army.serviceMarks', { count: officer.service })}</span>
                              <b>{t('army.commandCapacity', { capacity: officer.capacity })}</b>
                            </div>
                            <label>
                              <span>{t('army.carrierUnit')}</span>
                              <select
                                aria-label={t('army.assignOfficerCarrier', { officer: officer.name })}
                                value={officer.assignedUnitId ?? ''}
                                onChange={(event) => onAssignOfficer(officer.id, event.target.value || undefined)}
                              >
                                <option value="">{t('army.officerUnassigned')}</option>
                                {carrierOptions.map((unit) => {
                                  const formation = formations.find((candidate) => candidate.id === unit.formationId);
                                  return (
                                    <option key={unit.id} value={unit.id}>
                                      {unit.name} · {formation ? formationName(formation) : t('army.unassigned')}
                                    </option>
                                  );
                                })}
                              </select>
                            </label>
                            {officer.nextRank ? (
                              <button
                                className="officer-promote"
                                disabled={!officer.nextRank.ready || !officer.nextRank.canAfford}
                                onClick={() => onPromoteOfficer(officer.id)}
                              >
                                <span>{t('army.promoteTo', { rank: officer.nextRank.name })}</span>
                                <small>
                                  {officer.nextRank.ready
                                    ? t('army.promotionCost', { cost: officer.nextRank.cost })
                                    : t('army.promotionService', {
                                        current: officer.service,
                                        required: officer.nextRank.requiredService
                                      })}
                                  {' · '}
                                  {t('army.commandCapacity', { capacity: officer.nextRank.capacity })}
                                </small>
                              </button>
                            ) : (
                              <span className="officer-max-rank">{t('army.maximumRank')}</span>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
              {forceFocusUnit && (
                <section className={`force-focus force-focus-${armySectionKey(forceFocusUnit)}`}>
                  <div className={`roster-token roster-token-${forceFocusUnit.unitType}`}>
                    <img src={rosterPortrait(forceFocusUnit.definitionId, forceFocusUnit.unitType)} alt="" />
                    <span>{forceFocusUnit.name.slice(0, 1)}</span>
                  </div>
                  <div>
                    <span>{t('army.forceAnchor')}</span>
                    <h4>{forceFocusUnit.name}</h4>
                    <p>{armySectionLabel(armySectionKey(forceFocusUnit), t)} · {t(`army.tier.${forceFocusUnit.tier}`)} · {t('army.combatReadyPct', { pct: forceFocusHealth })}</p>
                  </div>
                  <div className="force-focus-meter">
                    <b>{forceFocusUnit.currentHealth}/{forceFocusUnit.maxHealth}</b>
                    <i style={{ '--stat-percent': `${forceFocusHealth}%` } as React.CSSProperties} />
                  </div>
                </section>
              )}
              {army.length === 0 ? (
                <p className="empty-msg">{t('army.noUnitsYet')}</p>
              ) : (
                armySections.map(({ section, units }) => (
                  <section key={section} className={`army-section army-section-${section}`}>
                    <div className="army-section-heading">
                      <span>{armySectionLabel(section, t)}</span>
                      <b>{units.length}</b>
                    </div>
                    {units.map((u) => {
                      const healthPercent = Math.max(0, Math.min(100, Math.round((u.currentHealth / u.maxHealth) * 100)));
                      const readinessKey = healthPercent < 55 ? 'damaged' : u.experience >= 60 ? 'veteran' : 'ready';
                      const occurrence = unitOccurrences.get(u.id);
                      const accessibleUnitName = occurrence && occurrence.count > 1
                        ? t('army.unitOccurrence', {
                            unit: u.name,
                            index: occurrence.index,
                            count: occurrence.count
                          })
                        : u.name;
                      return (
                        <div key={u.id} className={`unit-row unit-row-${u.unitType} unit-row-section-${section} ${healthPercent < 70 ? 'unit-row-damaged' : ''}`}>
                          <div className={`roster-token roster-token-${u.unitType}`}>
                            <img src={rosterPortrait(u.definitionId, u.unitType)} alt="" />
                            <span>{u.name.slice(0, 1)}</span>
                          </div>
                          <div className="unit-info">
                            <span className="unit-name">{u.name}</span>
                            <span className="unit-tier">{t(`army.tier.${u.tier}`)} · {t(`common:unitType.${u.unitType}`)}</span>
                          </div>
                          <div className="unit-stats">
                            <span className="stat-with-bar">
                              <b>HP</b> {u.currentHealth}/{u.maxHealth}
                              <i style={{ '--stat-percent': `${healthPercent}%` } as React.CSSProperties} />
                            </span>
                            <span><b>{t('army.level')}</b> {u.level} · <b>XP</b> {u.experience}</span>
                            <span className={`readiness-chip readiness-${readinessKey}`}><b>{t(`army.readiness.${readinessKey}`)}</b>{t(`common:unitType.${u.unitType}`)}</span>
                          </div>
                          <div className="unit-actions">
                            <label className="formation-assignment">
                              <span>{t('army.formation')}</span>
                              <select
                                aria-label={t('army.assignFormationFor', { unit: accessibleUnitName })}
                                value={u.formationId ?? ''}
                                onChange={(event) => onSetFormation(u.id, event.target.value || undefined)}
                              >
                                <option value="">{t('army.unassigned')}</option>
                                {formations.map((formation) => (
                                  <option
                                    key={formation.id}
                                    value={formation.id}
                                    disabled={u.formationId !== formation.id && formation.units.length >= formation.capacity}
                                  >
                                    {formationName(formation)} · {formation.units.length}/{formation.capacity}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="unit-service-btn"
                              aria-label={t('army.serviceUnit', { unit: accessibleUnitName })}
                              onClick={(event) => openUnitService(u.id, event.currentTarget)}
                            >
                              {t('army.service')}
                            </button>
                            {u.unitType !== 'hero' && (
                              <button
                                aria-label={t('army.dismissUnit', { unit: accessibleUnitName })}
                                onClick={() => onDismiss(u.id)}
                              >
                                {t('army.dismiss')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))
              )}
              {reserves.length > 0 && (
                <div className="reserve-roster">
                  <h3>{t('army.inTransit')}</h3>
                  {reserves.map((u) => (
                    <div key={u.id} className="unit-row reserve-row">
                      <div className={`roster-token roster-token-${u.unitType}`}>
                        <img src={rosterPortrait(u.definitionId, u.unitType)} alt="" />
                        <span>{u.name.slice(0, 1)}</span>
                      </div>
                      <div className="unit-info">
                        <span className="unit-name">{u.name}</span>
                        <span className="unit-tier">{t(`army.tier.${u.tier}`)} · {t(`common:unitType.${u.unitType}`)}</span>
                      </div>
                      <div className="unit-stats">
                        <span className="stat-with-bar">
                          <b>HP</b> {u.currentHealth}/{u.maxHealth}
                          <i style={{ '--stat-percent': `${Math.max(0, Math.min(100, Math.round((u.currentHealth / u.maxHealth) * 100)))}%` } as React.CSSProperties} />
                        </span>
                        <span><b>{t('army.readiness.ready')}</b> T{u.availableOnTurn ?? turn + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="recruit-panel">
              <h3>{t('army.recruit')}</h3>
              <div className="recruit-filters" aria-label={t('army.filterLabel')}>
                {recruitFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={recruitFilter === filter}
                    onClick={() => setRecruitFilter(filter)}
                  >
                    {filter === 'all' ? t('army.allTypes') : t(`common:unitType.${filter}`)}
                  </button>
                ))}
              </div>
              <div className="recruit-options">
                {availableUnits.filter((u) => recruitFilter === 'all' || u.unitType === recruitFilter).map((u) => (
                  <button
                    key={u.id}
                    className={`recruit-btn ${!u.canAfford ? 'recruit-btn-short' : ''}`}
                    disabled={!u.canRecruit}
                    onClick={() => {
                      if (u.canRecruit) onRecruit(u.id, 'rookie');
                    }}
                  >
                    <span className="recruit-portrait" aria-hidden="true">
                      <img src={rosterPortrait(u.id, u.unitType)} alt="" loading="lazy" />
                    </span>
                    <span className="recruit-copy">
                      <span>{u.name}</span>
                      <span className="recruit-meta">
                        {!u.unlocked
                          ? `${t('army.locked')}${u.requiredResearch ? ` · ${u.requiredResearch}` : ''}`
                          : u.unitType === 'hero' && u.ownedCount > 0
                            ? t('army.inForce')
                            : u.unitType === 'hero' && u.reserveCount > 0
                              ? t('army.inTransit')
                              : `${u.cost} CR · ${u.canAfford ? t('army.turnPlus2') : t('army.needFunds')}`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="recruit-intel">
                <span>{t('army.forcePlan')}</span>
                <b>{forceFocusUnit ? armySectionLabel(armySectionKey(forceFocusUnit), t) : t('army.reserve')} {t('army.anchor')}</b>
                <p>{t('army.fieldUnitsSummary', { field: army.length, damaged: woundedUnits, transit: reserves.length })}</p>
                <i>{t('army.nextPurchaseHint')}</i>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'research' && (
          <div className="research-view">
            <div className="research-status">
              <div className="research-status-main">
                {currentResearch ? (
                  <div className="active-research">
                    <h3>{t('research.currentlyResearching')}</h3>
                    <div className="research-progress">
                      <span className="research-name">{activeResearchTopic?.name ?? currentResearch.topicId}</span>
                      <span className="research-remaining">{t('research.rpRemaining', { count: currentResearch.remaining })}</span>
                    </div>
                    <div className="research-progress-bar" aria-hidden="true">
                      <i style={{ '--research-progress': `${activeResearchProgress}%` } as React.CSSProperties} />
                    </div>
                    <button className="pause-research-btn" onClick={onPauseResearch}>{t('research.pauseProject')}</button>
                  </div>
                ) : (
                  <div className="no-research">
                    <h3>{t('research.noActiveResearch')}</h3>
                    <p>{t('research.selectTopicHint')}</p>
                  </div>
                )}
              </div>
              <div className="research-kpis">
                <span><b>{Math.round(research)}</b>{t('research.rpBanked')}</span>
                <span><b>{completedResearch.size}</b>{t('research.complete')}</span>
                <span><b>{Object.keys(pausedResearch).length}</b>{t('research.paused')}</span>
                <span><b>{readyResearchCount}</b>{t('research.ready')}</span>
              </div>
            </div>
            <div className="research-tree">
              <div className="research-network-header">
                <h3>{t('research.network')}</h3>
                {focusResearchTopic && (
                  <div className={`research-focus research-focus-${focusResearchBranch}`}>
                    <span>{currentResearch ? t('research.activeProject') : t('research.recommendedNext')}</span>
                    <b>{focusResearchTopic.name}</b>
                    <small>{researchBranchLabel(focusResearchBranch, t)} · {focusResearchTopic.cost} RP</small>
                    <div>
                      <i>{t('research.unlocks')}</i><strong>{focusResearchUnlocks}</strong>
                      <i>{t('research.requires')}</i><strong>{focusResearchRequires}</strong>
                    </div>
                  </div>
                )}
              </div>
              <div
                className="research-tree-board"
                style={{ '--research-columns': researchColumns.length } as React.CSSProperties}
              >
                {researchColumns.map((topics, tierIndex) => (
                  <section key={tierIndex} className={`research-column research-column-tier-${tierIndex + 1}`}>
                    <div className="research-column-header">
                      <span>{t('research.tier', { n: tierIndex + 1 })}</span>
                      <b>{topics.length}</b>
                    </div>
                    {topics.map((topic) => {
                      const missingRequirements = (topic.requires ?? []).filter((id) => !completedResearch.has(id));
                      const requirementNames = (topic.requires ?? []).map((id) => researchById.get(id)?.name ?? id);
                      const isCompleted = completedResearch.has(topic.id);
                      const isActive = currentResearch?.topicId === topic.id;
                      const pausedRemaining = pausedResearch[topic.id];
                      const isPaused = pausedRemaining != null;
                      const isLocked = missingRequirements.length > 0;
                      const isWaiting = Boolean(currentResearch) && !isActive && !isPaused;
                      const isRecommended = topic.id === recommendedResearchId && !isCompleted && !isActive && !isPaused && !isLocked && !isWaiting;
                      const stateKey = isCompleted ? 'done' : isActive ? 'active' : isPaused ? 'paused' : isLocked ? 'locked' : isWaiting ? 'wait' : isRecommended ? 'priority' : 'ready';
                      const branch = researchBranch(topic);
                      const isPathNode = focusResearchPathIds.has(topic.id);
                      return (
                        <div
                          key={topic.id}
                          className={`research-card research-branch-${branch} ${isPathNode ? 'research-path-node' : ''} ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isPaused ? 'paused-node' : ''} ${isLocked ? 'locked-node' : ''} ${isWaiting ? 'waiting-node' : ''} ${isRecommended ? 'recommended-node' : ''} ${!isCompleted && !isActive && !isPaused && !isLocked && !isWaiting ? 'ready-node' : ''}`}
                        >
                          <span className="research-branch-label">{researchBranchLabel(branch, t)}</span>
                          <span className="research-node-index">{topic.id.toUpperCase()}</span>
                          <span className="research-node-state">{t(`research.state.${stateKey}`)}</span>
                          <h4>{topic.name}</h4>
                          <p>{topic.description}</p>
                          <div className="research-requirements">
                            <span>{t('research.req')}</span>
                            <b>{requirementNames.length ? requirementNames.join(' / ') : t('research.baseline')}</b>
                          </div>
                          <div className="research-cost">{t('research.cost', { cost: topic.cost })}</div>
                          {isCompleted ? (
                            <span className="research-done">{t('research.completed')}</span>
                          ) : isActive ? (
                            <span className="research-progress-label">{t('research.inProgress')}</span>
                          ) : isPaused ? (
                            <button
                              className="research-btn research-resume-btn"
                              aria-label={currentResearch
                                ? t('research.pauseCurrentToResumeFor', { project: topic.name, count: pausedRemaining })
                                : t('research.resumeProjectFor', { project: topic.name, count: pausedRemaining })}
                              disabled={!!currentResearch}
                              onClick={() => onResearch(topic.id)}
                            >
                              {currentResearch
                                ? t('research.pauseCurrentToResume', { count: pausedRemaining })
                                : t('research.resumeProject', { count: pausedRemaining })}
                            </button>
                          ) : (
                            <button
                              className="research-btn"
                              aria-label={isLocked
                                ? t('research.lockedProjectBy', {
                                    project: topic.name,
                                    list: missingRequirements.map((id) => researchById.get(id)?.name ?? id).join(' / ')
                                  })
                                : isRecommended
                                  ? t('research.queuePriorityProjectFor', { project: topic.name })
                                  : t('research.queueProjectFor', { project: topic.name })}
                              disabled={!!currentResearch || isLocked}
                              onClick={() => onResearch(topic.id)}
                            >
                              {isLocked ? t('research.lockedBy', { list: missingRequirements.map((id) => researchById.get(id)?.name ?? id).join(' / ') }) : isRecommended ? t('research.queuePriorityProject') : t('research.queueProject')}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>
            <div className="sp-conversion">
              <h3>{t('research.convertPoints')}</h3>
              <div className="conversion-buttons">
                <button onClick={() => onConvertMoney(5)} disabled={strategic < 5}>
                  5 SP → $5
                </button>
                <button onClick={() => onConvertResearch(3)} disabled={strategic < 3}>
                  3 SP → 9 RP
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {planningTerritory && planningPlan && (
        <div className="hq-modal-backdrop" role="presentation">
          <section
            ref={activeDialogRef}
            className="hq-modal deployment-planner"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deployment-planner-title"
          >
            <header className="hq-modal-header">
              <div>
                <span>{t('deployment.operationOrder')}</span>
                <h2 id="deployment-planner-title">{planningTerritory.name}</h2>
                <p>{t('deployment.capacitySummary', {
                  selected: selectedDeploymentIds.length,
                  capacity: planningPlan.capacity,
                  available: planningPlan.availableUnitIds.length
                })}</p>
              </div>
              <button className="hq-modal-close" aria-label={t('deployment.cancel')} onClick={() => setPlanningTerritoryId(null)}>×</button>
            </header>
            {planningDossier && (
              <section className={`operation-dossier operation-dossier-${planningDossier.audioTheme}`}>
                <header>
                  <span>{t('deployment.dossier')}</span>
                  <div>
                    <small>{planningDossier.chapter == null
                      ? planningDossier.chapterTitle
                      : t('deployment.chapter', {
                          number: planningDossier.chapter,
                          title: planningDossier.chapterTitle
                        })}</small>
                    <h3>{planningDossier.codename}</h3>
                  </div>
                </header>
                <div className="operation-dossier-grid">
                  <article>
                    <b>{t('deployment.situation')}</b>
                    <p>{planningDossier.situation}</p>
                  </article>
                  <article>
                    <b>{t('deployment.threat')}</b>
                    <p>{planningDossier.threat}</p>
                  </article>
                  <article>
                    <b>{t('deployment.commandIntent')}</b>
                    <p>{planningDossier.command}</p>
                  </article>
                </div>
              </section>
            )}
            <div className="deployment-toolbar">
              <button onClick={() => {
                setSelectedDeploymentIds(defaultDeploymentSelection(planningPlan));
              }}>{t('deployment.selectReady')}</button>
              <button onClick={() => setSelectedDeploymentIds([...planningPlan.requiredUnitIds])}>{t('deployment.clearOptional')}</button>
              <div className="deployment-formations" aria-label={t('deployment.selectFormation')}>
                {formations.map((formation) => (
                  <button key={formation.id} onClick={() => applyFormationToDeployment(formation)}>
                    {formationName(formation)} <b>{formation.units.length}</b>
                  </button>
                ))}
              </div>
            </div>
            {inactiveCommandFormations.length > 0 && (
              <p className="deployment-command-warning" role="status">
                {t('deployment.leaderBenched', {
                  list: inactiveCommandFormations.map((formation) => formationName(formation)).join(', ')
                })}
              </p>
            )}
            {unavailableRequiredUnits.length ? (
              <p className="deployment-blocker" role="alert">
                {t('deployment.requiredInTransit', { list: unavailableRequiredUnits.map((unit) => unit.name).join(', ') })}
              </p>
            ) : null}
            {selectedDeploymentIds.length > planningPlan.capacity ? (
              <p className="deployment-blocker" role="alert">
                {t('deployment.requiredOverCapacity', {
                  required: selectedDeploymentIds.length,
                  capacity: planningPlan.capacity
                })}
              </p>
            ) : null}
            <div className="deployment-roster">
              {missionSupportUnits.map((support) => (
                <div key={support.id} className="deployment-unit deployment-support selected required">
                  <span className={`roster-token roster-token-${support.unit.unitType}`}>
                    <img src={rosterPortrait(support.definitionId, support.unit.unitType)} alt="" />
                  </span>
                  <span className="deployment-unit-copy">
                    <b>{support.unit.name}</b>
                    <small>{t(`common:unitType.${support.unit.unitType}`)} · {t('deployment.missionAttached')}</small>
                    <i>{support.specialist
                      ? t('deployment.missionSpecialistHint')
                      : t('deployment.missionSupportHint')}</i>
                  </span>
                  <span className="deployment-unit-flags">
                    <em>{support.specialist
                      ? t('deployment.missionSpecialist')
                      : t('deployment.automaticSupport')}</em>
                    <strong>✓</strong>
                  </span>
                </div>
              ))}
              {automaticSupportUnits.map((unit) => (
                <div key={unit.id} className="deployment-unit deployment-support selected required">
                  <span className={`roster-token roster-token-${unit.unitType}`}>
                    <img src={rosterPortrait(unit.id, unit.unitType)} alt="" />
                  </span>
                  <span className="deployment-unit-copy">
                    <b>{unit.name}</b>
                    <small>{t(`common:unitType.${unit.unitType}`)} · {t('deployment.reservedSlot')}</small>
                    <i>{t('deployment.automaticSupportHint')}</i>
                  </span>
                  <span className="deployment-unit-flags">
                    <em>{t('deployment.automaticSupport')}</em>
                    <strong>✓</strong>
                  </span>
                </div>
              ))}
              {planningUnits.map((unit) => {
                const selected = selectedDeploymentIds.includes(unit.id);
                const required = planningPlan.requiredUnitIds.includes(unit.id);
                const specialist = planningPlan.specialistUnitIds.includes(unit.id);
                const healthPercent = Math.round((unit.currentHealth / unit.maxHealth) * 100);
                const formation = formations.find((candidate) => candidate.id === unit.formationId);
                const officerCarrier = formation?.assignedUnitId === unit.id;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    className={`deployment-unit ${selected ? 'selected' : ''} ${required ? 'required' : ''} ${specialist ? 'specialist' : ''}`}
                    aria-pressed={selected}
                    disabled={!selected && selectedDeploymentIds.length >= planningPlan.capacity}
                    onClick={() => toggleDeploymentUnit(unit.id)}
                  >
                    <span className={`roster-token roster-token-${unit.unitType}`}>
                      <img src={rosterPortrait(unit.definitionId, unit.unitType)} alt="" />
                    </span>
                    <span className="deployment-unit-copy">
                      <b>{unit.name}</b>
                      <small>{t(`army.tier.${unit.tier}`)} · {t(`common:unitType.${unit.unitType}`)} · {t('deployment.healthPct', { value: healthPercent })}</small>
                      <i>{formation ? formationName(formation) : t('army.unassigned')}</i>
                    </span>
                    <span className="deployment-unit-flags">
                      {officerCarrier && <em>{t('deployment.formationLeader')}</em>}
                      {required && <em>{t('deployment.required')}</em>}
                      {specialist && <em>{t('deployment.specialist')}</em>}
                      <strong>{selected ? '✓' : '+'}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
            <footer className="hq-modal-footer">
              <div>
                <b>{t('deployment.manifest', { selected: selectedDeploymentIds.length, capacity: planningPlan.capacity })}</b>
                <small>{t('deployment.noSilentOverflow')}</small>
              </div>
              <button className="secondary-btn" onClick={() => setPlanningTerritoryId(null)}>{t('deployment.cancel')}</button>
              <button
                className="primary-btn deployment-confirm"
                disabled={!deploymentCanConfirm}
                onClick={() => {
                  const territoryId = planningTerritory.id;
                  const selectedUnitIds = [...selectedDeploymentIds];
                  setPlanningTerritoryId(null);
                  onStartBattle(territoryId, selectedUnitIds);
                }}
              >
                {t('deployment.confirm')}
              </button>
            </footer>
          </section>
        </div>
      )}
      {serviceUnit && (
        <div className="hq-modal-backdrop" role="presentation">
          <section
            ref={activeDialogRef}
            className="hq-modal unit-service-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unit-service-title"
          >
            <header className="hq-modal-header">
              <div>
                <span>{t('service.workOrder')}</span>
                <h2 id="unit-service-title">{serviceUnit.name}</h2>
                <p>{t('service.currentState', {
                  health: serviceUnit.currentHealth,
                  maxHealth: serviceUnit.maxHealth,
                  experience: serviceUnit.experience,
                  tier: t(`army.tier.${serviceUnit.tier}`)
                })}</p>
              </div>
              <button className="hq-modal-close" aria-label={t('service.close')} onClick={() => setServiceUnitId(null)}>×</button>
            </header>
            <div className="service-body">
              <div className="service-balance"><span>{t('service.availableFunds')}</span><b>{Math.round(money)} CR</b></div>
              <section className="service-section">
                <div className="service-section-heading">
                  <div><span>{t('service.personnel')}</span><h3>{t('service.refillStrength')}</h3></div>
                  <small>{serviceUnit.currentHealth >= serviceUnit.maxHealth ? t('service.fullStrength') : t('service.refillHint')}</small>
                </div>
                <div className="service-options">
                  {(['rookie', 'veteran', 'elite'] as const).map((quality) => {
                    const quote = serviceUnit.refillQuotes[quality];
                    return (
                      <button
                        key={quality}
                        disabled={serviceUnit.currentHealth >= serviceUnit.maxHealth || money < quote.cost}
                        onClick={() => onRefill(serviceUnit.id, quality)}
                      >
                        <span>{t(`army.tier.${quality}`)}</span>
                        <b>{quote.cost} CR</b>
                        <small>{t('service.resultPreview', {
                          experience: quote.experienceAfter,
                          tier: t(`army.tier.${quote.tierAfter}`)
                        })}</small>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="service-section equipment-doctrine">
                <div className="service-section-heading">
                  <div><span>{t('service.equipment')}</span><h3>{t('service.doctrine')}</h3></div>
                  <small>{serviceUnit.equipmentOptions.length ? t('service.doctrineHint') : t('service.doctrineIneligible')}</small>
                </div>
                {serviceUnit.equipmentOptions.length ? (
                  <>
                    <div className="equipment-category-tabs" role="group" aria-label={t('service.categoryLabel')}>
                      {(['offense', 'protection', 'mobility'] as const).map((category) => (
                        <button
                          key={category}
                          type="button"
                          aria-pressed={equipmentCategory === category}
                          onClick={() => setEquipmentCategory(category)}
                        >
                          {t(`service.categories.${category}`)}
                        </button>
                      ))}
                    </div>
                    {activeEquipmentOptions.length > 0 ? (
                      <div className="equipment-option-grid">
                        {activeEquipmentOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`${option.fitted ? 'fitted' : ''} ${!option.unlocked ? 'locked' : ''}`}
                            disabled={!option.unlocked || (!option.fitted && money < option.cost)}
                            onClick={() => onSetEquipment(
                              serviceUnit.id,
                              option.category,
                              option.fitted ? undefined : option.id
                            )}
                          >
                            <span className="equipment-option-heading">
                              <strong>{option.name}</strong>
                              <em>{option.fitted
                                ? t('service.fitted')
                                : option.unlocked
                                  ? t('service.available')
                                  : t('service.requiresResearch', { research: option.requiredResearch })}</em>
                            </span>
                            <small className="equipment-option-description">{option.description}</small>
                            {option.preview.length > 0 && (
                              <span className="equipment-stat-preview">
                                {option.preview.map((row) => (
                                  <span key={`${row.stat}:${row.weaponId ?? 'unit'}`}>
                                    <em>
                                      {t(`service.stats.${row.stat}`)}
                                      {row.weaponId ? ` · ${equipmentWeaponLabel(row.weaponId)}` : ''}
                                    </em>
                                    <b>
                                      {equipmentStatValue(row.before, row.percent)}
                                      {' → '}
                                      {equipmentStatValue(row.after, row.percent)}
                                    </b>
                                  </span>
                                ))}
                              </span>
                            )}
                            <span className="equipment-option-action">
                              <b>{option.fitted ? t('service.remove') : t('service.install')}</b>
                              <em>{option.fitted ? t('service.standardIssue') : `${option.cost} CR`}</em>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="service-empty">{t('service.categoryIneligible')}</p>
                    )}
                  </>
                ) : (
                  <p className="service-empty">{t('service.doctrineIneligible')}</p>
                )}
              </section>
              <section className="service-section">
                <div className="service-section-heading">
                  <div><span>{t('service.conversion')}</span><h3>{t('service.rearm')}</h3></div>
                  <small>{t('service.sameCategoryOnly')}</small>
                </div>
                {serviceUnit.rearmOptions.length ? (
                  <div className="service-options service-rearm-options">
                    {serviceUnit.rearmOptions.map((option) => (
                      <button
                        key={option.definitionId}
                        disabled={money < option.cost}
                        onClick={() => onRearm(serviceUnit.id, option.definitionId)}
                      >
                        <span>{option.name}</span>
                        <b>{option.cost} CR</b>
                        <small>{t('service.resultPreview', {
                          experience: option.experienceAfter,
                          tier: t(`army.tier.${option.tierAfter}`)
                        })}</small>
                        {option.equipmentResetCount > 0 && (
                          <em className="service-reset-warning">
                            {t('service.rearmReset', { count: option.equipmentResetCount })}
                          </em>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="service-empty">{t('service.noRearmOptions')}</p>
                )}
              </section>
            </div>
            <footer className="hq-modal-footer">
              <div><b>{t('service.quoteNotice')}</b><small>{t('service.quoteHint')}</small></div>
              <button className="primary-btn" onClick={() => setServiceUnitId(null)}>{t('service.close')}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
};
