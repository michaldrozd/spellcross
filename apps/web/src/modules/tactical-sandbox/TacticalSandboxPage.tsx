import { useEffect, useMemo, useRef, useState } from 'react';

import {
  axialDistance,
  canAffordAttack,
  calculateAttackRange,
  calculateHitChance,
  type HexCoordinate,
  type UnitInstance
} from '@spellcross/core';

import { BattlefieldStage } from './components/BattlefieldStage.js';
import { useBattleSimulation } from './useBattleSimulation.js';

import './tactical-sandbox.css';

export function TacticalSandboxPage() {
  const { battleState, endTurn, resetSimulation, executeMove, planPath, previewPath, attackUnit } =
    useBattleSimulation();
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [targetUnitId, setTargetUnitId] = useState<string | null>(null);
  const [plannedPath, setPlannedPath] = useState<HexCoordinate[] | null>(null);
  const [plannedDestination, setPlannedDestination] = useState<HexCoordinate | null>(null);
  const [plannedCost, setPlannedCost] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const unitLookup = useMemo(() => {
    const map = new Map<string, UnitInstance>();
    for (const side of Object.values(battleState.sides)) {
      for (const unit of side.units.values()) {
        map.set(unit.id, unit);
      }
    }
    return map;
  }, [battleState.sides]);

  const playerVision = battleState.vision.alliance;
  const visibleTiles = playerVision.visibleTiles;
  const exploredTiles = playerVision.exploredTiles;

  const selectedUnit = selectedUnitId ? unitLookup.get(selectedUnitId) : undefined;
  const targetUnit = targetUnitId ? unitLookup.get(targetUnitId) : undefined;

  const clearPlan = () => {
    setPlannedPath(null);
    setPlannedDestination(null);
    setPlannedCost(null);
    setActionError(null);
  };

  // Clear selection and any planned actions whenever turn changes
  useEffect(() => {
    clearPlan();
    setSelectedUnitId(null);
    setTargetUnitId(null);
  }, [battleState.activeFaction]);

  // Double-click support
  const lastClickRef = useRef<{ kind: 'tile' | 'unit'; key: string; at: number } | null>(null);
  const dblThresholdMs = 300;

  const handleSelectUnit = (unitId: string) => {
    const unit = unitLookup.get(unitId);
    if (!unit) {
      return;
    }

    if (unit.faction === battleState.activeFaction) {
      // Only allow selecting units that belong to the side whose turn it is
      setSelectedUnitId(unitId);
      setTargetUnitId(null);
      clearPlan();
    } else if (selectedUnitId) {
      // Treat as targeting only if this unit is actually an enemy of the selected unit,
      // not merely "not the active faction" (prevents friendly targeting across turns)
      const selected = unitLookup.get(selectedUnitId);
      if (!selected || unit.faction === selected.faction) {
        return;
      }
      const tileIndex = unit.coordinate.r * battleState.map.width + unit.coordinate.q;
      if (!visibleTiles.has(tileIndex)) {
        return;
      }
      setTargetUnitId(unitId);
      setActionError(null);
    }

    // Double-click to Fire (enemy only, within range & AP)
    const now = Date.now();
    const prev = lastClickRef.current;
    if (prev && prev.kind === 'unit' && prev.key === unitId && now - prev.at <= dblThresholdMs) {
      // Evaluate attack conditions without relying on async state
      const attacker = selectedUnitId ? unitLookup.get(selectedUnitId) : undefined;
      const defender = unitLookup.get(unitId);
      if (!attacker || !defender || attacker.faction !== battleState.activeFaction) {
        setActionError('It is not your turn');
      } else if (defender.faction === attacker.faction) {
        // ignore double click on friendly
      } else {
        const tileIndex = defender.coordinate.r * battleState.map.width + defender.coordinate.q;
        if (!visibleTiles.has(tileIndex)) {
          setActionError('Target not visible');
        } else if (!defaultWeapon) {
          setActionError('No weapon available');
        } else {
          const range = calculateAttackRange(attacker, defaultWeapon, battleState.map);
          const dist = axialDistance(attacker.coordinate, defender.coordinate);
          if (range <= 0 || dist > range) {
            setActionError('Target not in range');
          } else if (!canAffordAttack(attacker)) {
            setActionError('Not enough AP');
          } else {
            const result = attackUnit(attacker.id, defender.id, defaultWeapon);
            if (!result.success) {
              setActionError(result.error ?? 'Attack failed');
            } else {
              setActionError(null);
              setTargetUnitId(null);
            }
          }
        }
      }
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = { kind: 'unit', key: unitId, at: now };
  };

  const handleAdvance = () => {
    if (!selectedUnitId || !plannedPath || !plannedDestination) {
      return;
    }

    const unit = selectedUnit;
    if (!unit) {
      return;
    }

    if (unit.faction !== battleState.activeFaction) {
      setActionError('It is not your turn');
      return;
    }


    const result = executeMove(selectedUnitId, plannedPath);
    if (!result.success) {
      setActionError(result.error ?? 'Movement failed');
      return;
    }

    clearPlan();
  };

  const handleSelectTile = (coordinate: HexCoordinate) => {
    if (!selectedUnitId) {
      return;
    }

    const tileIndex = coordinate.r * battleState.map.width + coordinate.q;
    if (!exploredTiles.has(tileIndex)) {
      setActionError('Tile not yet scouted');
      return;
    }

    const result = planPath(selectedUnitId, coordinate);
    if (result.success) {
      setPlannedPath(result.path);
      setPlannedDestination(coordinate);
      setPlannedCost(result.cost);
      setActionError(null);
    } else {
      // Try a preview that ignores current AP so we can show the cost even if it exceeds AP
      const preview = previewPath(selectedUnitId, coordinate);
      if (preview.success) {
        setPlannedPath(preview.path);
        setPlannedDestination(coordinate);
        setPlannedCost(preview.cost);
        const available = selectedUnit?.actionPoints ?? 0;
        setActionError(`Requires ${preview.cost.toFixed(1)} AP (available ${available})`);
      } else {
        setPlannedPath(null);
        setPlannedDestination(null);
        setPlannedCost(null);
        setActionError(result.reason ?? 'Unreachable');
      }
    }

    // Double-click to Advance (same tile)
    const now = Date.now();
    const key = `${coordinate.q},${coordinate.r}`;
    const prev = lastClickRef.current;
    if (
      prev &&
      prev.kind === 'tile' &&
      prev.key === key &&
      now - prev.at <= dblThresholdMs
    ) {
      const unit = selectedUnitId ? unitLookup.get(selectedUnitId) : undefined;
      if (!unit || unit.faction !== battleState.activeFaction) {
        setActionError('It is not your turn');
      } else {
        // Recompute to avoid async setState timing; only auto-advance if affordable
        const r = planPath(unit.id, coordinate);
        if (!r.success) {
          setActionError(r.reason ?? 'Unreachable');
        } else if (r.cost > unit.actionPoints) {
          setActionError('Not enough AP');
        } else {
          const mv = executeMove(unit.id, r.path);
          if (!mv.success) {
            setActionError(mv.error ?? 'Movement failed');
          } else {
            clearPlan();
          }
        }
      }
      lastClickRef.current = null;
      return;
    }
    lastClickRef.current = { kind: 'tile', key, at: now };
  };

  const handleReset = () => {
    resetSimulation();
    clearPlan();
    setSelectedUnitId(null);
    setTargetUnitId(null);
  };

  const defaultWeapon = useMemo(() => {
    if (!selectedUnit) {
      return null;
    }

    const weapons = Object.keys(selectedUnit.stats.weaponRanges);
    return weapons[0] ?? null;
  }, [selectedUnit]);

  const attackRange = useMemo(() => {
    if (!selectedUnit || !defaultWeapon) {
      return null;
    }
    return calculateAttackRange(selectedUnit, defaultWeapon, battleState.map);
  }, [battleState.map, defaultWeapon, selectedUnit]);

  const distanceToTarget = useMemo(() => {
    if (!selectedUnit || !targetUnit) {
      return null;
    }
    return axialDistance(selectedUnit.coordinate, targetUnit.coordinate);
  }, [selectedUnit, targetUnit]);

  const predictedHitChance = useMemo(() => {
    if (!selectedUnit || !targetUnit || !defaultWeapon) {
      return null;
    }

    return calculateHitChance({
      attacker: selectedUnit,
      defender: targetUnit,
      weaponId: defaultWeapon,
      map: battleState.map
    });
  }, [battleState.map, defaultWeapon, selectedUnit, targetUnit]);

  const canAttack =
    !!selectedUnitId &&
    !!targetUnitId &&
    !!defaultWeapon &&
    !!selectedUnit &&
    // Must be player's turn for the selected unit
    selectedUnit.faction === battleState.activeFaction &&
    // Cannot attack friendlies
    (!!targetUnit && targetUnit.faction !== selectedUnit.faction) &&
    canAffordAttack(selectedUnit) &&
    distanceToTarget !== null &&
    attackRange !== null &&
    distanceToTarget <= attackRange &&
    predictedHitChance !== null &&
    predictedHitChance > 0;

  const handleAttack = () => {
    if (!selectedUnitId || !targetUnitId || !defaultWeapon) {
      return;
    }

    // Extra runtime guard (UI should disable out of turn already)
    if (!selectedUnit || selectedUnit.faction !== battleState.activeFaction) {
      setActionError('It is not your turn');
      return;
    }

    if (!!targetUnit && targetUnit.faction === selectedUnit.faction) {
      setActionError('Cannot attack friendly unit');
      return;
    }

    if (!canAttack) {
      setActionError('Target not in range');
      return;
    }

    const result = attackUnit(selectedUnitId, targetUnitId, defaultWeapon);
    if (!result.success) {
      setActionError(result.error ?? 'Attack failed');
      return;
    }

    setActionError(null);
    setTargetUnitId(null);
  };

  const timelineEntries = useMemo(() => {
    const formatUnitLabel = (unitId: string) => {
      const unit = unitLookup.get(unitId);
      if (!unit) {
        return unitId;
      }
      return `${unit.definitionId}`;
    };

    return battleState.timeline
      .slice(-8)
      .map((event, index) => ({ event, key: `${event.kind}-${index}` }))
      .map(({ event, key }) => {
        const ev: any = event;
        switch (ev.kind) {
          case 'unit:moved':
            return {
              key,
              text: `${formatUnitLabel(ev.unitId)} moved (${ev.cost.toFixed(1)} AP)`
            };
          case 'unit:attacked': {
            const hitText = ev.hit ? `hit for ${ev.damage}` : 'missed';
            const chanceText =
              typeof ev.hitChance === 'number'
                ? `Chance ${(ev.hitChance * 100).toFixed(0)}%, roll ${(ev.roll * 100).toFixed(0)}%`
                : '';
            return {
              key,
              text: `${formatUnitLabel(ev.attackerId)} attacked ${formatUnitLabel(ev.defenderId)} (${ev.weapon}) and ${hitText}${
                chanceText ? ` · ${chanceText}` : ''
              }`
            };
          }
          case 'unit:defeated':
            return {
              key,
              text: `${formatUnitLabel(ev.unitId)} destroyed by ${formatUnitLabel(ev.by)}`
            };
          case 'round:started':
            return {
              key,
              text: `Round ${ev.round} – ${ev.activeFaction} acting`
            };
          case 'tile:destroyed':
            return {
              key,
              text: `Tile (${ev.at.q},${ev.at.r}) destroyed`
            };
          case 'unit:xp':
            return {
              key,
              text: `${formatUnitLabel(ev.unitId)} +${ev.amount} XP (${ev.reason})`
            };
          case 'unit:level':
            return {
              key,
              text: `${formatUnitLabel(ev.unitId)} reached level ${ev.level}`
            };
          default:
            return {
              key,
              text: ev.kind ?? 'event'
            };
        }
      });
  }, [battleState.timeline, unitLookup]);

  // Hotkeys: E=end turn, A=advance (if planned and affordable), F=hold to preview attack range; release to fire
  const [attackKeyHeld, setAttackKeyHeld] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'e' || e.key === 'E') {
        endTurn();
        clearPlan();
        setSelectedUnitId(null);
        setTargetUnitId(null);
      } else if ((e.key === 'a' || e.key === 'A') && plannedDestination && plannedPath && selectedUnit) {
        const affordable = plannedCost !== null ? plannedCost <= selectedUnit.actionPoints : false;
        if (affordable) {
          handleAdvance();
        }
      } else if (e.key === 'f' || e.key === 'F') {
        setAttackKeyHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        setAttackKeyHeld(false);
        if (canAttack) {
          handleAttack();
        }
      }
    };
    const onBlur = () => setAttackKeyHeld(false);
    const onVisibility = () => { if (document.visibilityState !== 'visible') setAttackKeyHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canAttack, endTurn, plannedCost, plannedDestination, plannedPath, selectedUnit]);
  const [fireHover, setFireHover] = useState(false);


  const [showHotkeys, setShowHotkeys] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        setShowHotkeys((s) => !s);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setShowHotkeys(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Measure the left viewport area to size the Stage responsively
  const viewportRef = useRef<HTMLElement | null>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (!viewportRef.current) return;
    const el = viewportRef.current;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setViewportSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setViewportSize({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, []);

  // Camera/view controls
  const [cameraMode, setCameraMode] = useState<'fit' | 'follow'>('follow');

  return (
    <div className="sandboxLayout">
      <header className="sandboxHeader">
        <h1>Spellcross Tactical Sandbox (responsive)</h1>
        <div className="sandboxActions">
          <button
            onClick={() => {
              endTurn();
              clearPlan();
              setSelectedUnitId(null);
              setTargetUnitId(null);
            }}
          >
            End Turn
          </button>
          <button onClick={handleReset}>Reset</button>
          <button
            onClick={() => setShowHotkeys(true)}
            title="Hotkeys (?)"
          >
            Hotkeys
          </button>
          <button
            onClick={() => setCameraMode((m) => (m === 'fit' ? 'follow' : 'fit'))}
            title={cameraMode === 'follow' ? 'Switch to Fit to View' : 'Switch to Follow'}
          >
            View: {cameraMode === 'follow' ? 'Follow' : 'Fit'}
          </button>
        </div>
      </header>
      <main className="sandboxContent">
        <section className="sandboxViewport" ref={viewportRef as any}>
          <BattlefieldStage
            battleState={battleState}
            onSelectUnit={handleSelectUnit}
            onSelectTile={handleSelectTile}
            showAttackOverlay={Boolean(selectedUnit && (fireHover || attackKeyHeld))}
            selectedUnitId={selectedUnitId ?? undefined}
            plannedPath={plannedPath ?? undefined}
            plannedDestination={plannedDestination ?? undefined}
            targetUnitId={targetUnitId ?? undefined}
            viewerFaction="alliance"
            width={viewportSize.w}
            height={viewportSize.h}
            cameraMode={cameraMode}
          />
        </section>
        <aside className="sandboxSidebar">
          <section>
            <h2>Selected Unit</h2>
            {selectedUnit ? (
              <div className="unitDetails">
                <div className="unitLabel">{selectedUnit.definitionId}</div>

                {/* AP row */}
                <div className="statRow">
                  <div className="statLabel"><span className="statIcon ap" title="Action Points">⚡</span> AP</div>
                  <div className="statBar">
                    <div
                      className="statFill ap"
                      style={{ width: `${Math.max(0, Math.min(1, selectedUnit.actionPoints / selectedUnit.maxActionPoints)) * 100}%` }}
                    />
                  </div>
                  <div className="statValue">
                    {selectedUnit.actionPoints} / {selectedUnit.maxActionPoints} · Shots {Math.floor(selectedUnit.actionPoints / 2)}
                  </div>
                </div>

                {/* HP row */}
                <div className="statRow">
                  <div className="statLabel"><span className="statIcon hp" title="Health">❤</span> HP</div>
                  <div className="statBar">
                    <div
                      className="statFill hp"
                      style={{ width: `${Math.max(0, Math.min(1, selectedUnit.currentHealth / (selectedUnit.stats?.maxHealth ?? 100))) * 100}%` }}
                    />
                  </div>
                  <div className="statValue">
                    {selectedUnit.currentHealth} / {selectedUnit.stats?.maxHealth ?? 100}
                  </div>
                </div>

                {/* Morale row */}
                <div className="statRow">
                  <div className="statLabel"><span className="statIcon mor" title="Morale">🎖</span> MR</div>
                  <div className="statBar">
                    <div
                      className="statFill mor"
                      style={{ width: `${Math.max(0, Math.min(1, selectedUnit.currentMorale / 100)) * 100}%` }}
                    />
                  </div>
                  <div className="statValue">{selectedUnit.currentMorale} / 100</div>
                </div>

                <div>Stance: {selectedUnit.stance}</div>
                <div>Entrench: {(selectedUnit as any).entrench ?? 0}</div>
                <div>Level: {(selectedUnit as any).level ?? 1} · XP: {selectedUnit.experience}</div>
                <div>Position: {selectedUnit.coordinate.q}, {selectedUnit.coordinate.r}</div>

                {plannedCost !== null && plannedDestination ? (
                  <div className="plannedSummary">
                    Planned move to ({plannedDestination.q}, {plannedDestination.r}) – Cost: {plannedCost.toFixed(1)} / {selectedUnit.maxActionPoints}
                  </div>
                ) : (
                  <div className="plannedSummary muted">Select a tile to preview movement.</div>
                )}

                {targetUnit ? (
                  <div className="targetSummary">
                    Target: {targetUnit.definitionId}{' '}
                    {distanceToTarget !== null && attackRange !== null ? `(range ${distanceToTarget}/${attackRange})` : ''}
                    {predictedHitChance !== null ? ` · ${(predictedHitChance * 100).toFixed(0)}% hit` : ''}
                  </div>
                ) : (
                  <div className="targetSummary muted">Select an enemy to target.</div>
                )}

                {actionError && <div className="planError">{actionError}</div>}

                <div className="hudDivider" />

                <div className="unitActionsRow">
                  <button
                    className="unitAction"
                    onClick={handleAdvance}
                    onDoubleClick={handleAdvance}
                    disabled={
                      !plannedDestination ||
                      plannedPath === null ||
                      !selectedUnit ||
                      selectedUnit.faction !== battleState.activeFaction ||
                      (plannedCost !== null && selectedUnit && plannedCost > selectedUnit.actionPoints)
                    }
                  >
                    Advance
                  </button>
                  <button
                    className="unitAction"
                    onClick={handleAttack}
                    onDoubleClick={handleAttack}
                    onMouseEnter={() => setFireHover(true)}
                    onMouseLeave={() => setFireHover(false)}
                    disabled={!canAttack}
                  >
                    Fire
                  </button>
                </div>
              </div>
            ) : (
              <p>No unit selected</p>
            )}
          </section>
          <section>
            <h2>Combat Log</h2>
            <ul>
              {timelineEntries.map((entry) => (
                <li key={entry.key}>{entry.text}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Help</h2>
            <ul>
              <li>Hold F — preview attack range; release to fire (if a valid target is selected)</li>
              <li>Hover Fire — preview attack range</li>
              <li>Click a hex with your unit — select that unit</li>
              <li>Double‑click a hex — quick Advance (if the path is affordable)</li>

              <li>Double‑click an enemy — quick Fire (if in range and enough AP)</li>
              <li>A — Advance planned path (if affordable)</li>
              <li>E — End Turn</li>
              <li>? or H — open Hotkeys</li>
            </ul>
          </section>

          <section>
            <h2>Legend</h2>
            <ul>
              <li>Movement: light blue = can still attack; dark blue = max move only</li>
              <li>Attack: orange = attack range; golden ring = range boundary</li>
              <li>Selection/Target: green ring = selected; red ring = target</li>
            </ul>
          </section>

        </aside>

      {showHotkeys && (
        <div className="hotkeysOverlay" onClick={() => setShowHotkeys(false)}>
          <div className="hotkeysModal" onClick={(e) => e.stopPropagation()}>
            <h3>Hotkeys & Tips</h3>
            <ul className="hotkeysList">

              <li><strong>F (hold)</strong> — Preview attack range; release to fire (if a valid target is selected)</li>
              <li><strong>Hover Fire</strong> — Preview attack range</li>
              <li><strong>Click a hex with your unit</strong> — Select that unit</li>
              <li><strong>Double‑click a hex</strong> — Quick Advance (if the path is affordable)</li>
              <li><strong>Double‑click an enemy</strong> — Quick Fire (if in range and enough AP)</li>
              <li><strong>A</strong> — Advance planned path (if affordable)</li>
              <li><strong>E</strong> — End Turn</li>
              <li><strong>?</strong> or <strong>H</strong> — Toggle this dialog</li>
            </ul>
            <h4>Legend</h4>
            <ul className="hotkeysList">
              <li>Movement: light blue = can still attack; dark blue = max move only</li>
              <li>Attack: orange = attack range; golden ring = range boundary</li>
              <li>Selection/Target: green ring = selected; red ring = target</li>
            </ul>
            <div className="hotkeysFooter">
              <button onClick={() => setShowHotkeys(false)}>Close (Esc)</button>
            </div>
          </div>
        </div>
      )}

      </main>
    </div>
  );
}
