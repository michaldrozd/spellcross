import React, { useState, useMemo } from 'react';
import type { CampaignState } from '@spellcross/core';
import { clearToasts } from './Toast.js';

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
  log: string[];
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

function researchBranchLabel(branch: string) {
  switch (branch) {
    case 'recon':
      return 'RECON';
    case 'armor':
      return 'ARMOR';
    case 'infantry':
      return 'INFANTRY';
    case 'logistics':
      return 'LOGISTICS';
    case 'arcane':
      return 'WARDING';
    case 'artillery':
      return 'SIEGE';
    default:
      return 'DOCTRINE';
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

function armySectionLabel(section: string) {
  switch (section) {
    case 'command':
      return 'COMMAND';
    case 'recon':
      return 'RECON';
    case 'vehicles':
      return 'VEHICLES';
    case 'support':
      return 'SUPPORT';
    default:
      return 'INFANTRY';
  }
}

// Strategic Map View Component with visual Europe map
const StrategicMapView: React.FC<{
  territories: Territory[];
  selectedTerritory: string | null;
  onSelectTerritory: (id: string | null) => void;
  onStartBattle: (id: string) => void;
  log: string[];
}> = ({ territories, selectedTerritory, onSelectTerritory, onStartBattle, log }) => {
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

  const mapLabelForTerritory = (name: string) => {
    if (name.startsWith('The Eastern Rift')) return 'Rift';
    if (name.startsWith('Black Sea')) return 'Black Sea';
    return name.split(' ')[0] ?? name;
  };

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
          <text x="20" y="48" className="region-label">FRANCE</text>
          <text x="42" y="41" className="region-label">GERMANY</text>
          <text x="54" y="57" className="region-label">AUSTRIA</text>
          <text x="69" y="35" className="region-label">POLAND</text>
          <text x="76" y="58" className="region-label">UKRAINE</text>

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
                  {mapLabelForTerritory(t.name)}
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
          <text x="91" y="60" className="invasion-label">INVASION</text>
        </svg>

        <div className="map-status-strip">
          <span><b>{statusCounts.available}</b> active fronts</span>
          <span><b>{statusCounts.cleared}</b> secured</span>
          <span><b>{statusCounts.locked}</b> locked</span>
          <strong>{urgentTerritory ? `${urgentTerritory.name}: ${urgentTerritory.remainingTimer} turns` : 'No timed crisis'}</strong>
        </div>

        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-item"><span className="legend-dot cleared"></span> Cleared</div>
          <div className="legend-item"><span className="legend-dot available"></span> Available</div>
          <div className="legend-item"><span className="legend-dot locked"></span> Locked</div>
          <div className="legend-item"><span className="legend-dot failed"></span> Failed</div>
        </div>
      </div>

      {/* Side panel - territory info */}
      <div className="territory-info-panel">
        {selected ? (
          <>
            <h2>{selected.name}</h2>
            <div className="territory-region">{selected.region}</div>
            <div className="territory-difficulty">
              Difficulty: <span className="stars">{getDifficultyStars(selected.difficulty)}</span>
            </div>
            <div className="territory-metrics">
              <span><b>{selected.status.toUpperCase()}</b>Status</span>
              <span><b>{selected.remainingTimer ?? '-'}</b>Turns</span>
              <span><b>{selected.difficulty ?? 1}/5</b>Risk</span>
            </div>
            <div className="territory-intel">
              <span><b>ENTRY</b>{selected.status === 'locked' ? 'Blocked' : selected.status === 'available' ? 'Open' : 'Closed'}</span>
              <span><b>PRESSURE</b>{selected.remainingTimer != null ? `${selected.remainingTimer} turn clock` : 'No active timer'}</span>
              <span><b>CHAIN</b>{selected.requires?.length ? `${selected.requires.length} prerequisite` : 'Frontline sector'}</span>
            </div>
            <p className="territory-brief">{selected.brief}</p>

            <div className="territory-status-badge" data-status={selected.status}>
              {selected.status.toUpperCase()}
              {selected.remainingTimer != null && ` • ${selected.remainingTimer} TURNS`}
            </div>

            {selected.requires && selected.requires.length > 0 && selected.status === 'locked' && (
              <div className="territory-requires">
                <strong>Requires:</strong>
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
                ⚔ LAUNCH ATTACK
              </button>
            )}

            {selected.status === 'cleared' && (
              <div className="territory-reward-earned">
                <span className="checkmark">✓</span> SECTOR SECURED
              </div>
            )}
          </>
        ) : (
          <div className="no-selection">
            <p>Select a territory on the map to view details</p>
            <div className="quick-stats">
              <div>Cleared: {territories.filter(t => t.status === 'cleared').length}</div>
              <div>Available: {territories.filter(t => t.status === 'available').length}</div>
              <div>Remaining: {territories.filter(t => t.status === 'locked').length}</div>
            </div>
            <div className="front-intel-grid">
              <span><b>PRIMARY THREAT</b>{urgentTerritory?.name ?? 'No timed crisis'}</span>
              <span><b>NEXT LOCK</b>{nextLockedTerritory?.name ?? 'All routes open'}</span>
              <span><b>READINESS</b>{statusCounts.available} active fronts</span>
            </div>
          </div>
        )}

        {/* Operations log */}
        <div className="mini-log">
          <h4>Recent Events</h4>
          {log.slice(-4).map((entry, idx) => (
            <div key={idx} className="log-entry">{entry}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const StrategicHQ: React.FC<StrategicHQProps> = ({
  turn, warClock, money, research, strategic,
  army, reserves, territories, researchTopics, currentResearch, completedResearch,
  log, onStartBattle, onEndTurn, onRecruit, onRefill, onDismiss,
  onResearch, onConvertMoney, onConvertResearch, onBack, popups, onDismissPopups, availableUnits
}) => {
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
  const focusResearchUnlocks = focusResearchTopic?.unlocks?.length ? focusResearchTopic.unlocks.join(' / ') : 'Force multiplier';
  const focusResearchRequires = focusResearchTopic?.requires?.length
    ? focusResearchTopic.requires.map((id) => researchById.get(id)?.name ?? id).join(' / ')
    : 'Baseline doctrine';
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
          <button className="back-btn" onClick={onBack}>◀ MENU</button>
          <h1>FIELD HQ</h1>
          <span className="turn-info">TURN {turn} • WAR CLOCK {warClock}</span>
        </div>
        <div className="hq-resources">
          <div className="resource">
            <span className="resource-icon">CR</span>
            <span className="resource-value">{Math.round(money)}</span>
            <span className="resource-label">Credits</span>
          </div>
          <div className="resource">
            <span className="resource-icon">RP</span>
            <span className="resource-value">{Math.round(research)}</span>
            <span className="resource-label">Research</span>
          </div>
          <div className="resource">
            <span className="resource-icon">SP</span>
            <span className="resource-value">{Math.round(strategic)}</span>
            <span className="resource-label">SP</span>
          </div>
        </div>
        <button className="end-turn-btn" onClick={onEndTurn}>
          END TURN ▶
        </button>
      </div>

      {/* Tab navigation */}
      <div className="hq-tabs">
        <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} data-active={activeTab === 'map'} style={activeTab === 'map' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('map')}>
          <span className="tab-code">OPS</span>
          <span>Territories</span>
        </button>
        <button className={`tab ${activeTab === 'army' ? 'active' : ''}`} data-active={activeTab === 'army'} style={activeTab === 'army' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('army')}>
          <span className="tab-code">TOE</span>
          <span>Army ({army.length})</span>
        </button>
        <button className={`tab ${activeTab === 'research' ? 'active' : ''}`} data-active={activeTab === 'research'} style={activeTab === 'research' ? activeTabStyle : inactiveTabStyle} onClick={() => switchTab('research')}>
          <span className="tab-code">R&amp;D</span>
          <span>Research</span>
        </button>
      </div>

      {/* Content area */}
      <div className="hq-content">
        {latestOutcomeReport && (
          <section className={`hq-outcome hq-outcome-${latestOutcomeReport.kind}`} aria-label="Latest operation outcome">
            <div className="hq-outcome-code">{latestOutcomeReport.kind === 'loss' ? 'RED STATUS' : 'SECURED'}</div>
            <div>
              <span>OPERATION RESULT</span>
              <h2>{latestOutcomeReport.title}</h2>
              <p>{latestOutcomeReport.body}</p>
            </div>
            <div className="hq-outcome-actions">
              <b>{latestOutcomeReport.kind === 'loss' ? `${army.length} UNITS READY` : `${Math.round(money)} CR`}</b>
              <small>{latestOutcomeReport.kind === 'loss' ? 'Open Army if force strength is low' : 'Rewards posted to HQ reserves'}</small>
              {onDismissPopups && (
                <button onClick={onDismissPopups}>ACKNOWLEDGE</button>
              )}
            </div>
          </section>
        )}

        {visibleReports.length > 0 && (
          <div className="hq-alerts" role="alertdialog" aria-label="Operation reports">
            <div className="hq-alerts-header">
              <span>OPERATION REPORTS</span>
              <b>{popups?.length ?? visibleReports.length}</b>
            </div>
            <div className="hq-alert-list">
              {visibleReports.map((popup, index) => (
                <div key={`${popup.title}-${index}`} className={`hq-alert hq-alert-${popup.kind}`}>
                  <strong>{popup.title}</strong>
                  <span>{popup.body}</span>
                </div>
              ))}
            </div>
            {archivedReportCount > 0 && (
              <small className="hq-alert-archive">+{archivedReportCount} earlier reports</small>
            )}
            {onDismissPopups && (
              <button className="dismiss-alerts" onClick={onDismissPopups}>CLEAR REPORTS</button>
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
                  <span>FORCE ROSTER</span>
                  <h3>YOUR FORCES</h3>
                </div>
                <div className="army-kpis">
                  <span><b>{army.length}</b> ready</span>
                  <span><b>{reserves.length}</b> transit</span>
                  <span><b>{woundedUnits}</b> damaged</span>
                </div>
              </div>
              {army.length > 0 && (
                <div className="army-type-strip">
                  {Object.entries(armyByType).map(([type, count]) => (
                    <span key={type}><b>{count}</b>{type}</span>
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
                    <span>FORCE ANCHOR</span>
                    <h4>{forceFocusUnit.name}</h4>
                    <p>{armySectionLabel(armySectionKey(forceFocusUnit))} · {forceFocusUnit.tier} · {forceFocusHealth}% combat ready</p>
                  </div>
                  <div className="force-focus-meter">
                    <b>{forceFocusUnit.currentHealth}/{forceFocusUnit.maxHealth}</b>
                    <i style={{ '--stat-percent': `${forceFocusHealth}%` } as React.CSSProperties} />
                  </div>
                </section>
              )}
              {army.length === 0 ? (
                <p className="empty-msg">No units recruited yet</p>
              ) : (
                armySections.map(({ section, units }) => (
                  <section key={section} className={`army-section army-section-${section}`}>
                    <div className="army-section-heading">
                      <span>{armySectionLabel(section)}</span>
                      <b>{units.length}</b>
                    </div>
                    {units.map((u) => {
                      const healthPercent = Math.max(0, Math.min(100, Math.round((u.currentHealth / u.maxHealth) * 100)));
                      const readiness = healthPercent < 55 ? 'DAMAGED' : u.experience >= 60 ? 'VETERAN' : 'READY';
                      return (
                        <div key={u.id} className={`unit-row unit-row-${u.unitType} unit-row-section-${section} ${healthPercent < 70 ? 'unit-row-damaged' : ''}`}>
                          <div className={`roster-token roster-token-${u.unitType}`}>
                            <img src={rosterPortrait(u.definitionId, u.unitType)} alt="" />
                            <span>{u.name.slice(0, 1)}</span>
                          </div>
                          <div className="unit-info">
                            <span className="unit-name">{u.name}</span>
                            <span className="unit-tier">{u.tier} · {u.unitType}</span>
                          </div>
                          <div className="unit-stats">
                            <span className="stat-with-bar">
                              <b>HP</b> {u.currentHealth}/{u.maxHealth}
                              <i style={{ '--stat-percent': `${healthPercent}%` } as React.CSSProperties} />
                            </span>
                            <span><b>XP</b> {u.experience}</span>
                            <span className={`readiness-chip readiness-${readiness.toLowerCase()}`}><b>{readiness}</b>{u.unitType}</span>
                          </div>
                          <div className="unit-actions">
                            <button onClick={() => onRefill(u.id, 'rookie')}>REFILL</button>
                            <button onClick={() => onDismiss(u.id)}>DISMISS</button>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))
              )}
              {reserves.length > 0 && (
                <div className="reserve-roster">
                  <h3>IN TRANSIT</h3>
                  {reserves.map((u) => (
                    <div key={u.id} className="unit-row reserve-row">
                      <div className={`roster-token roster-token-${u.unitType}`}>
                        <img src={rosterPortrait(u.definitionId, u.unitType)} alt="" />
                        <span>{u.name.slice(0, 1)}</span>
                      </div>
                      <div className="unit-info">
                        <span className="unit-name">{u.name}</span>
                        <span className="unit-tier">{u.tier} · {u.unitType}</span>
                      </div>
                      <div className="unit-stats">
                        <span className="stat-with-bar">
                          <b>HP</b> {u.currentHealth}/{u.maxHealth}
                          <i style={{ '--stat-percent': `${Math.max(0, Math.min(100, Math.round((u.currentHealth / u.maxHealth) * 100)))}%` } as React.CSSProperties} />
                        </span>
                        <span><b>READY</b> T{u.availableOnTurn ?? turn + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="recruit-panel">
              <h3>RECRUIT</h3>
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
                        ? 'LOCKED'
                        : u.unitType === 'hero' && u.ownedCount > 0
                          ? 'IN FORCE'
                          : u.unitType === 'hero' && u.reserveCount > 0
                            ? 'IN TRANSIT'
                            : `${u.cost} CR · ${u.canAfford ? 'T+2' : 'NEED FUNDS'}`}
                    </span>
                  </button>
                ))}
              </div>
              <div className="recruit-intel">
                <span>FORCE PLAN</span>
                <b>{forceFocusUnit ? armySectionLabel(armySectionKey(forceFocusUnit)) : 'RESERVE'} ANCHOR</b>
                <p>{army.length} field units · {woundedUnits} damaged · {reserves.length} in transit</p>
                <i>Next purchase should fill the weakest section, not duplicate the anchor.</i>
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
                    <h3>CURRENTLY RESEARCHING</h3>
                    <div className="research-progress">
                      <span className="research-name">{activeResearchTopic?.name ?? currentResearch.topicId}</span>
                      <span className="research-remaining">{currentResearch.remaining} RP remaining</span>
                    </div>
                    <div className="research-progress-bar" aria-hidden="true">
                      <i style={{ '--research-progress': `${activeResearchProgress}%` } as React.CSSProperties} />
                    </div>
                  </div>
                ) : (
                  <div className="no-research">
                    <h3>NO ACTIVE RESEARCH</h3>
                    <p>Select a topic below to begin research</p>
                  </div>
                )}
              </div>
              <div className="research-kpis">
                <span><b>{Math.round(research)}</b>RP banked</span>
                <span><b>{completedResearch.size}</b>complete</span>
                <span><b>{readyResearchCount}</b>ready</span>
              </div>
            </div>
            <div className="research-tree">
              <div className="research-network-header">
                <h3>RESEARCH NETWORK</h3>
                {focusResearchTopic && (
                  <div className={`research-focus research-focus-${focusResearchBranch}`}>
                    <span>{currentResearch ? 'ACTIVE PROJECT' : 'RECOMMENDED NEXT'}</span>
                    <b>{focusResearchTopic.name}</b>
                    <small>{researchBranchLabel(focusResearchBranch)} · {focusResearchTopic.cost} RP</small>
                    <div>
                      <i>UNLOCKS</i><strong>{focusResearchUnlocks}</strong>
                      <i>REQUIRES</i><strong>{focusResearchRequires}</strong>
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
                      <span>TIER {tierIndex + 1}</span>
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
                      const stateLabel = isCompleted ? 'DONE' : isActive ? 'ACTIVE' : isLocked ? 'LOCKED' : isWaiting ? 'WAIT' : isRecommended ? 'PRIORITY' : 'READY';
                      const branch = researchBranch(topic);
                      const isPathNode = focusResearchPathIds.has(topic.id);
                      return (
                        <div
                          key={topic.id}
                          className={`research-card research-branch-${branch} ${isPathNode ? 'research-path-node' : ''} ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isLocked ? 'locked-node' : ''} ${isWaiting ? 'waiting-node' : ''} ${isRecommended ? 'recommended-node' : ''} ${!isCompleted && !isActive && !isLocked && !isWaiting ? 'ready-node' : ''}`}
                        >
                          <span className="research-branch-label">{researchBranchLabel(branch)}</span>
                          <span className="research-node-index">{topic.id.toUpperCase()}</span>
                          <span className="research-node-state">{stateLabel}</span>
                          <h4>{topic.name}</h4>
                          <p>{topic.description}</p>
                          <div className="research-requirements">
                            <span>REQ</span>
                            <b>{requirementNames.length ? requirementNames.join(' / ') : 'BASELINE'}</b>
                          </div>
                          <div className="research-cost">Cost: {topic.cost} RP</div>
                          {isCompleted ? (
                            <span className="research-done">COMPLETED</span>
                          ) : isActive ? (
                            <span className="research-progress-label">IN PROGRESS</span>
                          ) : (
                            <button
                              className="research-btn"
                              disabled={!!currentResearch || isLocked}
                              onClick={() => onResearch(topic.id)}
                            >
                              {isLocked ? `LOCKED: ${missingRequirements.map((id) => researchById.get(id)?.name ?? id).join(' / ')}` : isRecommended ? 'QUEUE PRIORITY PROJECT' : 'QUEUE PROJECT'}
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
              <h3>CONVERT STRATEGIC POINTS</h3>
              <div className="conversion-buttons">
                <button onClick={() => onConvertMoney(5)} disabled={strategic < 5}>
                  5 SP → $50
                </button>
                <button onClick={() => onConvertResearch(3)} disabled={strategic < 3}>
                  3 SP → 30 RP
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
