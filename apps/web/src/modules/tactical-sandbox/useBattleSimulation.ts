import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createBattleState,
  planPathForUnit,
  findPathOnMap,
  movementMultiplierForStance,
  TurnProcessor,
  decideNextAIAction,
  type HexCoordinate,
  type PathResult,
  type TacticalBattleState
} from '@spellcross/core';

import { makeSandboxSpec, makeMegaSandboxSpec, makeLargeSandboxSpec } from './sample-data.js';

function getSpecFromQuery() {
  let width: number | undefined;
  let height: number | undefined;
  let preset: string | undefined;
  if (typeof window !== 'undefined') {
    const qs = new URLSearchParams(window.location.search);
    const wStr = qs.get('width');
    const hStr = qs.get('height');
    width = wStr ? parseInt(wStr, 10) : undefined;
    height = hStr ? parseInt(hStr, 10) : undefined;
    preset =
      qs.get('preset') ??
      (qs.get('mega') ? 'mega' : undefined) ??
      (qs.get('large') ? 'large' : undefined);
  }
  if (preset === 'mega') return makeMegaSandboxSpec({ width, height });
  if (preset === 'large') return makeLargeSandboxSpec({ width, height });
  return makeSandboxSpec({ width, height });
}

function isAIDisabled() {
  if (typeof window === 'undefined') return false;
  const qs = new URLSearchParams(window.location.search);
  return qs.get('noai') === '1' || qs.get('ai') === 'off';
}

export function useBattleSimulation() {
  const [battleState, setBattleState] = useState<TacticalBattleState>(() =>
    createBattleState(getSpecFromQuery())
  );

  const turnProcessor = useMemo(() => new TurnProcessor(battleState), [battleState]);

  const syncState = useCallback(() => {
    const current = turnProcessor.state;
    const clonedSides = Object.fromEntries(
      Object.entries(current.sides).map(([faction, side]) => [
        faction,
        {
          ...side,
          units: new Map(side.units)
        }
      ])
    ) as typeof current.sides;

    const clonedVision = Object.fromEntries(
      Object.entries(current.vision).map(([faction, vision]) => [
        faction,
        {
          ...vision,
          visibleTiles: new Set(vision.visibleTiles),
          exploredTiles: new Set(vision.exploredTiles)
        }
      ])
    ) as typeof current.vision;

    setBattleState({
      ...current,
      sides: clonedSides,
      vision: clonedVision,
      timeline: [...current.timeline]
    });
  }, [turnProcessor]);

  const resetSimulation = useCallback(() => {
    setBattleState(createBattleState(getSpecFromQuery()));
  }, []);

  const executeMove = useCallback(
    (unitId: string, path: Array<{ q: number; r: number }>) => {
      const result = turnProcessor.moveUnit({ unitId, path });
      if (result.success) {
        syncState();
      }
      return result;
    },
    [syncState, turnProcessor]
  );

  const endTurn = useCallback(() => {
    turnProcessor.endTurn();
    syncState();
  }, [syncState, turnProcessor]);

  const planPath = useCallback(
    (unitId: string, destination: HexCoordinate): PathResult => {
      return planPathForUnit(battleState, unitId, destination);
    },
    [battleState]
  );

  // Preview path cost ignoring current AP (still respects terrain, occupancy, stance)
  const previewPath = useCallback(
    (unitId: string, destination: HexCoordinate): PathResult => {
      // Locate unit across sides
      const unit =
        battleState.sides.alliance.units.get(unitId) ??
        battleState.sides.otherSide.units.get(unitId);
      if (!unit) {
        return { success: false, path: [], cost: 0, reason: 'unit_not_found' };
      }

      // Build occupation set excluding the moving unit and destroyed ones
      const occupied = new Set<string>();
      for (const side of Object.values(battleState.sides)) {
        for (const other of side.units.values()) {
          if (other.id === unit.id || other.stance === 'destroyed') continue;
          occupied.add(`${other.coordinate.q},${other.coordinate.r}`);
        }
      }

      const movementMultiplier = movementMultiplierForStance(unit.stance);

      return findPathOnMap(battleState.map, unit.coordinate, destination, {
        occupied,
        ignoreCoordinates: new Set([`${unit.coordinate.q},${unit.coordinate.r}`]),
        movementMultiplier,
        maxCost: Number.POSITIVE_INFINITY,
        unitType: unit.unitType
      });
    },
    [battleState]
  );

  const attackUnit = useCallback(
    (attackerId: string, defenderId: string, weaponId: string) => {
      const result = turnProcessor.attackUnit({ attackerId, defenderId, weaponId });
      if (result.success) {
        syncState();
      }
      return result;
    },
    [syncState, turnProcessor]
  );

  // --- Simple AI runner: plays automatically for 'otherSide' unless disabled ---
  const aiRunningRef = useRef(false);
  const aiActionCountRef = useRef(0);
  const aiFailStreakRef = useRef(0);
  useEffect(() => {
    if (isAIDisabled()) return;
    if (battleState.activeFaction !== 'otherSide') return;
    if (aiRunningRef.current) return;
    aiRunningRef.current = true;
    aiActionCountRef.current = 0;
    aiFailStreakRef.current = 0;

    const hardEndTurn = () => {
      turnProcessor.endTurn();
      syncState();
      aiRunningRef.current = false;
    };

    const step = () => {
      // safety: avoid infinite loops
      if (aiActionCountRef.current >= 80) {
        console.warn('[AI] Action budget exceeded, forcing endTurn to avoid stall');
        return hardEndTurn();
      }

      const act = decideNextAIAction(turnProcessor.state, 'otherSide');
      if (act.type === 'move') {
        aiActionCountRef.current += 1;
        const res = executeMove(act.unitId, act.path);
        if (!res.success) {
          aiFailStreakRef.current += 1;
          if (aiFailStreakRef.current >= 3) return hardEndTurn();
        } else {
          aiFailStreakRef.current = 0;
        }
        setTimeout(step, 140);
      } else if (act.type === 'attack') {
        aiActionCountRef.current += 1;
        const res = attackUnit(act.attackerId, act.defenderId, act.weaponId);
        if (!res.success) {
          aiFailStreakRef.current += 1;
          if (aiFailStreakRef.current >= 3) return hardEndTurn();
        } else {
          aiFailStreakRef.current = 0;
        }
        setTimeout(step, 140);
      } else {
        return hardEndTurn();
      }
    };

    // start after a tiny delay so UI can render state switch
    const t = setTimeout(step, 200);
    return () => clearTimeout(t);
  }, [battleState.activeFaction, syncState, turnProcessor, executeMove, attackUnit]);

  return {
    battleState,
    turnProcessor,
    endTurn,
    resetSimulation,
    executeMove,
    planPath,
    previewPath,
    attackUnit
  };
}
