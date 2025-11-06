import { useCallback, useMemo, useState } from 'react';

import {
  createBattleState,
  planPathForUnit,
  TurnProcessor,
  type HexCoordinate,
  type PathResult,
  type TacticalBattleState
} from '@spellcross/core';

import { sandboxBattleSpec } from './sample-data.js';

export function useBattleSimulation() {
  const [battleState, setBattleState] = useState<TacticalBattleState>(() =>
    createBattleState(sandboxBattleSpec)
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
    setBattleState(createBattleState(sandboxBattleSpec));
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

  return {
    battleState,
    turnProcessor,
    endTurn,
    resetSimulation,
    executeMove,
    planPath,
    attackUnit
  };
}
