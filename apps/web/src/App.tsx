import './styles.css';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Graphics, Sprite, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { ChangeEvent } from 'react';
import { BattlefieldStage, AttackEffect, MovingUnit } from './components/BattlefieldStage.js';
import { MainMenu } from './components/MainMenu.js';
import { StrategicHQ } from './components/StrategicHQ.js';
import { AudioManager } from './services/AudioManager.js';
import { ToastContainer, showToast } from './components/Toast.js';

import { OverwatchButton } from './components/OverwatchButton.js';
import {
  applyBattleOutcome,
  calculateHitChance,
  canWeaponTarget,
  convertStrategicToMoney,
  convertStrategicToResearch,
  createCampaign,
  decideNextAIAction,
  endStrategicTurn,
  evaluateBattleOutcome,
  hexWithinRange,
  axialDistance,
  coordinateKey,
  hydrateCampaignState,
  isUnitUnlocked,
  planPathForUnit,
  recruitUnit,
  dismissUnit,
  refillUnit,
  rearmUnit,
  retreatFromBattle,
  serializeCampaignState,
  startBattleForTerritory,
  startResearch,
  TurnProcessor,
  updateAllFactionsVision
} from '@spellcross/core';
import type { BattlefieldMap, CampaignState, HexCoordinate, UnitInstance } from '@spellcross/core';
import { validatedStarterBundle } from '@spellcross/data';

const bundle = validatedStarterBundle;
const CAMPAIGN_STORAGE_KEY = 'spellcross:campaign-state';
const CAMPAIGN_SLOT_KEY = 'spellcross:campaign-slot';
const CAMPAIGN_SUMMARY_KEY = 'spellcross:campaign-summary';
const isoTileTexture = PIXI.Texture.from('/grass_tile_128x64.png');
const terrainTextures: Record<string, PIXI.Texture> = {
  plain: isoTileTexture,
  road: isoTileTexture,
  forest: isoTileTexture,
  urban: isoTileTexture,
  hill: isoTileTexture,
  water: isoTileTexture,
  swamp: isoTileTexture,
  structure: isoTileTexture
};

const unitTextures: Record<string, PIXI.Texture> = {
  infantry: PIXI.Texture.from('/units/infantry.png'),
  vehicle: PIXI.Texture.from('/units/tank.png'),
  artillery: PIXI.Texture.from('/units/artillery.png'),
  support: PIXI.Texture.from('/units/infantry.png'),
  hero: PIXI.Texture.from('/units/infantry.png'),
  air: PIXI.Texture.from('/units/tank.png')
};

interface SlotSummary {
  turn: number;
  resources: CampaignState['resources'];
  territories: number;
  updated: number;
  activeBattle: boolean;
}

const hexToPixel = (coord: HexCoordinate, size: number) => {
  const x = size * (Math.sqrt(3) * coord.q + (Math.sqrt(3) / 2) * coord.r);
  const y = size * (1.5 * coord.r);
  return { x, y };
};

const terrainColor: Record<string, number> = {
  plain: 0x2e4f36,
  road: 0x6b4c2a,
  forest: 0x245232,
  urban: 0x334155,
  hill: 0x3d4a3c,
  water: 0x1f5e8f,
  swamp: 0x2c4a3a,
  structure: 0x3f3f46
};

const borderColor: Record<string, number> = {
  alliance: 0x38bdf8,
  otherSide: 0xf472b6
};

interface HexProps {
  coord: HexCoordinate;
  size: number;
  terrain: string;
  onClick?: () => void;
  highlight?: boolean;
  visibility?: 'visible' | 'explored' | 'fog';
}

const HexTile: React.FC<HexProps> = ({ coord, size, terrain, onClick, highlight, visibility = 'visible' }) => {
  const { x, y } = hexToPixel(coord, size);
  const tex = terrainTextures[terrain] ?? terrainTextures.plain;
  const alpha = visibility === 'visible' ? 1 : visibility === 'explored' ? 0.6 : 0.2;
  return (
    <Sprite
      x={x - size * 2.5}
      y={y - size * 1.2}
      width={size * 5}
      height={size * 2.5}
      texture={tex}
      alpha={alpha}
      tint={highlight ? 0xf8fafc : 0xffffff}
      eventMode={onClick ? 'static' : 'none'}
      pointerdown={onClick}
      cursor={onClick ? 'pointer' : 'default'}
    />
  );
};

interface UnitMarkerProps {
  unit: UnitInstance;
  size: number;
  selected: boolean;
  onClick: () => void;
}

