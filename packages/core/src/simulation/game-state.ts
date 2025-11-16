import { nanoid } from 'nanoid';

import type {
  BattlefieldMap,
  FactionId,
  HexCoordinate,
  TacticalBattleState,
  UnitDefinition,
  UnitInstance
} from './types.js';
import { coordinateKey, isWithinBounds } from './utils/grid.js';
import { updateAllFactionsVision } from './visibility/vision.js';

export interface CreateBattleStateOptions {
  map: BattlefieldMap;
  sides: Array<{
    faction: FactionId;
    units: Array<{ definition: UnitDefinition; coordinate: HexCoordinate }>;
  }>;
  startingFaction?: FactionId;
}

/**
 * Creates a minimal tactical battle state for sandbox simulations.
 */
export function createBattleState(options: CreateBattleStateOptions): TacticalBattleState {
  const { map, sides, startingFaction } = options;
  const sideStates = new Map<FactionId, TacticalBattleState['sides'][FactionId]>();
  const occupied = new Set<string>();

  for (const side of sides) {
    const units = new Map<string, UnitInstance>();
    for (const unitSpec of side.units) {
      if (!isWithinBounds(map, unitSpec.coordinate)) {
        throw new Error(`Unit ${unitSpec.definition.id} spawn out of bounds at ${JSON.stringify(unitSpec.coordinate)}`);
      }
      const key = coordinateKey(unitSpec.coordinate);
      if (occupied.has(key)) {
        throw new Error(`Spawn collision: multiple units assigned to tile ${key}`);
      }
      occupied.add(key);

      const id = `${unitSpec.definition.id}-${nanoid(8)}`;
      units.set(id, {
        id,
        definitionId: unitSpec.definition.id,
        unitType: unitSpec.definition.type,
        faction: side.faction,
        coordinate: unitSpec.coordinate,
        orientation: 0,
        currentHealth: unitSpec.definition.stats.maxHealth,
        currentMorale: unitSpec.definition.stats.morale,
        maxActionPoints: unitSpec.definition.stats.mobility,
        actionPoints: unitSpec.definition.stats.mobility,
        stats: unitSpec.definition.stats,
        stance: 'ready',
        experience: 0,
        level: 1,
        statusEffects: new Set(),
        entrench: 0,
        movedThisRound: false
      });
    }

    sideStates.set(side.faction, {
      faction: side.faction,
      units,
      initiative: 0
    });
  }

  const [firstSide] = sides;
  const activeFaction = startingFaction ?? firstSide?.faction ?? 'alliance';

  const battleState: TacticalBattleState = {
    map,
    sides: Object.fromEntries(sideStates) as TacticalBattleState['sides'],
    round: 1,
    activeFaction,
    vision: {
      alliance: {
        width: map.width,
        height: map.height,
        visibleTiles: new Set(),
        exploredTiles: new Set()
      },
      otherSide: {
        width: map.width,
        height: map.height,
        visibleTiles: new Set(),
        exploredTiles: new Set()
      }
    },
    timeline: []
  };

  updateAllFactionsVision(battleState);

  return battleState;
}
