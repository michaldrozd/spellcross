import React, { useState, useMemo } from 'react';
import type { CampaignState } from '@spellcross/core';

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
  tier: string;
  currentHealth: number;
  maxHealth: number;
  experience: number;
}

interface ResearchTopic {
  id: string;
  name: string;
  description: string;
  cost: number;
}

interface StrategicHQProps {
  turn: number;
  warClock: number;
  money: number;
  research: number;
  strategic: number;
  army: ArmyUnit[];
  territories: Territory[];
  researchTopics: ResearchTopic[];
  currentResearch: { topicId: string; remaining: number } | null;
  completedResearch: Set<string>;
  log: string[];
  onStartBattle: (territoryId: string) => void;
  onEndTurn: () => void;
  onRecruit: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRefill: (unitId: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onDismiss: (unitId: string) => void;
  onResearch: (topicId: string) => void;
  onConvertMoney: (amount: number) => void;
  onConvertResearch: (amount: number) => void;
  onBack: () => void;
  availableUnits: { id: string; name: string; unlocked: boolean }[];
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

  const getDifficultyStars = (diff: number = 1) => '★'.repeat(diff) + '☆'.repeat(5 - diff);

  return (
    <div className="strategic-map-view">
      {/* Main map area */}
      <div className="strategic-map-container">
        <svg viewBox="0 0 100 80" className="strategic-map-svg" preserveAspectRatio="xMidYMid meet">
          {/* Background gradient - dark war map */}
          <defs>
            <radialGradient id="mapGradient" cx="85%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#4a1515" />
              <stop offset="100%" stopColor="#1a1a2e" />
            </radialGradient>
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

          {/* Simplified Europe outline */}
          <path
            d="M 15,25 Q 20,20 30,18 L 50,12 Q 55,15 60,14 L 70,18 Q 80,22 85,30 L 88,45 Q 85,55 80,60 L 70,65 Q 60,68 50,65 L 40,60 Q 30,55 25,50 L 20,40 Q 15,35 15,25"
            fill="none"
            stroke="#3f3f46"
            strokeWidth="0.3"
            opacity="0.5"
          />

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
              stroke={conn.to.status === 'locked' ? '#3f3f46' : '#6b7280'}
              strokeWidth="0.3"
              strokeDasharray={conn.to.status === 'locked' ? '1,1' : 'none'}
              opacity="0.6"
            />
          ))}

          {/* Territory markers */}
          {territories.map(t => {
            if (!t.mapPosition) return null;
            const isSelected = t.id === selectedTerritory;
            const color = getStatusColor(t.status);

            return (
              <g key={t.id} className="territory-marker" onClick={() => onSelectTerritory(t.id)}>
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
                  {t.name.split(' ')[0]}
                </text>
              </g>
            );
          })}

          {/* Invasion arrow from the east */}
          <path
            d="M 95,40 L 88,35 L 88,38 L 82,38 L 82,42 L 88,42 L 88,45 Z"
            fill="#ef4444"
            opacity="0.6"
          />
          <text x="93" y="50" className="invasion-label">INVASION</text>
        </svg>

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
  army, territories, researchTopics, currentResearch, completedResearch,
  log, onStartBattle, onEndTurn, onRecruit, onRefill, onDismiss,
  onResearch, onConvertMoney, onConvertResearch, onBack, availableUnits
}) => {
  const [activeTab, setActiveTab] = useState<'map' | 'army' | 'research'>('map');
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);

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
            <span className="resource-icon">💰</span>
            <span className="resource-value">{Math.round(money)}</span>
            <span className="resource-label">Credits</span>
          </div>
          <div className="resource">
            <span className="resource-icon">🔬</span>
            <span className="resource-value">{Math.round(research)}</span>
            <span className="resource-label">Research</span>
          </div>
          <div className="resource">
            <span className="resource-icon">⭐</span>
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
        <button className={`tab ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>
          🗺 TERRITORIES
        </button>
        <button className={`tab ${activeTab === 'army' ? 'active' : ''}`} onClick={() => setActiveTab('army')}>
          ⚔ ARMY ({army.length})
        </button>
        <button className={`tab ${activeTab === 'research' ? 'active' : ''}`} onClick={() => setActiveTab('research')}>
          🔬 RESEARCH
        </button>
      </div>

      {/* Content area */}
      <div className="hq-content">
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
                    <div className="unit-info">
                      <span className="unit-name">{u.name}</span>
                      <span className="unit-tier">{u.tier}</span>
                    </div>
                    <div className="unit-stats">
                      <span>HP {u.currentHealth}/{u.maxHealth}</span>
                      <span>XP {u.experience}</span>
                    </div>
                    <div className="unit-actions">
                      <button onClick={() => onRefill(u.id, 'rookie')}>REFILL</button>
                      <button onClick={() => onDismiss(u.id)}>DISMISS</button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="recruit-panel">
              <h3>RECRUIT</h3>
              <div className="recruit-options">
                {availableUnits.map((u) => (
                  <button
                    key={u.id}
                    className="recruit-btn"
                    disabled={!u.unlocked}
                    onClick={() => onRecruit(u.id, 'rookie')}
                  >
                    {u.name}
                    {!u.unlocked && <span className="locked">🔒</span>}
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
                    <span className="research-name">{currentResearch.topicId}</span>
                    <span className="research-remaining">{currentResearch.remaining} RP remaining</span>
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
              <h3>AVAILABLE RESEARCH</h3>
              <div className="research-grid">
                {researchTopics.map((topic) => {
                  const isCompleted = completedResearch.has(topic.id);
                  const isActive = currentResearch?.topicId === topic.id;
                  return (
                    <div key={topic.id} className={`research-card ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}>
                      <h4>{topic.name}</h4>
                      <p>{topic.description}</p>
                      <div className="research-cost">Cost: {topic.cost} RP</div>
                      {isCompleted ? (
                        <span className="research-done">✓ COMPLETED</span>
                      ) : isActive ? (
                        <span className="research-progress-label">IN PROGRESS</span>
                      ) : (
                        <button
                          className="research-btn"
                          disabled={!!currentResearch}
                          onClick={() => onResearch(topic.id)}
                        >
                          START RESEARCH
                        </button>
                      )}
                    </div>
                  );
                })}
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

