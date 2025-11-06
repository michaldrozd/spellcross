import { useMemo, useState } from 'react';

import {
  axialDistance,
  canAffordAttack,
  calculateHitChance,
  type HexCoordinate,
  type UnitInstance
} from '@spellcross/core';

import { BattlefieldStage } from './components/BattlefieldStage.js';
import { useBattleSimulation } from './useBattleSimulation.js';

import './tactical-sandbox.css';

export function TacticalSandboxPage() {
  const { battleState, endTurn, resetSimulation, executeMove, planPath, attackUnit } =
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

  const handleSelectUnit = (unitId: string) => {
    const unit = unitLookup.get(unitId);
    if (!unit) {
      return;
    }

    if (unit.faction === battleState.activeFaction) {
      setSelectedUnitId(unitId);
      setTargetUnitId(null);
      clearPlan();
    } else if (selectedUnitId) {
      const tileIndex = unit.coordinate.r * battleState.map.width + unit.coordinate.q;
      if (!visibleTiles.has(tileIndex)) {
        return;
      }
      setTargetUnitId(unitId);
      setActionError(null);
    }
  };

  const handleAdvance = () => {
    if (!selectedUnitId || !plannedPath || !plannedDestination) {
      return;
    }

    const unit = selectedUnit;
    if (!unit) {
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
      setPlannedPath(null);
      setPlannedDestination(null);
      setPlannedCost(null);
      setActionError(result.reason ?? 'Unreachable');
    }
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
    return selectedUnit.stats.weaponRanges[defaultWeapon];
  }, [defaultWeapon, selectedUnit]);

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
        switch (event.kind) {
          case 'unit:moved':
            return {
              key,
              text: `${formatUnitLabel(event.unitId)} moved (${event.cost.toFixed(1)} AP)`
            };
          case 'unit:attacked': {
            const hitText = event.hit ? `hit for ${event.damage}` : 'missed';
            const chanceText =
              typeof event.hitChance === 'number'
                ? `Chance ${(event.hitChance * 100).toFixed(0)}%, roll ${(event.roll * 100).toFixed(0)}%`
                : '';
            return {
              key,
              text: `${formatUnitLabel(event.attackerId)} attacked ${formatUnitLabel(event.defenderId)} (${event.weapon}) and ${hitText}${
                chanceText ? ` · ${chanceText}` : ''
              }`
            };
          }
          case 'unit:defeated':
            return {
              key,
              text: `${formatUnitLabel(event.unitId)} destroyed by ${formatUnitLabel(event.by)}`
            };
          case 'round:started':
            return {
              key,
              text: `Round ${event.round} – ${event.activeFaction} acting`
            };
          default:
            return {
              key,
              text: (event as any).kind ?? 'event'
            };
        }
      });
  }, [battleState.timeline, unitLookup]);

  return (
    <div className="sandboxLayout">
      <header className="sandboxHeader">
        <h1>Spellcross Tactical Sandbox</h1>
        <div className="sandboxActions">
          <button onClick={endTurn}>End Turn</button>
          <button onClick={handleReset}>Reset</button>
        </div>
      </header>
      <main className="sandboxContent">
        <section className="sandboxViewport">
          <BattlefieldStage
            battleState={battleState}
            onSelectUnit={handleSelectUnit}
            onSelectTile={handleSelectTile}
            selectedUnitId={selectedUnitId ?? undefined}
            plannedPath={plannedPath ?? undefined}
            plannedDestination={plannedDestination ?? undefined}
            targetUnitId={targetUnitId ?? undefined}
            viewerFaction="alliance"
          />
        </section>
        <aside className="sandboxSidebar">
          <section>
            <h2>Selected Unit</h2>
            {selectedUnit ? (
              <div className="unitDetails">
                <div className="unitLabel">{selectedUnit.definitionId}</div>
                <div>AP: {selectedUnit.actionPoints}</div>
                <div>HP: {selectedUnit.currentHealth}</div>
                <div>Morale: {selectedUnit.currentMorale}</div>
                <div>
                  Position: {selectedUnit.coordinate.q}, {selectedUnit.coordinate.r}
                </div>
                {plannedCost !== null && plannedDestination ? (
                  <div className="plannedSummary">
                    Planned move to ({plannedDestination.q}, {plannedDestination.r}) – Cost:{' '}
                    {plannedCost.toFixed(1)} / {selectedUnit.maxActionPoints}
                  </div>
                ) : (
                  <div className="plannedSummary muted">Select a tile to preview movement.</div>
                )}
                {targetUnit ? (
                  <div className="targetSummary">
                    Target: {targetUnit.definitionId}{' '}
                    {distanceToTarget !== null && attackRange !== null
                      ? `(range ${distanceToTarget}/${attackRange})`
                      : ''}
                    {predictedHitChance !== null
                      ? ` · ${(predictedHitChance * 100).toFixed(0)}% hit`
                      : ''}
                  </div>
                ) : (
                  <div className="targetSummary muted">Select an enemy to target.</div>
                )}
                {actionError && <div className="planError">{actionError}</div>}
                <div className="unitActionsRow">
                  <button
                    className="unitAction"
                    onClick={handleAdvance}
                    disabled={!plannedDestination || plannedPath === null}
                  >
                    Advance
                  </button>
                  <button
                    className="unitAction"
                    onClick={handleAttack}
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
        </aside>
      </main>
    </div>
  );
}