const UnitMarker: React.FC<UnitMarkerProps> = ({ unit, size, selected, onClick }) => {
  const { x, y } = hexToPixel(unit.coordinate, size);
  const color = borderColor[unit.faction];
  const tex = unitTextures[unit.unitType] ?? unitTextures.infantry;
  const draw = React.useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      // hp bar
      const hpPct = Math.max(0, (unit.currentHealth ?? unit.stats.maxHealth) / unit.stats.maxHealth);
      const barW = size * 0.9;
      const barH = 6;
      g.beginFill(0x111827, 0.9);
      g.drawRoundedRect(-barW / 2, -size * 0.7, barW, barH, 2);
      g.endFill();
      g.beginFill(0xfacc15, 0.9);
      g.drawRoundedRect(-barW / 2, -size * 0.7, barW * hpPct, barH, 2);
      g.endFill();
      // facing wedge
      const orientation = unit.orientation ?? 0;
      const angle = (Math.PI / 3) * orientation - Math.PI / 6;
      const arc = size * 0.65;
      g.beginFill(0xffffff, 0.18);
      g.moveTo(0, 0);
      g.lineTo(Math.cos(angle) * arc, Math.sin(angle) * arc);
      g.lineTo(Math.cos(angle + Math.PI / 6) * arc, Math.sin(angle + Math.PI / 6) * arc);
      g.closePath();
      g.endFill();
      if (unit.statusEffects?.has('overwatch')) {
        g.lineStyle(2, 0xfacc15, 1);
        g.drawCircle(0, 0, size * 0.52);
      }
      if (selected) {
        g.lineStyle(2, 0xfacc15, 1);
        g.drawCircle(0, 0, size * 0.5);
      }
    },
    [color, selected, size, unit.faction, unit.orientation]
  );
  return (
    <>
      <Sprite
        x={x - size * 0.9}
        y={y - size * 1.2}
        width={size * 1.8}
        height={size * 2.2}
        texture={tex}
        tint={unit.faction === 'alliance' ? 0xffffff : 0xffaaaa}
        eventMode="static"
        pointerdown={onClick}
        cursor="pointer"
      />
      <Graphics
        x={x}
        y={y}
        draw={draw}
        eventMode="static"
        pointerdown={onClick}
        cursor="pointer"
      />
    </>
  );
};

function loadSavedCampaign(slot: number): CampaignState {
  if (typeof window === 'undefined') {
    return createCampaign(bundle);
  }
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
  const saved = window.localStorage.getItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as SlotSummary;
  } catch {
    return null;
  }
}

