import { nanoid } from 'nanoid';

import type {
  BattlefieldMap,
  FactionId,
  HexCoordinate,
  TacticalBattleState,
  UnitDefinition,
  UnitInstance
} from './types.js';
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

  for (const side of sides) {
    const units = new Map<string, UnitInstance>();
    for (const unitSpec of side.units) {
      const id = `${unitSpec.definition.id}-${nanoid(8)}`;
      units.set(id, {
        id,
        definitionId: unitSpec.definition.id,
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
        statusEffects: new Set()
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
