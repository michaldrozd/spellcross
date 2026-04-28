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
            ['Paris', 24, 40],
            ['Lyon', 28, 53],
            ['Amsterdam', 31, 25],
            ['Berlin', 50, 31],
            ['Prague', 52, 40],
            ['Vienna', 56, 49],
            ['Warsaw', 64, 35],
            ['Kyiv', 78, 40]
          ].map(([name, x, y]) => (
            <g key={name}>
              <circle cx={x} cy={y} r="0.45" fill="#1b2422" opacity="0.7" />
            </g>
          ))}

          {/* Region labels */}
          <text x="25" y="38" className="region-label">FRANCE</text>
          <text x="45" y="28" className="region-label">GERMANY</text>
          <text x="58" y="42" className="region-label">AUSTRIA</text>
          <text x="65" y="32" className="region-label">POLAND</text>
          <text x="78" y="42" className="region-label">UKRAINE</text>

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

          {/* Territory markers */}
          {territories.map(t => {
            if (!t.mapPosition) return null;
            const isSelected = t.id === selectedTerritory;
            const color = getStatusColor(t.status);

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

                {/* Main marker */}
                <circle
                  cx={t.mapPosition.x}
                  cy={t.mapPosition.y}
                  r={isSelected ? 2 : 1.5}
                  fill={t.status === 'locked' ? '#27272a' : color}
                  stroke={isSelected ? '#ffffff' : color}
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
            d="M 95,40 L 88,35 L 88,38 L 82,38 L 82,42 L 88,42 L 88,45 Z"
            fill="#ef4444"
            opacity="0.44"
          />
          <text x="93" y="50" className="invasion-label">INVASION</text>
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
        {popups && popups.length > 0 && (
          <div className="hq-alerts" role="alertdialog" aria-label="Operation reports">
            {popups.map((popup, index) => (
              <div key={`${popup.title}-${index}`} className={`hq-alert hq-alert-${popup.kind}`}>
                <strong>{popup.title}</strong>
                <span>{popup.body}</span>
              </div>
            ))}
            {onDismissPopups && (
              <button className="dismiss-alerts" onClick={onDismissPopups}>DISMISS</button>
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
              <h3>YOUR FORCES</h3>
              {army.length === 0 ? (
                <p className="empty-msg">No units recruited yet</p>
              ) : (
                army.map((u) => (
                  <div key={u.id} className="unit-row">
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
                      <span><b>XP</b> {u.experience}</span>
                    </div>
                    <div className="unit-actions">
                      <button onClick={() => onRefill(u.id, 'rookie')}>REFILL</button>
                      <button onClick={() => onDismiss(u.id)}>DISMISS</button>
                    </div>
                  </div>
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
            </div>
          </div>
        )}

        {activeTab === 'research' && (
          <div className="research-view">
            <div className="research-status">
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
            <div className="research-tree">
              <h3>RESEARCH NETWORK</h3>
              <div
                className="research-tree-board"
                style={{ '--research-columns': researchColumns.length } as React.CSSProperties}
              >
                {researchColumns.map((topics, tierIndex) => (
                  <section key={tierIndex} className="research-column">
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
                      const stateLabel = isCompleted ? 'DONE' : isActive ? 'ACTIVE' : isLocked ? 'LOCKED' : isWaiting ? 'WAIT' : 'READY';
                      return (
                        <div
                          key={topic.id}
                          className={`research-card ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isLocked ? 'locked-node' : ''}`}
                        >
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
                              {isLocked ? `LOCKED: ${missingRequirements.map((id) => researchById.get(id)?.name ?? id).join(' / ')}` : 'QUEUE PROJECT'}
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