function useCampaign() {
  const initialSlot = typeof window === 'undefined' ? 1 : Number(window.localStorage.getItem(CAMPAIGN_SLOT_KEY) ?? 1);
  const [slot, setSlot] = useState<number>(Number.isNaN(initialSlot) ? 1 : initialSlot);
  const ref = useRef<CampaignState>(loadSavedCampaign(slot));
  const [, rerender] = useState(0);
  const [summary, setSummary] = useState<SlotSummary | null>(loadSummary(slot));
  const updateSummary = () => {
    const next: SlotSummary = {
      turn: ref.current.turn,
      resources: { ...ref.current.resources },
      territories: ref.current.territories.length,
      updated: Date.now(),
      activeBattle: Boolean(ref.current.activeBattle)
    };
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`, JSON.stringify(next));
    }
    setSummary(next);
  };
  const persist = () => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(`${CAMPAIGN_STORAGE_KEY}:${slot}`, JSON.stringify(serializeCampaignState(ref.current)));
      } catch (err) {
        console.warn('Failed to persist campaign', err);
      }
    }
    updateSummary();
    rerender((n) => n + 1);
  };
  const mutate = (fn: (state: CampaignState) => void) => {
    fn(ref.current);
    persist();
  };
  const reset = () => {
    ref.current = createCampaign(bundle);
    updateSummary();
    persist();
  };
  const changeSlot = (next: number) => {
    setSlot(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CAMPAIGN_SLOT_KEY, String(next));
    }
    ref.current = loadSavedCampaign(next);
    setSummary(loadSummary(next));
    rerender((n) => n + 1);
  };
  return { campaign: ref.current, mutate, persist, reset, slot, changeSlot, summary };
}

function formatNumber(n: number) {
  return Math.round(n);
}

function bestWeapon(attacker: UnitInstance, defender: UnitInstance, map: BattlefieldMap): { weapon: string; hit: number } | null {
  let choice: { weapon: string; hit: number } | null = null;
  const distance = axialDistance(attacker.coordinate, defender.coordinate);

  console.log('[bestWeapon] Checking weapons for attacker:', attacker.id, 'vs defender:', defender.id);
  console.log('[bestWeapon] Distance:', distance);
  console.log('[bestWeapon] Available weapons:', Object.keys(attacker.stats.weaponRanges));

  for (const weaponId of Object.keys(attacker.stats.weaponRanges)) {
    const range = attacker.stats.weaponRanges[weaponId] ?? 0;
    console.log(`[bestWeapon] Weapon ${weaponId}: range=${range}, canTarget=${canWeaponTarget(attacker, weaponId, defender)}`);

    // Check range first
    if (distance > range) {
      console.log(`[bestWeapon] ${weaponId}: out of range (${distance} > ${range})`);
      continue;
    }

    // Check if weapon can target this unit type
    if (!canWeaponTarget(attacker, weaponId, defender)) {
      console.log(`[bestWeapon] ${weaponId}: cannot target this unit type`);
      continue;
    }

    const hit = calculateHitChance({ attacker, defender, weaponId, map });
    console.log(`[bestWeapon] ${weaponId}: hitChance=${hit} (${Math.round(hit * 100)}%)`);

    if (hit <= 0) continue;

    // hit is a decimal 0-1, convert to percentage
    const hitPercent = Math.round(hit * 100);
    if (!choice || hitPercent > choice.hit) {
      choice = { weapon: weaponId, hit: hitPercent };
    }
  }

  // Fallback: if no weapon found via normal checks, try any weapon in range
  if (!choice) {
    console.log('[bestWeapon] No weapon found via normal checks, trying fallback...');
    for (const weaponId of Object.keys(attacker.stats.weaponRanges)) {
      const range = attacker.stats.weaponRanges[weaponId] ?? 0;
      if (distance <= range) {
        const hit = calculateHitChance({ attacker, defender, weaponId, map });
        choice = { weapon: weaponId, hit: Math.max(5, Math.round(hit * 100)) }; // At least 5% chance
        console.log('[bestWeapon] Fallback weapon:', weaponId, 'hit:', choice.hit);
        break;
      }
    }
  }

  console.log('[bestWeapon] Final choice:', choice);
  return choice;
}

const StrategicView: React.FC<{
  campaign: CampaignState;
  summary: SlotSummary | null;
  slot: number;
  onSlotChange: (slot: number) => void;
  onRecruit: (id: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRefill: (id: string, tier: 'rookie' | 'veteran' | 'elite') => void;
  onRearm: (id: string, newDef: string) => void;
  onDismiss: (id: string) => void;
  onResearch: (topicId: string) => void;
  onStartBattle: (territoryId: string) => void;
  onEndTurn: () => void;
  onConvertMoney: (amount: number) => void;
  onConvertResearch: (amount: number) => void;
  onReset: () => void;
  popups: CampaignState['popups'];
  onDismissPopups: () => void;
}> = ({
  campaign,
  summary,
  slot,
  onSlotChange,
  onRecruit,
  onRefill,
  onRearm,
  onDismiss,
  onResearch,
  onStartBattle,
  onEndTurn,
  onConvertMoney,
  onConvertResearch,
  onReset,
  popups,
  onDismissPopups
}) => {
  const availableUnits = bundle.units.filter((u) => u.faction === 'alliance');
  const researchTopics = bundle.research;

  return (
    <div className="grid">
      <div className="card">
        <header className="card-head">
          <div>
            <p className="eyebrow">Turn {campaign.turn} · War clock {campaign.globalTimer}</p>
            <h2>Command Board</h2>
          </div>
          <div className="inline-actions">
            <label className="muted">
              Slot&nbsp;
              <select value={slot} onChange={(e: ChangeEvent<HTMLSelectElement>) => onSlotChange(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{`Slot ${n}`}</option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={onReset}>Reset</button>
            <button className="primary" onClick={onEndTurn}>End Turn</button>
          </div>
          {summary && (
            <p className="muted" data-testid="slot-summary">
              Autosave · Turn {summary.turn} · ${formatNumber(summary.resources.money)} / RP {formatNumber(summary.resources.research)} / SP {formatNumber(summary.resources.strategic)} · {new Date(summary.updated).toLocaleTimeString()}
            </p>
          )}
        </header>
        <div className="resources">
          <div>
            <p className="label">Money</p>
            <p className="value">{formatNumber(campaign.resources.money)}</p>
            <button onClick={() => onConvertMoney(5)}>Convert 5 SP → $</button>
          </div>
          <div>
            <p className="label">Research</p>
            <p className="value">{formatNumber(campaign.resources.research)}</p>
            <button onClick={() => onConvertResearch(3)}>Convert 3 SP → RP</button>
          </div>
          <div>
            <p className="label">Strategic Points</p>
            <p className="value">{formatNumber(campaign.resources.strategic)}</p>
          </div>
        </div>
        <div className="log-panel">
          <h3>Operations Log</h3>
          <ul>
            {campaign.log.slice(-5).map((entry, idx) => (
              <li key={`${entry}-${idx}`} className="muted">
                {entry}
              </li>
            ))}
          </ul>
          {campaign.events && campaign.events.length > 0 && (
            <>
              <h4>Events</h4>
              <ul>
                {campaign.events.slice(-3).map((evt, idx) => (
                  <li key={`${evt.message}-${idx}`} className="muted">
                    Turn {evt.turn}: {evt.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          {popups && popups.length > 0 && (
            <div className="popup-panel" role="alertdialog" aria-label="Briefings">
              {popups.map((p, idx) => (
                <div key={`${p.title}-${idx}`} className={`popup ${p.kind}`}>
                  <strong>{p.title}</strong>
                  <p className="muted">{p.body}</p>
                  <p className="muted">Turn {p.turn}</p>
                </div>
              ))}
              <button className="secondary" onClick={onDismissPopups}>
                Dismiss briefings
              </button>
            </div>
          )}
        </div>
        <div className="territories">
          <h3>Territories</h3>
          <ul>
            {campaign.territories.map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.name}</strong> — {t.brief}
                  <p className="muted">
                    Status: {t.status} {t.remainingTimer != null ? `(timer ${t.remainingTimer})` : ''}
                  </p>
                </div>
                <button
                  disabled={t.status !== 'available'}
                  onClick={() => onStartBattle(t.id)}
                >
                  Attack
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="card">
        <h2>Army</h2>
        <ul className="roster">
          {campaign.army.map((u) => {
            const def = bundle.units.find((d) => d.id === u.definitionId)!;
            return (
              <li key={u.id}>
                <div>
                  <strong>{def.name}</strong> <span className="muted">({u.tier})</span>
                  <p className="muted">HP {formatNumber(u.currentHealth ?? def.stats.maxHealth)}/{def.stats.maxHealth} · XP {u.experience}</p>
                </div>
                <div className="inline-actions">
                  <button onClick={() => onRefill(u.id, 'rookie')}>Refill</button>
                  <button
                    onClick={() => onRearm(u.id, 'leopard-2')}
                    disabled={!isUnitUnlocked(campaign, bundle, 'leopard-2')}
                    title={isUnitUnlocked(campaign, bundle, 'leopard-2') ? '' : 'Research Composite Plating first'}
                  >
                    Rearm
                  </button>
                  <button onClick={() => onDismiss(u.id)}>Dismiss</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="recruit">
          <h3>Recruit</h3>
          <div className="inline-actions">
            {availableUnits.slice(0, 4).map((u) => {
              const unlocked = isUnitUnlocked(campaign, bundle, u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => onRecruit(u.id, 'rookie')}
                  disabled={!unlocked}
                  title={unlocked ? '' : 'Complete the required research first'}
                >
                  {u.name}
                  {!unlocked ? ' (locked)' : ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Research</h2>
        <p className="muted">
          {campaign.research.inProgress
            ? `Researching ${campaign.research.inProgress.topicId} (${campaign.research.inProgress.remaining} RP left)`
            : 'No project running'}
        </p>
        <p className="muted">Known tech: {[...campaign.research.completed].join(', ') || 'none'}</p>
        <ul className="research-list">
          {researchTopics.map((topic) => (
            <li key={topic.id}>
              <div>
                <strong>{topic.name}</strong>
                <p className="muted">{topic.description}</p>
                <p className="muted">Cost {topic.cost}</p>
              </div>
              <button
                disabled={Boolean(campaign.research.inProgress) || campaign.research.completed.has(topic.id)}
                onClick={() => onResearch(topic.id)}
              >
                {campaign.research.completed.has(topic.id)
                  ? 'Done'
                  : campaign.research.inProgress?.topicId === topic.id
                    ? 'In progress'
                    : 'Start'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const BattleView: React.FC<{
  campaign: CampaignState;
  onVictory: () => void;
  onDefeat: () => void;
  onRetreat: () => void;
  persist: () => void;
}> = ({ campaign, onVictory, onDefeat, onRetreat, persist }) => {
  const battle = campaign.activeBattle!;
  const { map } = battle.state;
  const [selected, setSelected] = useState<string | null>(null);
  const [deployMode, setDeployMode] = useState(true);
  const [plannedPath, setPlannedPath] = useState<HexCoordinate[] | null>(null);
  const [plannedDestination, setPlannedDestination] = useState<HexCoordinate | null>(null);
  const [pendingAttack, setPendingAttack] = useState<{ id: string; time: number } | null>(null);
  const size = 26;
  const width = Math.max(1100, map.width * size * 2.4);
  const height = Math.max(800, map.height * size * 2.2);
  const processor = useMemo(() => new TurnProcessor(battle.state), [battle.state]);
  const visibleTiles = battle.state.vision.alliance.visibleTiles;
  const exploredTiles = battle.state.vision.alliance.exploredTiles;
  const tileIndex = (coord: HexCoordinate) => coord.r * map.width + coord.q;
  const selectedUnit = selected ? battle.state.sides.alliance.units.get(selected) : undefined;
  const [showRanges, setShowRanges] = useState(false);
  const [attackEffects, setAttackEffects] = useState<AttackEffect[]>([]);

  // Movement animation state
  const [movingUnit, setMovingUnit] = useState<MovingUnit | null>(null);

  // Clean up expired attack effects
  useEffect(() => {
    if (attackEffects.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setAttackEffects(prev => prev.filter(e => now - e.startTime < 500));
    }, 100);
    return () => clearInterval(timer);
  }, [attackEffects.length]);

  // Clean up movement animation when complete
  useEffect(() => {
    if (!movingUnit) return;
    const totalDuration = (movingUnit.path.length - 1) * movingUnit.stepDuration;
    const timer = setTimeout(() => {
      setMovingUnit(null);
    }, totalDuration + 50); // small buffer
    return () => clearTimeout(timer);
  }, [movingUnit]);

  const attackTiles = useMemo(() => {
    if (!selectedUnit) return new Set<string>();
    const best = Object.keys(selectedUnit.stats.weaponRanges)[0];
    if (!best) return new Set<string>();
    const range = selectedUnit.stats.weaponRanges[best] ?? 0;
    const coords = hexWithinRange(selectedUnit.coordinate, range);
    const valid = new Set<string>();
    for (const c of coords) {
      if (!visibleTiles.has(tileIndex(c))) continue;
      valid.add(`${c.q},${c.r}`);
    }
    return valid;
  }, [selectedUnit, visibleTiles, map.width]);
  const globalRangeTiles = useMemo(() => {
    if (!showRanges) return new Set<string>();
    const acc = new Set<string>();
    for (const u of battle.state.sides.alliance.units.values()) {
      if (u.stance === 'destroyed') continue;
      for (const weapon of Object.keys(u.stats.weaponRanges)) {
        const range = u.stats.weaponRanges[weapon] ?? 0;
        for (const coord of hexWithinRange(u.coordinate, range)) {
          acc.add(`${coord.q},${coord.r}`);
        }
      }
    }
    return acc;
  }, [battle.state.sides.alliance.units, showRanges]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDeployMode(true);
    // ensure vision populated immediately so tiles are interactive
    updateAllFactionsVision(battle.state);
    // default select first unit for immediate click-to-move
    const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
    if (first) setSelected(first.id);
    const getTile = (coord: HexCoordinate) => {
      if (coord.q < 0 || coord.q >= map.width || coord.r < 0 || coord.r >= map.height) return undefined;
      return map.tiles[coord.r * map.width + coord.q];
    };
    const computeOccupied = () => {
      const occ = new Set<string>();
      for (const side of Object.values(battle.state.sides)) {
        for (const u of side.units.values()) {
          if (u.stance === 'destroyed') continue;
          occ.add(`${u.coordinate.q},${u.coordinate.r}`);
        }
      }
      return occ;
    };

    (window as any).__battleControl = {
      moveFirst: () => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
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
        const foe = Array.from(battle.state.sides.otherSide.units.values()).find((u) => u.stance !== 'destroyed');
        if (!first || !foe) return false;
        const weapon = Object.keys(first.stats.weaponRanges).sort((a, b) => (first.stats.weaponRanges[b] ?? 0) - (first.stats.weaponRanges[a] ?? 0))[0];
        if (!weapon) return false;
        const proc = new TurnProcessor(battle.state);
        const path = planPathForUnit(battle.state, first.id, foe.coordinate);
        if (path.success && path.path.length) {
          // move up to three steps toward the enemy to get in range
          proc.moveUnit({ unitId: first.id, path: path.path.slice(0, 3) });
        }
        const distNow = Math.max(Math.abs(first.coordinate.q - foe.coordinate.q), Math.abs(first.coordinate.r - foe.coordinate.r));
        if (distNow > (first.stats.weaponRanges[weapon] ?? 0)) return false;
        const res = proc.attackUnit({ attackerId: first.id, defenderId: foe.id, weaponId: weapon });
        persist();
        return res.success;
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
      snapUnit: (unitId: string, q: number, r: number) => {
        for (const side of Object.values(battle.state.sides)) {
          const unit = side.units.get(unitId);
          if (unit) {
            unit.coordinate = { q, r };
            unit.embarkedOn = undefined;
            return true;
          }
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
      wipeEnemies: () => {
        for (const u of battle.state.sides.otherSide.units.values()) {
          u.stance = 'destroyed';
          u.currentHealth = 0;
        }
        return true;
      },
      pixelFor: (q: number, r: number) => hexToPixel({ q, r }, size),
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
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
        if (!first) return { success: false, path: [], cost: 0, reason: 'no_unit' };
        return planPathForUnit(battle.state, first.id, { q, r });
      },
      ammoFirst: () => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
        if (!first) return null;
        return { ammo: first.currentAmmo, cap: first.stats.ammoCapacity ?? null };
      },
      drainAmmo: (amount = 1) => {
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
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
          embarkedOn: u.embarkedOn,
          carrying: u.carrying,
          cap: u.stats.transportCapacity ?? 0
        }));
      },
      enemyUnits: () => {
        return Array.from(battle.state.sides.otherSide.units.values()).map((u) => ({
          id: u.id,
          type: u.unitType,
          coord: u.coordinate,
          ap: u.actionPoints,
          stance: u.stance
        }));
      },
      forceAllianceTurn: () => {
        battle.state.activeFaction = 'alliance';
        for (const u of battle.state.sides.alliance.units.values()) {
          u.actionPoints = u.maxActionPoints;
        }
        updateAllFactionsVision(battle.state);
        return true;
      },
      selectUnit: (unitId?: string) => {
        const target = unitId
          ? battle.state.sides.alliance.units.get(unitId)
          : Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
        if (!target) return false;
        setSelected(target.id);
        return true;
      },
      setOverwatch: (unitId?: string) => {
        const target = unitId
          ? battle.state.sides.alliance.units.get(unitId)
          : Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
        if (!target) return false;
        const proc = new TurnProcessor(battle.state);
        const res = proc.setOverwatch(target.id);
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
      checkVictory: () => {
        const status = evaluateBattleOutcome(battle);
        const enemies = Array.from(battle.state.sides.otherSide.units.values());
        const survivingEnemies = enemies.filter((u) => u.stance !== 'destroyed');
        return { status, totalEnemies: enemies.length, surviving: survivingEnemies.length };
      }
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
  };

  const resolveOutcome = () => {
    const status = evaluateBattleOutcome(battle);
    if (status === 'victory') {
      applyBattleOutcome(campaign, bundle, 'victory');
      persist();
      onVictory();
    } else if (status === 'defeat') {
      applyBattleOutcome(campaign, bundle, 'defeat');
      persist();
      onDefeat();
    }
  };

  const actMove = (unitId: string, target: HexCoordinate) => {
    if (deployMode) return;
    if (movingUnit) return; // Don't start new movement while animating
    const path = planPathForUnit(battle.state, unitId, target);
    if (!path.success || path.cost === undefined || path.path.length === 0) return;

    // Get unit's starting position
    const unit = battle.state.sides.alliance.units.get(unitId);
    if (!unit) return;

    // Play movement sound
    const unitType = (unit as any).unitType;
    if (unitType === 'vehicle') {
      AudioManager.play('tankMove');
    } else {
      AudioManager.play('move');
    }

    // Start movement animation - include starting position
    const fullPath = [{ q: unit.coordinate.q, r: unit.coordinate.r }, ...path.path];
    const stepDuration = unitType === 'vehicle' ? 120 : 180; // vehicles move faster
    setMovingUnit({
      unitId,
      path: fullPath,
      startTime: Date.now(),
      stepDuration
    });

    // Actually move the unit in game state (instant, but we animate visually)
    processor.moveUnit({ unitId, path: path.path });
    setSelected(unitId);
    setPlannedPath(null);
    setPlannedDestination(null);
    persist();
    resolveOutcome();
  };

  const actAttack = (attackerId: string, defender: UnitInstance) => {
    console.log('[Attack] Starting attack - attackerId:', attackerId, 'defender:', defender.id);

    // Exit deploy mode when attacking
    if (deployMode) {
      setDeployMode(false);
      battle.state.activeFaction = 'alliance';
    }

    const attacker = battle.state.sides.alliance.units.get(attackerId);
    if (!attacker) {
      console.log('[Attack] No attacker found:', attackerId);
      AudioManager.play('error');
      return;
    }

    console.log('[Attack] Attacker found:', attacker.id, 'AP:', attacker.actionPoints, 'Ammo:', attacker.currentAmmo);
    console.log('[Attack] Active faction:', battle.state.activeFaction);

    const weapon = bestWeapon(attacker, defender, battle.state.map);
    if (!weapon) {
      console.log('[Attack] No valid weapon for attack - attacker:', attacker.id, 'defender:', defender.id);
      // Try to use any weapon
      const anyWeapon = Object.keys(attacker.stats.weaponRanges)[0];
      if (anyWeapon) {
        console.log('[Attack] Using fallback weapon:', anyWeapon);
        const result = processor.attackUnit({ attackerId, defenderId: defender.id, weaponId: anyWeapon });
        console.log('[Attack] Fallback attack result:', result);

        if (result.success) {
          // Play attack sound only on success
          const unitType = (attacker as any).unitType;
          const effectType = unitType === 'vehicle' ? 'explosion' : 'gunshot';
          AudioManager.play(effectType);
          // Add visual attack effect
          setAttackEffects(prev => [...prev, {
            id: `${attackerId}-${defender.id}-${Date.now()}`,
            fromQ: attacker.coordinate.q,
            fromR: attacker.coordinate.r,
            toQ: defender.coordinate.q,
            toR: defender.coordinate.r,
            startTime: Date.now(),
            type: effectType
          }]);
          // Play hit/death sound based on result
          if (defender.currentHealth <= 0) {
            AudioManager.play('death');
          } else {
            AudioManager.play('hit');
          }
          persist();
          resolveOutcome();
        } else {
          console.error('[Attack] Fallback attack failed:', result.error);
          AudioManager.play('error');
          showToast(result.error || 'Attack failed', 'error');
        }
      }
      return;
    }

    console.log('[Attack] Attacking with weapon:', weapon.weapon);

    const result = processor.attackUnit({ attackerId, defenderId: defender.id, weaponId: weapon.weapon });
    console.log('[Attack] Attack result:', result);

    if (!result.success) {
      console.error('[Attack] Attack failed:', result.error);
      AudioManager.play('error');
      showToast(result.error || 'Attack failed', 'error');
    } else {
      // Play attack sound and effects only on success
      const unitType = (attacker as any).unitType;
      const effectType = unitType === 'vehicle' ? 'explosion' : 'gunshot';
      AudioManager.play(effectType);
      // Add visual attack effect
      setAttackEffects(prev => [...prev, {
        id: `${attackerId}-${defender.id}-${Date.now()}`,
        fromQ: attacker.coordinate.q,
        fromR: attacker.coordinate.r,
        toQ: defender.coordinate.q,
        toR: defender.coordinate.r,
        startTime: Date.now(),
        type: effectType
      }]);
      // Play hit/death sound based on result
      if (defender.currentHealth <= 0) {
        AudioManager.play('death');
      } else {
        AudioManager.play('hit');
      }
    }

    persist();
    resolveOutcome();
  };

  // Track targeted enemy for attack confirmation UI
  const [targetedEnemy, setTargetedEnemy] = useState<UnitInstance | null>(null);

  const handleHexClick = (coord: HexCoordinate) => {
    // Clear targeted enemy when clicking elsewhere
    const foe = Array.from(battle.state.sides.otherSide.units.values()).find(
      (u) => u.coordinate.q === coord.q && u.coordinate.r === coord.r && u.stance !== 'destroyed'
    );
    if (!foe) {
      setTargetedEnemy(null);
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
          // deployment reposition inside start zone
          const occupied = Array.from(battle.state.sides.alliance.units.values()).some(
            (u) => u.id !== selected && u.stance !== 'destroyed' && u.coordinate.q === coord.q && u.coordinate.r === coord.r
          );
          if (occupied) return;
          const unit = battle.state.sides.alliance.units.get(selected);
          if (unit) {
            unit.coordinate = { ...coord };
            updateAllFactionsVision(battle.state);
            persist();
          }
        } else {
          // clicking outside start zone exits deployment and performs a move like classic behavior
          setDeployMode(false);
          battle.state.activeFaction = 'alliance';
          actMove(selected, coord);
        }
      }
      return;
    }
    // If nothing selected or enemy turn, auto-select the first ready ally to allow quick move clicks
    if (!selected || battle.state.activeFaction !== 'alliance') {
      const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
      if (first) setSelected(first.id);
      battle.state.activeFaction = 'alliance';
    }
    const ally = Array.from(battle.state.sides.alliance.units.values()).find(
      (u) => u.coordinate.q === coord.q && u.coordinate.r === coord.r && u.stance !== 'destroyed'
    );
    if (ally) {
      handleSelect(ally);
      return;
    }
    if (foe) {
      // Click on enemy - set as target (will show attack button in UI)
      if (!selected) {
        // Auto-select first unit if none selected
        const first = Array.from(battle.state.sides.alliance.units.values()).find((u) => u.stance !== 'destroyed');
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
      if (!path.success || path.path.length === 0) return;
      const unit = battle.state.sides.alliance.units.get(selected);
      const withOrigin = unit ? [unit.coordinate, ...path.path] : path.path;
      setPlannedPath(withOrigin);
      setPlannedDestination(coord);
    }
  };

  const runAiTurn = () => {
    if (deployMode) return;
    const aiProcessor = new TurnProcessor(battle.state);
    aiProcessor.endTurn(); // player ends, AI starts
    let safety = 0;
    while (battle.state.activeFaction === 'otherSide' && safety < 50) {
      safety += 1;
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
      const action = decideNextAIAction(battle.state, 'otherSide', {
        objectiveTargets,
        holdTargets,
        reachTargets,
        defendBias: true,
        aggression: 0.6,
        avoidTiles: avoid,
        allowDemolition: true,
        difficulty: campaign.turn > 10 ? 'brutal' : campaign.turn > 6 ? 'hard' : 'normal'
      });
      if (action.type === 'endTurn') {
        aiProcessor.endTurn();
        break;
      } else if (action.type === 'move') {
        aiProcessor.moveUnit(action);
      } else if (action.type === 'attack') {
        aiProcessor.attackUnit(action);
      } else if (action.type === 'attackTile') {
        aiProcessor.attackTile({ attackerId: action.unitId, target: action.target, weaponId: action.weaponId });
      }
    }
    persist();
    resolveOutcome();
  };

  return (
    <div className="battle-screen">
      <div className="battle-map-layer">
        <BattlefieldStage
          battleState={battle.state}
          onSelectUnit={(id) => setSelected(id)}
          onSelectTile={(coord) => handleHexClick(coord)}
          selectedUnitId={selected ?? undefined}
          plannedPath={plannedPath ?? undefined}
          plannedDestination={plannedDestination ?? undefined}
          viewerFaction="alliance"
          width={window.innerWidth}
          height={window.innerHeight}
          attackEffects={attackEffects}
          movingUnit={movingUnit}
        />
      </div>

      <div className="battle-ui-layer">
        <div className="battle-top-bar">
          <div className="mission-info">
            <h2>{battle.scenario.name}</h2>
            <p className="muted">{battle.scenario.brief}</p>
          </div>
          <div className="battle-controls">
            <button onClick={() => setShowRanges((v) => !v)} disabled={deployMode}>{showRanges ? 'Hide Ranges' : 'Show Ranges'}</button>
            <OverwatchButton unit={deployMode ? undefined : selectedUnit} onOverwatch={() => {
              if (!selectedUnit || deployMode) return;
              const proc = new TurnProcessor(battle.state);
              proc.setOverwatch(selectedUnit.id);
              persist();
            }} />
            <button
              className={deployMode ? 'primary-btn' : 'end-turn-btn'}
              onClick={() => {
                if (deployMode) {
                  setDeployMode(false);
                  updateAllFactionsVision(battle.state);
                  persist();
                  return;
                }
                runAiTurn();
              }}
            >
              {deployMode ? 'Start Battle' : 'End Turn'}
            </button>
            <button
              className="secondary-btn"
              onClick={() => {
                retreatFromBattle(campaign);
                persist();
                onRetreat();
              }}
            >
              Retreat
            </button>
          </div>
        </div>

        <div className="battle-bottom-bar">
          <div className="unit-card">
            <h3>Selected Unit</h3>
            {selected ? (
              (() => {
                const unit = battle.state.sides.alliance.units.get(selected);
                if (!unit) return <p className="muted">None</p>;
                const carrier = unit.stats.transportCapacity && unit.stats.transportCapacity > 0;
                const embarked = unit.embarkedOn;
                const tile = battle.state.map.tiles[unit.coordinate.r * battle.state.map.width + unit.coordinate.q];
                const def = bundle.units.find(d => d.id === unit.definitionId);
                return (
                  <div className="unit-details">
                    <div className="unit-stats">
                      <strong>{def?.name ?? unit.unitType}</strong>
                      <p>HP <span className={unit.currentHealth < unit.stats.maxHealth * 0.5 ? 'warn' : ''}>{unit.currentHealth}</span>/{unit.stats.maxHealth}</p>
                      <p>AP {unit.actionPoints}/{unit.maxActionPoints}</p>
                      <p>Ammo {unit.stats.ammoCapacity ? `${unit.currentAmmo}/${unit.stats.ammoCapacity}` : '∞'}</p>
                    </div>
                    <div className="unit-status">
                      <p>Morale {unit.currentMorale}</p>
                      <p>Cover {tile?.cover ?? 0}%</p>
                      {unit.statusEffects.has('overwatch') && <span className="badge">Overwatch</span>}
                      {carrier && <p>Cargo {unit.carrying?.length ?? 0}/{unit.stats.transportCapacity}</p>}
                    </div>
                    <div className="unit-actions">
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
                          Embark Adj
                        </button>
                      )}
                      {carrier && (unit.carrying?.length ?? 0) > 0 && (
                        <button
                          className="sm-btn"
                          onClick={() => {
                            const passengerId = unit.carrying?.[0];
                            if (!passengerId) return;
                            const neighbors = hexWithinRange(unit.coordinate, 1).filter(
                              (c) => coordinateKey(c) !== coordinateKey(unit.coordinate)
                            );
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
                          Unload
                        </button>
                      )}
                      {embarked && (
                        <button
                          className="sm-btn"
                          onClick={() => {
                            const carrierUnit = battle.state.sides.alliance.units.get(embarked);
                            if (!carrierUnit) return;
                            const neighbors = hexWithinRange(carrierUnit.coordinate, 1).filter(
                              (c) => coordinateKey(c) !== coordinateKey(carrierUnit.coordinate)
                            );
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
                          Disembark
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <p className="muted">Select a unit to view details</p>
            )}
          </div>

          {/* Target enemy panel with Attack button */}
          {targetedEnemy && selected && (
            <div className="unit-card target-card">
              <h3>⚔ Target Enemy</h3>
              {(() => {
                const attacker = battle.state.sides.alliance.units.get(selected);
                const def = bundle.units.find(d => d.id === targetedEnemy.definitionId);
                const weapon = attacker ? bestWeapon(attacker, targetedEnemy, battle.state.map) : null;
                const distance = attacker ? axialDistance(attacker.coordinate, targetedEnemy.coordinate) : 999;
                return (
                  <div className="unit-details">
                    <div className="unit-stats">
                      <strong style={{ color: '#ef4444' }}>{def?.name ?? targetedEnemy.unitType}</strong>
                      <p>HP {targetedEnemy.currentHealth}/{targetedEnemy.stats.maxHealth}</p>
                      <p>Distance: {distance} hex</p>
                    </div>
                    <div className="unit-status">
                      {weapon ? (
                        <>
                          <p>Hit Chance: {weapon.hit}%</p>
                          <p>Weapon: {weapon.weapon}</p>
                        </>
                      ) : (
                        <p style={{ color: '#ef4444' }}>Out of range!</p>
                      )}
                    </div>
                    <div className="unit-actions">
                      <button
                        className="primary-btn"
                        disabled={!weapon}
                        onClick={() => {
                          actAttack(selected, targetedEnemy);
                          setTargetedEnemy(null);
                        }}
                        style={{
                          background: weapon ? '#22c55e' : '#333',
                          borderColor: weapon ? '#4ade80' : '#555',
                          fontSize: '1.1rem',
                          padding: '0.75rem 2rem'
                        }}
                      >
                        ⚔ ATTACK
                      </button>
                      <button
                        className="sm-btn"
                        onClick={() => setTargetedEnemy(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="battle-log-panel">
            <h3>Combat Log</h3>
            <div className="log-entries">
              {battle.state.timeline.slice(-4).reverse().map((e, idx) => (
                <div key={idx} className="log-line">{(e as any).message ?? JSON.stringify(e)}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function loadAllSummaries(): (SlotSummary | null)[] {
  if (typeof window === 'undefined') return [null, null, null];
  return [1, 2, 3].map((slot) => {
    const saved = window.localStorage.getItem(`${CAMPAIGN_SUMMARY_KEY}:${slot}`);
    if (!saved) return null;
    try {
      const data = JSON.parse(saved);
      return {
        slot,
        turn: data.turn,
        resources: {
          money: data.resources?.money ?? 0,
          research: data.resources?.research ?? 0,
          strategic: data.resources?.strategic ?? 0,
        },
        territories: data.territories ?? 0,
        updated: data.updated ?? 0,
        activeBattle: data.activeBattle ?? false,
      };
    } catch {
      return null;
    }
  });
}

export function App() {
  const { campaign, mutate, persist, reset, slot, changeSlot, summary } = useCampaign();
  const dismissPopups = () => mutate((s) => { s.popups = []; });
  const [mode, setMode] = useState<'menu' | 'strategic' | 'battle'>('menu');
  const [savedSlots, setSavedSlots] = useState<(SlotSummary | null)[]>(() => loadAllSummaries());

  // Reload saved slots when returning to menu
  useEffect(() => {
    if (mode === 'menu') {
      setSavedSlots(loadAllSummaries());
    }
  }, [mode]);

  const startBattle = (territoryId: string) => {
    mutate((state) => {
      startBattleForTerritory(state, bundle, territoryId);
    });
    setMode('battle');
  };

  const handleNewGame = (newSlot: number) => {
    changeSlot(newSlot);
    reset();
    setMode('strategic');
  };

  const handleContinue = (continueSlot: number) => {
    changeSlot(continueSlot);
    setMode('strategic');
  };

  // Show menu
  if (mode === 'menu') {
    return (
      <>
        <ToastContainer />
        <MainMenu
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          savedSlots={savedSlots as any}
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
    .slice(0, 6)
    .map((u) => ({
      id: u.id,
      name: u.name,
      unlocked: isUnitUnlocked(campaign, bundle, u.id),
    }));

  const armyUnits = campaign.army.map((u) => {
    const def = bundle.units.find((d) => d.id === u.definitionId)!;
    return {
      id: u.id,
      definitionId: u.definitionId,
      name: def?.name ?? 'Unknown',
      tier: u.tier,
      currentHealth: u.currentHealth ?? def?.stats.maxHealth ?? 100,
      maxHealth: def?.stats.maxHealth ?? 100,
      experience: u.experience ?? 0,
    };
  });

  const territories = campaign.territories.map((t) => ({
    id: t.id,
    name: t.name,
    brief: t.brief,
    status: t.status,
    remainingTimer: t.remainingTimer,
    mapPosition: t.mapPosition,
    requires: t.requires,
    region: t.region,
    difficulty: t.difficulty,
  }));

  return (
    <>
      <ToastContainer />
      <StrategicHQ
        turn={campaign.turn}
        warClock={campaign.globalTimer}
        money={campaign.resources.money}
        research={campaign.resources.research}
        strategic={campaign.resources.strategic}
        army={armyUnits}
        territories={territories}
        researchTopics={bundle.research}
        currentResearch={campaign.research.inProgress ?? null}
        completedResearch={campaign.research.completed}
        log={campaign.log}
        onStartBattle={startBattle}
        onEndTurn={() => mutate((s) => endStrategicTurn(s, bundle))}
        onRecruit={(id, tier) => mutate((s) => recruitUnit(s, bundle, id, tier))}
        onRefill={(id, tier) => mutate((s) => refillUnit(s, bundle, id, tier))}
        onDismiss={(id) => mutate((s) => dismissUnit(s, id))}
        onResearch={(topic) => {
          mutate((s) => {
            try {
              startResearch(s, bundle, topic);
            } catch (err) {
              console.error(err);
            }
          });
        }}
        onConvertMoney={(amt) => mutate((s) => convertStrategicToMoney(s, amt))}
        onConvertResearch={(amt) => mutate((s) => convertStrategicToResearch(s, amt))}
        onBack={() => setMode('menu')}
        availableUnits={availableUnits}
      />
    </>
  );
}

export default App;
const UnitLabel: React.FC<{ unit: UnitInstance; size: number; name: string }> = ({ unit, size, name }) => {
  const { x, y } = hexToPixel(unit.coordinate, size);
  return (
    <Text
      x={x}
      y={y + size * 0.6}
      text={name}
      anchor={0.5}
      style={new PIXI.TextStyle({
        fontSize: 12,
        fill: 0xf8fafc,
        fontFamily: 'Inter, sans-serif',
        dropShadow: true,
        dropShadowColor: '#000000',
        dropShadowBlur: 2,
        dropShadowDistance: 1
      })}
    />
  );
};
