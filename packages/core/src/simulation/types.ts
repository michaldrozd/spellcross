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

export type BattlefieldEnvironment =
  | 'urban'
  | 'industrial'
  | 'river'
  | 'forest'
  | 'alpine'
  | 'canal'
  | 'coast'
  | 'oldtown'
  | 'ruins'
  | 'rift';

export interface HexCoordinate {
  q: number;
  r: number;
}

export type EdgeDir = 'N' | 'E' | 'S' | 'W';
export type ElevEdgeStyle = 'wall' | 'slope' | 'none';

export type PropKind = 'tree' | 'rock' | 'bush' | 'proc-building';

export interface MapPropFacadeStyle {
  material?: 'plaster' | 'brick' | 'concrete' | 'metal' | 'wood';
  baseColor?: number;
  trimColor?: number;
  accentColor?: number;
  grime?: number;
}

export interface MapPropWindows {
  rows?: number;
  cols?: number;
  marginH?: number;
  marginV?: number;
  widthPx?: number;
  heightPx?: number;
  spacingH?: number;
  spacingV?: number;
  frameColor?: number;
  glassColor?: number;
  emissive?: number;
  sides?: EdgeDir[];
}

export interface MapPropDoor {
  side: EdgeDir;
  offset?: number;
  widthPx?: number;
  heightPx?: number;
  color?: number;
  kind?: 'single' | 'double' | 'roller';
}

export interface MapPropRoofDetails {
  overhangPx?: number;
  trimColor?: number;
  ridgeCap?: boolean;
  ventCount?: number;
}

export interface MapProp {
  id: string;
  kind: PropKind;
  coordinate: HexCoordinate;
  u?: number;
  v?: number;
  texture?: string;
  scale?: number;
  flipX?: boolean;
  // Procedural building extras (kind === 'proc-building')
  w?: number;
  h?: number;
  levels?: number;
  levelHeightPx?: number;
  roof?: {
    kind: 'flat' | 'gabled' | 'hip';
    dir?: 'E-W' | 'N-S';
    pitch?: number;
  };
  wallColor?: number;
  roofColor?: number;
  elevationMode?: 'avg' | 'max';
  zPivot?: 'southEdge' | 'centroid';
  baseOffsetPx?: { x: number; y: number };
  tiles?: HexCoordinate[];
  facade?: MapPropFacadeStyle;
  windows?: MapPropWindows;
  doors?: MapPropDoor[];
  roofDetails?: MapPropRoofDetails;
}

export interface MapTile {
  terrain: TerrainType;
  elevation: number;
  cover: number;
  movementCostModifier: number;
  passable: boolean;
  providesVisionBoost: boolean;
  // Blocks line of sight THROUGH this tile (dense forest / buildings / rubble) — enables ambushes and
  // limits sight lines. The tile a viewer or target actually stands on is never treated as blocking.
  blocksVision?: boolean;
  // Optional: per-edge elevation style (used by renderer/pathfinding for slopes vs. cliffs)
  elevEdges?: Partial<Record<EdgeDir, ElevEdgeStyle>>;
  // Optional destructible terrain support
  destructible?: boolean;
  hp?: number; // hit points when destructible
}

export interface BattlefieldMap {
  id: string;
  environment?: BattlefieldEnvironment;
  width: number;
  height: number;
  tiles: MapTile[];
  props?: MapProp[];
}

export type UnitStance = 'ready' | 'suppressed' | 'routed' | 'destroyed';
export type WeaponFireMode = 'direct' | 'indirect';
export type AttackMode = 'normal' | 'suppressive';

export interface UnitStats {
  maxHealth: number;
  mobility: number;
  vision: number;
  weaponRanges: Record<string, number>;
  weaponPower: Record<string, number>;
  weaponAccuracy: Record<string, number>;
  // Weapons are direct by default. Only launchers that can use a friendly spotter need an entry.
  weaponFireModes?: Record<string, WeaponFireMode>;
  // Optional per-weapon target restrictions (e.g., AA vs air only)
  weaponTargets?: Record<string, Array<UnitDefinition['type']>>;
  armor: number;
  morale: number;
  ammoCapacity?: number; // optional ammo cap; undefined = infinite
  transportCapacity?: number; // optional transport slots for carrying infantry/support
  stealth?: number; // reduces detection chance
  fear?: number; // supernatural dread radius; saps morale of nearby mundane enemies
  concealmentBonus?: number; // bonus to stealth in cover
  overwatchAccuracyBonus?: number;
  sensorDeployment?: {
    mobileVision: number;
  };
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
  unitType: UnitDefinition['type'];
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
  level: number;
  // Persistent campaign combatants gain the bounded level bonus; throwaway sandbox instances still
  // record XP for diagnostics without acquiring strength that cannot be written back to a roster.
  careerProgression?: boolean;
  statusEffects: Set<string>;
  destroyedAt?: number; // timestamp when destroyed (used for short-lived markers)
  currentAmmo: number; // tracks remaining ammo; Infinity when unlimited
  embarkedOn?: string;
  carrying?: string[];
  // Tactical state
  entrench?: number; // 0..3, increases when stationary, reduces on hit
  movedThisRound?: boolean; // set to true when unit moves during its own turn
  dugInThisRound?: boolean; // prevents a manual dig-in order from also receiving the passive end-turn gain
  idleEntrenchedTurns?: number; // consecutive untouched turns spent at the unit type's entrenchment cap
  sensorDeployed?: boolean;
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
  weather?: 'clear' | 'night' | 'fog';
  supplyZones?: Partial<Record<FactionId, HexCoordinate[]>>; // tiles that refill ammo
  pickups?: Array<{ coordinate: HexCoordinate; kind: 'ammo'; amount: number; picked?: boolean }>;
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
      kind: 'reinforcements:arrived';
      eventId: string;
      faction: FactionId;
      unitIds: string[];
      coordinates: HexCoordinate[];
    }
  | {
      kind: 'scenario:event';
      eventId: string;
      messageKey: string;
      faction: FactionId;
      effectKinds: Array<'revealObjective' | 'transformTerrain' | 'pressurePulse'>;
    }
  | {
      kind: 'objective:completed';
      objectiveId: string;
      unitId: string;
      actionKey:
        | 'plantCharges'
        | 'disruptWard'
        | 'alignEchoBeacon'
        | 'calibratePrism'
        | 'groundMemoryLattice';
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
      defenderAt?: HexCoordinate; // defender's position when the shot resolved (reaction fire = path tile)
      attackMode?: AttackMode;
    }
  | {
      kind: 'unit:defeated';
      unitId: string;
      by: string;
    }
  | {
      kind: 'unit:xp';
      unitId: string;
      amount: number;
      reason: 'hit' | 'kill';
    }
  | {
      kind: 'tile:destroyed';
      at: HexCoordinate;
    }
  | {
      kind: 'unit:dug-in';
      unitId: string;
      level: number;
    }
  | {
      kind: 'unit:rallied';
      unitId: string;
      morale: number;
    }
  | {
      kind: 'unit:sensor-mode';
      unitId: string;
      deployed: boolean;
    }
  | {
      kind: 'unit:level';
      unitId: string;
      level: number;
    };

export interface ResolveAttackInput {
  attacker: UnitInstance;
  defender: UnitInstance;
  weaponId: string;
  map: BattlefieldMap;
  attackMode?: AttackMode;
}

export interface AttackResolution {
  damage: number;
  moraleDamage: number;
  events: BattleEvent[];
}
