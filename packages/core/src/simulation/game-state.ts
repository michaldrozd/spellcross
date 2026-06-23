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
  supplyZones?: Partial<Record<FactionId, HexCoordinate[]>>;
  pickups?: Array<{ coordinate: HexCoordinate; kind: 'ammo'; amount: number }>;
  weather?: 'clear' | 'night' | 'fog';
}

/**
 * Creates a minimal tactical battle state for sandbox simulations.
 */
export function createBattleState(options: CreateBattleStateOptions): TacticalBattleState {
  const { sides, startingFaction } = options;
  // Deep-copy the map tiles so in-battle mutation (destructible terrain losing hp) never leaks into the
  // shared scenario/bundle map — several scenarios reuse the same map singleton.
  const map: BattlefieldMap = { ...options.map, tiles: options.map.tiles.map((t) => ({ ...t })) };
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
        // Clone stats so battle-time tweaks (e.g. night/fog vision penalty) never mutate the shared bundle def.
        stats: structuredClone(unitSpec.definition.stats),
        currentAmmo: unitSpec.definition.stats.ammoCapacity ?? Infinity,
        stance: 'ready',
        experience: 0,
        level: 1,
        statusEffects: new Set(),
        carrying: [],
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
    weather: options.weather ?? (map as any).weather ?? 'clear',
    supplyZones: options.supplyZones,
    pickups: options.pickups?.map((p) => ({ ...p, picked: false })),
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
