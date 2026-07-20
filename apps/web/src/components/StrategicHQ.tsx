import type { CampaignDifficulty, CampaignState } from '@spellcross/core';
import type { TFunction } from 'i18next';
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { clearToasts } from './Toast.js';
import i18n from '../i18n/index.js';
import { AudioManager } from '../services/AudioManager.js';

interface Territory {
  id: string;
  name: string;
  brief: string;
  status: string;
  remainingTimer?: number;
  mapPosition?: { x: number; y: number };
  requires?: string[];
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
  availableOnTurn?: number;
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
  warClock: number;
  money: number;
  research: number;
  strategic: number;
  army: ArmyUnit[];
  reserves: ArmyUnit[];
  territories: Territory[];
  researchTopics: ResearchTopic[];
  currentResearch: { topicId: string; remaining: number } | null;
  completedResearch: Set<string>;
  log: CampaignState['log'];
  popups?: CampaignState['popups'];
  onStartBattle: (territoryId: string) => void;
  onEndTurn: () => void;
  onRecruit: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRefill: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onDismiss: (unitId: string) => void;
  onResearch: (topicId: string) => void;
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
  }[];
}

function rosterPortrait(definitionId: string, unitType: string) {
  if (definitionId === 'm113' || definitionId.includes('truck')) return '/assets/generated/apc_m113.png';
  if (definitionId.includes('ranger') || definitionId.includes('sniper')) return '/assets/generated/sniper_team.png';
  if (unitType === 'vehicle') return '/assets/generated/tank_m1_abrams.png';
  if (unitType === 'artillery') return '/assets/generated/artillery_mlrs.png';
  return '/assets/generated/infantry_squad.png';
}

