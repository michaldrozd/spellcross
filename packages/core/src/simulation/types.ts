export type FactionId = 'alliance' | 'otherSide';

export type TerrainType =
  | 'plain'
  | 'road'
  | 'forest'
  | 'urban'
  | 'hill'
  | 'water'
  | 'swamp'
  | 'structure';

export interface HexCoordinate {
  q: number;
  r: number;
}

export interface MapTile {
  terrain: TerrainType;
  elevation: number;
  cover: number;
  movementCostModifier: number;
  passable: boolean;
  providesVisionBoost: boolean;
}

export interface BattlefieldMap {
  id: string;
  width: number;
  height: number;
  tiles: MapTile[];
}

export type UnitStance = 'ready' | 'suppressed' | 'routed' | 'destroyed';

export interface UnitStats {
  maxHealth: number;
  mobility: number;
  vision: number;
  weaponRanges: Record<string, number>;
  weaponPower: Record<string, number>;
  weaponAccuracy: Record<string, number>;
  armor: number;
  morale: number;
}

export interface UnitDefinition {
  id: string;
  faction: FactionId;
  name: string;
  type: 'infantry' | 'vehicle' | 'air' | 'artillery' | 'support' | 'hero';
  stats: UnitStats;
}

export interface UnitInstance {
  id: string;
  definitionId: UnitDefinition['id'];
  faction: FactionId;
  coordinate: HexCoordinate;
  orientation: number;
  currentHealth: number;
  currentMorale: number;
  maxActionPoints: number;
  actionPoints: number;
  stats: UnitStats;
  stance: UnitStance;
  experience: number;
  statusEffects: Set<string>;
}

export interface SideState {
  faction: FactionId;
  units: Map<string, UnitInstance>;
  initiative: number;
}

export interface VisionGrid {
  width: number;
  height: number;
  visibleTiles: Set<number>;
  exploredTiles: Set<number>;
}

export interface TacticalBattleState {
  map: BattlefieldMap;
  sides: Record<FactionId, SideState>;
  round: number;
  activeFaction: FactionId;
  vision: Record<FactionId, VisionGrid>;
  timeline: BattleEvent[];
}

export type BattleEvent =
  | {
      kind: 'round:started';
      round: number;
      activeFaction: FactionId;
    }
  | {
      kind: 'unit:moved';
      unitId: string;
      from: HexCoordinate;
      to: HexCoordinate;
      cost: number;
    }
  | {
      kind: 'unit:attacked';
      attackerId: string;
      defenderId: string;
      damage: number;
      moraleDamage: number;
      weapon: string;
      hit: boolean;
      hitChance: number;
      roll: number;
      defenderRemainingHealth: number;
      defenderRemainingMorale: number;
    }
  | {
      kind: 'unit:defeated';
      unitId: string;
      by: string;
    };

export interface ResolveAttackInput {
  attacker: UnitInstance;
  defender: UnitInstance;
  weaponId: string;
  map: BattlefieldMap;
}

export interface AttackResolution {
  damage: number;
  moraleDamage: number;
  events: BattleEvent[];
}