function researchBranch(topic: ResearchTopic) {
  const key = `${topic.id} ${topic.name} ${(topic.unlocks ?? []).join(' ')}`.toLowerCase();
  if (key.includes('optics') || key.includes('ranger') || key.includes('sniper')) return 'recon';
  if (key.includes('armor') || key.includes('plating') || key.includes('leopard')) return 'armor';
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
}> = ({ territories, selectedTerritory, onSelectTerritory, onStartBattle, log }) => {
  // Aliased to `translate` (not `t`) — this component uses `t` pervasively as a loop variable name for
  // Territory objects (`territories.map((t) => t.status)` etc.), which would shadow the i18n function.
  const { t: translate } = useTranslation(['hq', 'territories', 'campaign']);
  const selected = territories.find(t => t.id === selectedTerritory);
  const statusCounts = useMemo(() => ({
    cleared: territories.filter((t) => t.status === 'cleared').length,
    available: territories.filter((t) => t.status === 'available').length,
    locked: territories.filter((t) => t.status === 'locked').length,
    failed: territories.filter((t) => t.status === 'failed').length
  }), [territories]);
  const urgentTerritory = useMemo(() => (
    territories
      .filter((t) => t.status === 'available' && t.remainingTimer != null)
      .sort((a, b) => (a.remainingTimer ?? 99) - (b.remainingTimer ?? 99))[0]
  ), [territories]);
  const nextLockedTerritory = useMemo(() => (
    territories.find((t) => t.status === 'locked')
  ), [territories]);

  // Calculate connection lines between territories
  const connections = useMemo(() => {
    const lines: Array<{ from: Territory; to: Territory }> = [];
    for (const t of territories) {
      if (t.requires && t.mapPosition) {
        for (const reqId of t.requires) {
          const req = territories.find(r => r.id === reqId);
          if (req?.mapPosition) {
            lines.push({ from: req, to: t });
          }
        }
      }
    }
    return lines;
  }, [territories]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'cleared': return '#22c55e';
      case 'available': return '#eab308';
      case 'locked': return '#6b7280';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  // Short map-pin label per territory, keyed by the stable id (not the localized display name) — the
  // old version derived this by taking the first word of `name`, which breaks once names are translated
  // (e.g. Slovak "Parížske okolie".split(' ')[0] => "Parížske", not a place name).
  const mapLabelForTerritory = (id: string) => translate(`territories:mapLabel.${id}`, { defaultValue: id.replace(/^sector-/, '') });

  const getDifficultyStars = (diff: number = 1) => '★'.repeat(diff) + '☆'.repeat(5 - diff);

  return (
    <div className="strategic-map-view">
      {/* Main map area */}
      <div className="strategic-map-container">
        <svg viewBox="0 0 100 80" className="strategic-map-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <radialGradient id="mapGradient" cx="85%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#493036" />
              <stop offset="52%" stopColor="#394b39" />
              <stop offset="100%" stopColor="#263946" />
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
          <rect x="0" y="0" width="100" height="80" fill="url(#mapGradient)" />
          <rect x="0" y="0" width="100" height="80" fill="url(#paperGrain)" opacity="0.55" />
          <rect x="0" y="0" width="100" height="80" fill="url(#mapGrid)" opacity="0.42" />
          <path d="M 0,0 L 100,0 L 100,80 L 75,80 C 62,72 53,66 40,63 C 26,60 12,54 0,47 Z" fill="#111d2a" opacity="0.28" />
          <path d="M 52,10 C 60,15 69,15 79,24 C 88,31 92,38 96,50 L 100,80 L 64,80 C 76,69 86,60 91,47 C 96,34 83,22 70,17 C 62,14 56,15 52,10 Z" fill="url(#frontGradient)" />
          <path d="M 12,55 C 24,46 36,48 48,52 C 58,55 67,53 78,46" fill="none" stroke="#273f52" strokeWidth="0.36" opacity="0.45" />
          <path d="M 48,17 C 49,25 52,31 55,39 C 57,45 56,51 52,57" fill="none" stroke="#25394b" strokeWidth="0.28" opacity="0.42" />
          <path d="M 36,28 C 44,31 52,31 59,35 C 67,39 75,38 84,42" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.5" />
          <path d="M 22,44 C 32,48 43,50 52,57" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.42" />
          <path d="M 61,22 C 70,27 79,29 89,35" fill="none" stroke="#5e5037" strokeWidth="0.18" strokeDasharray="0.8,1.2" opacity="0.48" />

          {/* Simplified Europe outline */}
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

          {/* Fixed city anchors make the strategic layer feel less like empty nodes */}
          {[
            ['Paris', 25, 43],
            ['Lyon', 30, 57],
            ['Amsterdam', 31, 29],
            ['Berlin', 49, 34],
            ['Prague', 50, 43],
            ['Vienna', 53, 51],
            ['Warsaw', 61, 38],
            ['Kyiv', 75, 43]
          ].map(([name, x, y]) => (
            <g key={name}>
              <circle cx={x} cy={y} r="0.45" fill="#1b2422" opacity="0.7" />
            </g>
          ))}

          {/* Region labels */}
          <text x="20" y="48" className="region-label">{translate('hq:region.france')}</text>
          <text x="42" y="41" className="region-label">{translate('hq:region.germany')}</text>
          <text x="54" y="57" className="region-label">{translate('hq:region.austria')}</text>
          <text x="69" y="35" className="region-label">{translate('hq:region.poland')}</text>
          <text x="76" y="58" className="region-label">{translate('hq:region.ukraine')}</text>

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
                strokeDasharray={conn.to.status === 'locked' ? '1,1' : 'none'}
                opacity={conn.to.status === 'locked' ? 0.54 : 0.72}
              />
          ))}

          {selected?.mapPosition && (
            <g className="active-front-vector">
              <line
                x1={selected.mapPosition.x}
                y1={selected.mapPosition.y}
                x2="87"
                y2="52"
              />
              <path d={`M ${selected.mapPosition.x + 2.2},${selected.mapPosition.y + 0.4} L ${selected.mapPosition.x + 4.6},${selected.mapPosition.y - 1.2} L ${selected.mapPosition.x + 5.4},${selected.mapPosition.y + 1.4}`} />
            </g>
          )}

          {/* Territory markers */}
          {territories.map(t => {
            if (!t.mapPosition) return null;
            const isSelected = t.id === selectedTerritory;
            const isSeaAnchor = t.id === 'sector-blacksea';
            const color = getStatusColor(t.status);
            const markerFill = t.status === 'locked'
              ? (isSeaAnchor ? '#243745' : '#27272a')
              : color;
            const markerStroke = isSelected
              ? '#ffffff'
              : (t.status === 'locked' && isSeaAnchor ? '#7f95a3' : color);

            return (
              <g
                key={t.id}
                className={`territory-marker territory-${t.status} ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectTerritory(t.id)}
              >
                <circle
                  cx={t.mapPosition.x}
                  cy={t.mapPosition.y}
                  r="3.2"
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
                  x={t.mapPosition.x}
                  y={t.mapPosition.y + 3.5}
                  className={`territory-name ${t.status}`}
                >
                  {mapLabelForTerritory(t.id)}
                </text>
              </g>
            );
          })}

          {/* Invasion arrow from the east */}
          <path
            d="M 88,52 L 94,47 L 94,50 L 97,50 L 97,54 L 94,54 L 94,57 Z"
            fill="#ef4444"
            opacity="0.38"
          />
          <text x="91" y="60" className="invasion-label">{translate('hq:map.invasion')}</text>
        </svg>

        <div className="map-status-strip">
          <span><b>{statusCounts.available}</b> {translate('hq:map.activeFronts')}</span>
          <span><b>{statusCounts.cleared}</b> {translate('hq:map.secured')}</span>
          <span><b>{statusCounts.locked}</b> {translate('hq:map.locked')}</span>
          <strong>{urgentTerritory ? translate('hq:map.timedCrisis', { territory: urgentTerritory.name, turns: urgentTerritory.remainingTimer }) : translate('hq:map.noTimedCrisis')}</strong>
        </div>

        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-item"><span className="legend-dot cleared"></span> {translate('hq:status.cleared')}</div>
          <div className="legend-item"><span className="legend-dot available"></span> {translate('hq:status.available')}</div>
          <div className="legend-item"><span className="legend-dot locked"></span> {translate('hq:status.locked')}</div>
          <div className="legend-item"><span className="legend-dot failed"></span> {translate('hq:status.failed')}</div>
        </div>
      </div>

      {/* Side panel - territory info */}
      <div className="territory-info-panel">
        {selected ? (
          <>
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
              <span><b>{translate('hq:territory.chain')}</b>{selected.requires?.length ? translate('hq:territory.prerequisiteCount', { count: selected.requires.length }) : translate('hq:territory.frontlineSector')}</span>
            </div>
            <p className="territory-brief">{selected.brief}</p>

            <div className="territory-status-badge" data-status={selected.status}>
              {translate(`hq:status.${selected.status}`).toUpperCase()}
              {selected.remainingTimer != null && ` • ${translate('hq:territory.turnsBadge', { turns: selected.remainingTimer })}`}
            </div>

            {selected.requires && selected.requires.length > 0 && selected.status === 'locked' && (
              <div className="territory-requires">
                <strong>{translate('hq:territory.requires')}</strong>
                <ul>
                  {selected.requires.map(reqId => {
                    const req = territories.find(t => t.id === reqId);
                    return (
                      <li key={reqId} className={req?.status === 'cleared' ? 'done' : ''}>
                        {req?.name || reqId} {req?.status === 'cleared' && '✓'}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {selected.status === 'available' && (
              <button className="attack-btn-large" onClick={() => onStartBattle(selected.id)}>
                ⚔ {translate('hq:territory.launchAttack')}
              </button>
            )}

            {selected.status === 'cleared' && (
              <div className="territory-reward-earned">
                <span className="checkmark">✓</span> {translate('hq:territory.sectorSecured')}
              </div>
            )}
          </>
        ) : (
          <div className="no-selection">
            <p>{translate('hq:map.selectTerritoryHint')}</p>
            <div className="quick-stats">
              <div>{translate('hq:status.cleared')}: {territories.filter(t => t.status === 'cleared').length}</div>
              <div>{translate('hq:status.available')}: {territories.filter(t => t.status === 'available').length}</div>
              <div>{translate('hq:map.remaining')}: {territories.filter(t => t.status === 'locked').length}</div>
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
  campaignDifficulty, turn, warClock, money, research, strategic,
  army, reserves, territories, researchTopics, currentResearch, completedResearch,
  log, onStartBattle, onEndTurn, onRecruit, onRefill, onDismiss,
  onResearch, onConvertMoney, onConvertResearch, onBack, popups, onDismissPopups, availableUnits
}) => {
  const { t } = useTranslation(['hq', 'common', 'campaign']);
  const [activeTab, setActiveTab] = useState<'map' | 'army' | 'research'>('map');
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const switchTab = (tab: 'map' | 'army' | 'research') => {
    clearToasts();
    setActiveTab(tab);
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
          <div className="hq-alerts" role="alertdialog" aria-label={t('outcome.operationReportsAriaLabel')}>
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
            onStartBattle={onStartBattle}
            log={log}
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
                            <span><b>XP</b> {u.experience}</span>
                            <span className={`readiness-chip readiness-${readinessKey}`}><b>{t(`army.readiness.${readinessKey}`)}</b>{t(`common:unitType.${u.unitType}`)}</span>
                          </div>
                          <div className="unit-actions">
                            <button onClick={() => onRefill(u.id, 'rookie')}>{t('army.refill')}</button>
                            <button onClick={() => onDismiss(u.id)}>{t('army.dismiss')}</button>
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
              <div className="recruit-options">
                {availableUnits.map((u) => (
                  <button
                    key={u.id}
                    className={`recruit-btn ${!u.canAfford ? 'recruit-btn-short' : ''}`}
                    disabled={!u.canRecruit}
                    onClick={() => {
                      if (u.canRecruit) onRecruit(u.id, 'rookie');
                    }}
                  >
                    <span>{u.name}</span>
                    <span className="recruit-meta">
                      {!u.unlocked
                        ? t('army.locked')
                        : u.unitType === 'hero' && u.ownedCount > 0
                          ? t('army.inForce')
                          : u.unitType === 'hero' && u.reserveCount > 0
                            ? t('army.inTransit')
                            : `${u.cost} CR · ${u.canAfford ? t('army.turnPlus2') : t('army.needFunds')}`}
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
                      const isLocked = missingRequirements.length > 0;
                      const isWaiting = Boolean(currentResearch) && !isActive;
                      const isRecommended = topic.id === recommendedResearchId && !isCompleted && !isActive && !isLocked && !isWaiting;
                      const stateKey = isCompleted ? 'done' : isActive ? 'active' : isLocked ? 'locked' : isWaiting ? 'wait' : isRecommended ? 'priority' : 'ready';
                      const branch = researchBranch(topic);
                      const isPathNode = focusResearchPathIds.has(topic.id);
                      return (
                        <div
                          key={topic.id}
                          className={`research-card research-branch-${branch} ${isPathNode ? 'research-path-node' : ''} ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isLocked ? 'locked-node' : ''} ${isWaiting ? 'waiting-node' : ''} ${isRecommended ? 'recommended-node' : ''} ${!isCompleted && !isActive && !isLocked && !isWaiting ? 'ready-node' : ''}`}
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
                          ) : (
                            <button
                              className="research-btn"
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
    </div>
  );
};
