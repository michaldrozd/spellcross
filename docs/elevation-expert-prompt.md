# Spellcross-like hills: per-corner heights, slopes vs. cliffs — expert consultation prompt

This document collects all context and relevant source code around our elevation rendering and logic. Goal: validate the per-corner (vertex) height approach derived from `elevEdges` (temporary source of truth), ensure correct rules for slopes vs. cliffs, remove artifacts ("stena pod rampou", vnútorné žliabky), and get recommendations (autotile shoulders, overlays, occlusion).

Language: Slovak + English. Variable names and code are in English.

## TL;DR
- We currently store only per-tile integer `elevation` and optional `elevEdges` per edge marking slope vs wall (impassable).
- Renderer derives per-corner heights hNW/hNE/hSE/hSW from `elevEdges`, then does vertex "snap to max" across neighbors to unify shared vertices.
- Walls (vertical cliffs) are drawn only when min(my_edge_corners) - max(nei_opposite_edge_corners) > 0. If edge is a slope from the higher tile, draw wedge instead and skip wall.
- Slope tops get a gentle gradient for readability. Shoulder triangles added at ramp entry/exit.
- Pathfinding already treats only slope edges as traversable across elevation; cliffs block.

We would like expert feedback on invariants, normalization, and any mistakes in the current derivation/drawing logic, plus recommendations for corner autotiles and overlay/top-only masking.

## What we need from you (questions)
1) Are these invariants sufficient and invertible?
   - `elevEdges` per tile must be either 0 bits (flat) or exactly 2 adjacent bits {N|E, E|S, S|W, W|N}, marking the HIGHER sides of a 1-level slope; else normalize to nearest valid.
   - Priority: slope > cliff. If there is a slope on an edge, there must be no cliff on that edge.
2) Is our corner derivation correct under that definition (higher-side edge marks)?
3) Is the min–max edge test the right criterion to eliminate walls under ramps and internal grooves on shared slope edges?
4) Any pitfalls with "snap to max" vertex unification? Alternative heuristics?
5) Recommendations for autotile corner/shoulder pieces (4 orientations) and for overlay top-only masks + simple occlusion of units behind cliffs.

## Visual issues we fixed/target
- "Stena pod rampou" (wall under ramp) — must not render.
- "Vnútorný žliabok" when chaining slopes — no internal vertical wall between two slope tiles.

## Project layout and relevant files
- packages/core/src/simulation/types.ts (MapTile, elevEdges types)
- packages/core/src/simulation/pathfinding/iso-pathfinder.ts (slope vs cliff movement rules)
- apps/web/src/modules/tactical-sandbox/sample-data.ts (test maps and slope stamping)
- apps/web/src/modules/tactical-sandbox/components/BattlefieldStage.tsx (renderer: per-corner derivation, vertex snap, slope gradient, min–max cliffs, shoulders)

Below we embed the full current contents of these files.

---

## packages/core/src/simulation/types.ts


```ts
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

export type EdgeDir = 'N' | 'E' | 'S' | 'W';
export type ElevEdgeStyle = 'wall' | 'slope' | 'none';

export interface MapTile {
  terrain: TerrainType;
  elevation: number;
  cover: number;
  movementCostModifier: number;
  passable: boolean;
  providesVisionBoost: boolean;
  // Optional: per-edge elevation style (used by renderer/pathfinding for slopes vs. cliffs)
  elevEdges?: Partial<Record<EdgeDir, ElevEdgeStyle>>;
  // Optional destructible terrain support
  destructible?: boolean;
  hp?: number; // hit points when destructible
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
  // Optional per-weapon target restrictions (e.g., AA vs air only)
  weaponTargets?: Record<string, Array<UnitDefinition['type']>>;
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
  statusEffects: Set<string>;
  // Tactical state
  entrench?: number; // 0..3, increases when stationary, reduces on hit
  movedThisRound?: boolean; // set to true when unit moves during its own turn
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
      kind: 'unit:level';
      unitId: string;
      level: number;
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

---

## packages/core/src/simulation/pathfinding/iso-pathfinder.ts

```ts
import type { BattlefieldMap, HexCoordinate, TacticalBattleState, UnitInstance, UnitStance } from '../types.js';
import { getTile, coordinateKey as hexKey } from '../utils/grid.js';
import { isoDistance, isoNeighbors } from '../utils/grid-iso.js';
import type { PathfindingOptions, PathResult } from './types.js';

interface NodeRecord {
  coordinate: HexCoordinate;
  costFromStart: number;
  estimatedTotalCost: number;
  parent?: NodeRecord;
}

import { movementMultiplierForStance } from './movement.js';

function canUnitEnterTerrain(unitType: UnitInstance['unitType'] | undefined, tile: { terrain: string; passable: boolean }): boolean {
  if (!tile || !tile.passable) return false;
  if (!unitType) return true;
  switch (tile.terrain) {
    case 'forest':
      return unitType === 'infantry' || unitType === 'hero';
    case 'water':
      return unitType === 'air';
    case 'swamp':
      return unitType !== 'air';
    case 'structure':
      return false;
    default:
      return true;
  }
}

export function findPathOnMapIso(
  map: BattlefieldMap,
  start: HexCoordinate,
  goal: HexCoordinate,
  options: PathfindingOptions & { occupied?: Set<string>; movementMultiplier?: number } = {}
): PathResult {
  if (start.q === goal.q && start.r === goal.r) {
    return { success: true, path: [], cost: 0 };
  }

  const occupied = options.occupied ?? new Set<string>();
  const ignore = options.ignoreCoordinates ?? new Set<string>();
  const movementMultiplier = options.movementMultiplier ?? 1;

  const openSet: NodeRecord[] = [
    { coordinate: start, costFromStart: 0, estimatedTotalCost: isoDistance(start, goal) }
  ];
  const closedSet = new Set<string>();
  const nodeLookup = new Map<string, NodeRecord>();
  nodeLookup.set(hexKey(start), openSet[0]);

  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;

  const popLowest = () => {
    let idx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].estimatedTotalCost < openSet[idx].estimatedTotalCost) idx = i;
    }
    return openSet.splice(idx, 1)[0];
  };

  while (openSet.length > 0) {
    const current = popLowest();
    const currentKey = hexKey(current.coordinate);

    if (current.coordinate.q === goal.q && current.coordinate.r === goal.r) {
      const path: HexCoordinate[] = [];
      let cursor: NodeRecord | undefined = current;
      while (cursor?.parent) {
        path.unshift(cursor.coordinate);
        cursor = cursor.parent;
      }
      return { success: true, path, cost: current.costFromStart };
    }

    closedSet.add(currentKey);

    for (const neighbor of isoNeighbors(map, current.coordinate)) {
      const neighborKey = hexKey(neighbor);
      if (closedSet.has(neighborKey)) continue;
      if (!ignore.has(neighborKey) && occupied.has(neighborKey)) continue;

      const tileB = getTile(map, neighbor);
      if (!tileB || !tileB.passable) continue;
      if (!canUnitEnterTerrain(options.unitType, tileB)) continue;

      // Elevation-aware movement across edges (slopes vs. cliffs)
      const tileA = getTile(map, current.coordinate);
      const elevA = tileA?.elevation ?? 0;
      const elevB = tileB?.elevation ?? 0;
      const dq = neighbor.q - current.coordinate.q;
      const dr = neighbor.r - current.coordinate.r;
      const isDiagonal = dq !== 0 && dr !== 0;

      let edgePenalty = 0;
      if (elevA !== elevB) {
        // Only allow orthogonal steps across elevation if the higher tile marks that edge as a slope
        if (isDiagonal) continue;
        const dir: 'N' | 'E' | 'S' | 'W' = dq === 1 && dr === 0 ? 'E' : dq === -1 && dr === 0 ? 'W' : dq === 0 && dr === 1 ? 'S' : 'N';
        const higherIsB = elevB > elevA;
        const higherTile: any = higherIsB ? tileB : tileA;
        const edgeOnHigher: 'N' | 'E' | 'S' | 'W' = higherIsB ? (dir === 'N' ? 'S' : dir === 'S' ? 'N' : dir === 'E' ? 'W' : 'E') : dir;
        const style = higherTile?.elevEdges?.[edgeOnHigher];
        if (style !== 'slope') continue; // sheer cliff
        edgePenalty = higherIsB ? 0.6 : 0.3; // uphill costs more than downhill
      }

      const movementCost = (tileB.movementCostModifier + edgePenalty) * movementMultiplier;
      const tentativeCost = current.costFromStart + movementCost;
      if (tentativeCost > maxCost) continue;

      const heuristic = isoDistance(neighbor, goal);
      const existing = nodeLookup.get(neighborKey);

      if (!existing || tentativeCost < existing.costFromStart) {
        const estimatedTotalCost = tentativeCost + heuristic;
        const rec: NodeRecord = {
          coordinate: neighbor,
          costFromStart: tentativeCost,
          estimatedTotalCost,
          parent: current
        };
        nodeLookup.set(neighborKey, rec);
        if (!existing) openSet.push(rec);
        else {
          existing.costFromStart = tentativeCost;
          existing.estimatedTotalCost = estimatedTotalCost;
          existing.parent = current;
        }
      }
    }
  }

  return { success: false, path: [], cost: Number.POSITIVE_INFINITY, reason: 'unreachable' };
}

export function planPathForUnitIso(
  state: TacticalBattleState,
  unitId: string,
  destination: HexCoordinate
): PathResult {
  const activeSide = state.sides[state.activeFaction];
  const unit = (activeSide.units.get(unitId) ??
    state.sides.alliance.units.get(unitId) ??
    state.sides.otherSide.units.get(unitId)) as UnitInstance | undefined;

  if (!unit) {
    return { success: false, path: [], cost: 0, reason: 'unit_not_found' };
  }

  const start = unit.coordinate;
  const occupation = new Set<string>();
  for (const side of Object.values(state.sides)) {
    for (const other of side.units.values()) {
      if (other.id === unit.id || other.stance === 'destroyed') continue;
      occupation.add(hexKey(other.coordinate));
    }
  }

  const movementMultiplier = movementMultiplierForStance(unit.stance);

  const pathResult = findPathOnMapIso(state.map, start, destination, {
    occupied: occupation,
    ignoreCoordinates: new Set([hexKey(start)]),
    maxCost: unit.actionPoints,
    movementMultiplier,
    unitType: unit.unitType
  });

  return pathResult;
}
```



---

## apps/web/src/modules/tactical-sandbox/sample-data.ts

```ts
import type {
  BattlefieldMap,
  CreateBattleStateOptions,
  UnitDefinition
} from '@spellcross/core';

const mapWidth = 12;
const mapHeight = 10;

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 1,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

export const sandboxMap: BattlefieldMap = {
  id: 'tutorial-field',
  width: mapWidth,
  height: mapHeight,
  tiles: Array.from({ length: mapWidth * mapHeight }, () => ({ ...plainTile }))
};

// --- Elevation testbed near spawn: mix of cliffs and a small ramp (slope) ---
(function setupSandboxElevation() {
  const idx = (q: number, r: number) => r * mapWidth + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < mapWidth && r < mapHeight;
  const setTile = (q: number, r: number, t: Partial<(typeof sandboxMap)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(sandboxMap.tiles[idx(q, r)], t);
  };
  const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => {
    if (!inb(q, r)) return;
    const t: any = sandboxMap.tiles[idx(q, r)];
    t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style };
  };

  // Rozšírené testy prevýšení pri spawne:
  // Veľká plošina 6x3 (elev=1)
  for (let q = 4; q <= 9; q++) {
    for (let r = 2; r <= 4; r++) {
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }
  // Rampy (S) na južnej hrane plošiny – 4 dlaždice uprostred
  for (let q = 5; q <= 8; q++) markEdge(q, 4, 'S', 'slope');
  // Rampy (E) na východnej hrane plošiny – 2 dlaždice
  markEdge(9, 3, 'E', 'slope');
  markEdge(9, 4, 'E', 'slope');

  // Vnútorná terasa (elev=2) 2x1 na hornej hrane plošiny
  for (let q = 6; q <= 7; q++) {
    setTile(q, 3, { terrain: 'hill', elevation: 2, cover: 1, providesVisionBoost: true });
  }
  // Z terasy zjazd (S) a (E)
  markEdge(6, 3, 'S', 'slope');
  markEdge(7, 3, 'S', 'slope');
  markEdge(7, 3, 'E', 'slope');

  // Druhá, samostatná kopa 3x3 (elev=1) dolu-vľavo s rôznymi rampami
  for (let q = 1; q <= 3; q++) {
    for (let r = 6; r <= 8; r++) {
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }
  // Rampy pre túto kopu: dve na juh (S) a dve na východ (E)
  markEdge(2, 8, 'S', 'slope');
  markEdge(1, 8, 'S', 'slope');
  markEdge(3, 7, 'E', 'slope');
  markEdge(3, 8, 'E', 'slope');

  // Ostatné hrany zostávajú implicitne "cliff" (renderer nakreslí stenu, pathfinding ich nepovolí).
})();


const lightInfantry: UnitDefinition = {
  id: 'light-infantry',
  faction: 'alliance',
  name: 'Light Infantry',
  type: 'infantry',
  stats: {
    maxHealth: 100,
    mobility: 6,
    vision: 4,
    armor: 1,
    morale: 60,
    weaponRanges: { rifle: 5 },
    weaponPower: { rifle: 12 },
    weaponAccuracy: { rifle: 0.75 }
  }
};

const impRaiders: UnitDefinition = {
  id: 'imp-raiders',
  faction: 'otherSide',
  name: 'Imp Raiders',
  type: 'infantry',
  stats: {
    maxHealth: 70,
    mobility: 7,
    vision: 3,
    armor: 0.5,
    morale: 40,
    weaponRanges: { claws: 1 },
    weaponPower: { claws: 8 },
    weaponAccuracy: { claws: 0.55 }
  }
};

export const sandboxBattleSpec: CreateBattleStateOptions = {
  map: sandboxMap,
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: lightInfantry,
          coordinate: { q: 3, r: 3 }
        },
        {
          definition: lightInfantry,
          coordinate: { q: 4, r: 4 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        {
          definition: impRaiders,
          coordinate: { q: 7, r: 4 }
        }
      ]
    }
  ],
  startingFaction: 'alliance'
};


export function makeSandboxSpec(opts: { width?: number; height?: number } = {}) {
  const width = Math.max(2, opts.width ?? mapWidth);
  const height = Math.max(2, opts.height ?? mapHeight);
  const map: BattlefieldMap = {
    id: `sandbox-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  // Keep allied units near top-left, enemy towards right-middle, clamped within bounds
  const ally1 = { q: Math.min(3, width - 1), r: Math.min(3, height - 1) };
  const ally2 = { q: Math.min(4, width - 1), r: Math.min(4, height - 1) };
  const enemy = {
    q: Math.min(Math.max(7, Math.floor(width * 0.6)), width - 1),
    r: Math.min(Math.max(4, Math.floor(height * 0.4)), height - 1)
  };

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      {
        faction: 'alliance',
        units: [
          { definition: lightInfantry, coordinate: ally1 },
          { definition: lightInfantry, coordinate: ally2 }
        ]
      },
      {
        faction: 'otherSide',
        units: [{ definition: impRaiders, coordinate: enemy }]
      }
    ],
    startingFaction: 'alliance'
  };

  return spec;
}
```
```ts
// (continued)

// Mega scenario: large map with diverse terrain and many units for thorough testing
export function makeMegaSandboxSpec(opts: { width?: number; height?: number } = {}) {
  const width = Math.max(40, opts.width ?? 160);
  const height = Math.max(32, opts.height ?? 110);

  const map: BattlefieldMap = {
    id: `mega-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  const idx = (q: number, r: number) => r * width + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;

  // Helpers to stamp terrain quickly
  const setTile = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(map.tiles[idx(q, r)], t);
  };

  // Hills ridge across the map (elevation & vision boost)
  for (let r = 4; r < height - 4; r++) {
    const center = Math.floor(width * 0.45 + Math.sin(r / 8) * 6);
    for (let dq = -2; dq <= 2; dq++) {
      const q = center + dq;
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }

  // Meandering river (only air can traverse per terrain rules)
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.62 + Math.sin(r / 7) * 5);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }

  // Second river to increase variety
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.35 + Math.cos(r / 9) * 6);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }

  // Extra forest seeds for denser clusters
  const extraForest = [
    { q: Math.floor(width * 0.48), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.55), r: Math.floor(height * 0.75) },
    { q: Math.floor(width * 0.70), r: Math.floor(height * 0.35) },
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.85) }
  ];
  for (const s of extraForest) {
    for (let dr = -5; dr <= 5; dr++) {
      for (let dq = -5; dq <= 5; dq++) {
        if (Math.hypot(dq, dr) <= 5.4) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Fortification line made of destructible structures
  const fortQ = Math.floor(width * 0.50);
  for (let r = Math.floor(height * 0.30); r < Math.floor(height * 0.70); r++) {
    for (let dq = -1; dq <= 1; dq++) {
      setTile(fortQ + dq, r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 20 });
    }
  }

  // Forest clusters (infantry favored)
  const forestSeeds = [
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.20), r: Math.floor(height * 0.65) },
    { q: Math.floor(width * 0.35), r: Math.floor(height * 0.40) }
  ];
  for (const s of forestSeeds) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        if (Math.hypot(dq, dr) <= 4.2) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Swamp region (slow, open)
  for (let r = Math.floor(height * 0.70); r < height - 2; r++) {
    for (let q = Math.floor(width * 0.70); q < width - 2; q++) {
      setTile(q, r, { terrain: 'swamp', movementCostModifier: 1.6, cover: 0 });
    }
  }

  // Town with destructible structures and surrounding urban cover
  const townQ0 = Math.floor(width * 0.30);
  const townR0 = Math.floor(height * 0.45);
  for (let r = 0; r < 8; r++) {
    for (let q = 0; q < 14; q++) {
      const atEdge = r === 0 || r === 7 || q === 0 || q === 13;
      if (atEdge) {
        setTile(townQ0 + q, townR0 + r, { terrain: 'urban', cover: 2, passable: true });
      } else {
        setTile(townQ0 + q, townR0 + r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 18 });
      }
    }
  }

  // Simple road from west -> town -> east
  for (let q = 2; q < width - 2; q++) setTile(q, Math.floor(height * 0.55), { terrain: 'road', movementCostModifier: 0.85, cover: 0 });

  // Unit definitions (concise)
  const mk = (id: string, type: UnitDefinition['type'], base: Partial<UnitDefinition['stats']> & { weaponRanges: any; weaponPower: any; weaponAccuracy: any; weaponTargets?: any }) => ({
    id, faction: 'alliance' as const, name: id, type,
    stats: { maxHealth: 100, mobility: 6, vision: 4, armor: 1, morale: 60, ...base }
  }) as UnitDefinition;
  const mkEnemy = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'otherSide' as const, name: id, type,
    stats: { maxHealth: 90, mobility: 6, vision: 4, armor: 1, morale: 55, ...base }
  }) as UnitDefinition;

  const allyInf = mk('ally-infantry', 'infantry', { weaponRanges: { rifle: 5 }, weaponPower: { rifle: 12 }, weaponAccuracy: { rifle: 0.75 } });
  const allyTank = mk('ally-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 24 }, weaponAccuracy: { cannon: 0.65 } });
  const allyArt = mk('ally-artillery', 'artillery', { weaponRanges: { howitzer: 8 }, weaponPower: { howitzer: 20 }, weaponAccuracy: { howitzer: 0.5 } });
  const allyAA = mk('ally-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.9 }, weaponTargets: { aa: ['air'] } });
  const allyAir = mk('ally-air', 'air', { mobility: 9, weaponRanges: { rockets: 3 }, weaponPower: { rockets: 18 }, weaponAccuracy: { rockets: 0.7 } });
  const allyHero = mk('ally-hero', 'hero', { weaponRanges: { sabre: 1 }, weaponPower: { sabre: 6 }, weaponAccuracy: { sabre: 1.0 } });

  const imp = mkEnemy('imp-raiders', 'infantry', { weaponRanges: { claws: 1 }, weaponPower: { claws: 8 }, weaponAccuracy: { claws: 0.55 } });
  const orc = mkEnemy('orc-grunts', 'infantry', { maxHealth: 110, armor: 1.2, weaponRanges: { axe: 1 }, weaponPower: { axe: 10 }, weaponAccuracy: { axe: 0.6 } });
  const enemyTank = mkEnemy('enemy-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 22 }, weaponAccuracy: { cannon: 0.6 } });
  const enemyArt = mkEnemy('enemy-artillery', 'artillery', { weaponRanges: { mortar: 7 }, weaponPower: { mortar: 18 }, weaponAccuracy: { mortar: 0.5 } });
  const enemyAA = mkEnemy('enemy-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.85 }, weaponTargets: { aa: ['air'] } });
  const enemyAir = mkEnemy('enemy-air', 'air', { mobility: 9, weaponRanges: { sting: 2 }, weaponPower: { sting: 14 }, weaponAccuracy: { sting: 0.7 } });

  // Spawn groups
  const clamp = (q: number, r: number) => ({ q: Math.max(0, Math.min(width - 1, q)), r: Math.max(0, Math.min(height - 1, r)) });
  let allies = [
    { definition: allyHero, coordinate: clamp(6, Math.floor(height * 0.55) - 2) },
    { definition: allyInf, coordinate: clamp(8, Math.floor(height * 0.55)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.50)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.60)) },
    { definition: allyTank, coordinate: clamp(12, Math.floor(height * 0.58)) },
    { definition: allyTank, coordinate: clamp(13, Math.floor(height * 0.52)) },
    { definition: allyArt, coordinate: clamp(10, Math.floor(height * 0.65)) },
    { definition: allyAA, coordinate: clamp(11, Math.floor(height * 0.48)) },
    { definition: allyAir, coordinate: clamp(7, Math.floor(height * 0.40)) }
  ];

  // Reinforcements: infantry line and support near road
  for (let i = 0; i < 8; i++) {
    allies.push({ definition: allyInf, coordinate: clamp(16 + i * 2, Math.floor(height * 0.55) + ((i % 3) - 1) * 2) });
  }
  for (let i = 0; i < 3; i++) {
    allies.push({ definition: allyTank, coordinate: clamp(20 + i * 3, Math.floor(height * 0.58) - i) });
  }
  for (let i = 0; i < 2; i++) {
    allies.push({ definition: allyArt, coordinate: clamp(14 + i * 2, Math.floor(height * 0.66) + i) });
  }
  allies.push({ definition: allyAA, coordinate: clamp(18, Math.floor(height * 0.48)) });
  allies.push({ definition: allyAA, coordinate: clamp(22, Math.floor(height * 0.50)) });
  allies.push({ definition: allyAir, coordinate: clamp(12, Math.floor(height * 0.38)) });

  let enemies = [
    { definition: impRaiders, coordinate: clamp(Math.floor(width * 0.78), Math.floor(height * 0.52)) },
    { definition: imp, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.55)) },
    { definition: orc, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.58)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.86), Math.floor(height * 0.60)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.88), Math.floor(height * 0.50)) },
    { definition: enemyArt, coordinate: clamp(Math.floor(width * 0.84), Math.floor(height * 0.66)) },
    { definition: enemyAA, coordinate: clamp(Math.floor(width * 0.90), Math.floor(height * 0.48)) },
    { definition: enemyAir, coordinate: clamp(Math.floor(width * 0.92), Math.floor(height * 0.40)) }
  ];

  // Enemy reinforcements: defensive line behind fortification and air patrols
  for (let i = 0; i < 10; i++) {
    enemies.push({ definition: orc, coordinate: clamp(Math.floor(width * 0.72) + (i % 3) * 2, Math.floor(height * 0.52) + ((i % 5) - 2) * 2) });
  }
  for (let i = 0; i < 4; i++) {
    enemies.push({ definition: enemyTank, coordinate: clamp(Math.floor(width * 0.76) + i * 2, Math.floor(height * 0.60) - i) });
  }
  for (let i = 0; i < 2; i++) {
    enemies.push({ definition: enemyArt, coordinate: clamp(Math.floor(width * 0.74) + i * 2, Math.floor(height * 0.66) + i) });
  }
  enemies.push({ definition: enemyAA, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.50)) });
  enemies.push({ definition: enemyAA, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.48)) });
  enemies.push({ definition: enemyAir, coordinate: clamp(Math.floor(width * 0.85), Math.floor(height * 0.40)) });

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      { faction: 'alliance', units: allies },
      { faction: 'otherSide', units: enemies }
    ],

    startingFaction: 'alliance'
  };

  return spec;
}

// Large scenario: approximately half the size of mega, reusing the same stamping pattern
export function makeLargeSandboxSpec(opts: { width?: number; height?: number } = {}) {
  // Default roughly half of mega's 160x110
  const width = Math.max(40, opts.width ?? 80);
  const height = Math.max(32, opts.height ?? 55);

  const map: BattlefieldMap = {
    id: `large-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  const idx = (q: number, r: number) => r * width + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
  const setTile = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(map.tiles[idx(q, r)], t);
  };

  // Elevation testbed near start: small plateau with a 2-tile ramp (slopes) and cliffs elsewhere
  (function stampStartPlateau() {
    const idx = (q: number, r: number) => r * width + q;
    const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
    const setT = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => { if (!inb(q,r)) return; Object.assign(map.tiles[idx(q,r)], t); };
    const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => {
      if (!inb(q,r)) return; const t: any = map.tiles[idx(q,r)]; t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style };
    };
    const baseQ = Math.max(3, Math.floor(width * 0.18));
    const baseR = Math.max(3, Math.floor(height * 0.55) - 2);
    for (let q = baseQ + 1; q <= baseQ + 4; q++) {
      for (let r = baseR; r <= baseR + 1; r++) {
        setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
      }
    }
    // add a 2-tile ramp on the south edge of the plateau
    markEdge(baseQ + 2, baseR + 1, 'S', 'slope');
    markEdge(baseQ + 3, baseR + 1, 'S', 'slope');
  })();

  // --- Extend start area with larger plateaus/ramps for broader testing ---
  (function extendStartElevation() {
    const idx = (q: number, r: number) => r * width + q;
    const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
    const setT = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => { if (!inb(q,r)) return; Object.assign(map.tiles[idx(q,r)], t); };
    const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => { if (!inb(q,r)) return; const t: any = map.tiles[idx(q,r)]; t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style }; };
    const baseQ = Math.max(3, Math.floor(width * 0.18));
    const baseR = Math.max(3, Math.floor(height * 0.55) - 2);

    // Bigger plateau 6x3 (elev=1) overlapping/expanding the small one
    for (let q = baseQ + 1; q <= baseQ + 6; q++) {
      for (let r = baseR; r <= baseR + 2; r++) {
        setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
      }
    }
    // South-edge ramps across middle (S)
    for (let q = baseQ + 2; q <= baseQ + 5; q++) markEdge(q, baseR + 2, 'S', 'slope');
    // East-edge ramps (E) on the plateau's east face
    for (let r = baseR; r <= baseR + 2; r++) markEdge(baseQ + 6, r, 'E', 'slope');

    // Inner terrace 2x1 at top row (elev=2) with S/E ramps
    for (let q = baseQ + 3; q <= baseQ + 4; q++) setT(q, baseR, { terrain: 'hill', elevation: 2, cover: 1, providesVisionBoost: true });
    markEdge(baseQ + 3, baseR, 'S', 'slope');
    markEdge(baseQ + 4, baseR, 'S', 'slope');
    markEdge(baseQ + 4, baseR, 'E', 'slope');

    // Separate 3x3 hill southwest with mixed S/E ramps
    for (let q = baseQ - 3; q <= baseQ - 1; q++) {
      for (let r = baseR + 3; r <= baseR + 5; r++) setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
    markEdge(baseQ - 2, baseR + 5, 'S', 'slope');
    markEdge(baseQ - 3, baseR + 5, 'S', 'slope');
    markEdge(baseQ - 1, baseR + 4, 'E', 'slope');
    markEdge(baseQ - 1, baseR + 5, 'E', 'slope');

    // Ramp walkway: 5 tiles in a row (elev=1) each with E ramp to ground
    for (let q = baseQ + 8; q <= baseQ + 12; q++) {
      setT(q, baseR + 3, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: false });
      markEdge(q, baseR + 3, 'E', 'slope');
    }
  })();

  // Hills ridge
  for (let r = 3; r < height - 3; r++) {
    const center = Math.floor(width * 0.45 + Math.sin(r / 7) * 4);
    for (let dq = -2; dq <= 2; dq++) {
      const q = center + dq;
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }

  // Two meandering rivers
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.62 + Math.sin(r / 6) * 3);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.35 + Math.cos(r / 8) * 4);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }

  // Forest clusters
  const forestSeeds = [
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.22), r: Math.floor(height * 0.65) },
    { q: Math.floor(width * 0.36), r: Math.floor(height * 0.42) },
  ];
  for (const s of forestSeeds) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        if (Math.hypot(dq, dr) <= 4.0) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Town block
  const townQ0 = Math.floor(width * 0.30);
  const townR0 = Math.floor(height * 0.45);
  const townH = Math.min(6, Math.floor(height * 0.12));
  const townW = Math.min(12, Math.floor(width * 0.15));
  for (let r = 0; r < townH; r++) {
    for (let q = 0; q < townW; q++) {
      const atEdge = r === 0 || r === townH - 1 || q === 0 || q === townW - 1;
      if (atEdge) setTile(townQ0 + q, townR0 + r, { terrain: 'urban', cover: 2, passable: true });
      else setTile(townQ0 + q, townR0 + r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 16 });
    }
  }

  // Swamp corner
  for (let r = Math.floor(height * 0.70); r < height - 1; r++) {
    for (let q = Math.floor(width * 0.68); q < width - 1; q++) {
      setTile(q, r, { terrain: 'swamp', movementCostModifier: 1.6, cover: 0 });
    }
  }

  // Road across map
  for (let q = 1; q < width - 1; q++) setTile(q, Math.floor(height * 0.55), { terrain: 'road', movementCostModifier: 0.85, cover: 0 });

  // Fortification line
  const fortQ = Math.floor(width * 0.50);
  for (let r = Math.floor(height * 0.30); r < Math.floor(height * 0.70); r++) {
    for (let dq = -1; dq <= 1; dq++) {
      setTile(fortQ + dq, r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 18 });
    }
  }

  // Unit factories (like mega but fewer totals)
  const mk = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'alliance' as const, name: id, type,
    stats: { maxHealth: 100, mobility: 6, vision: 4, armor: 1, morale: 60, ...base }
  }) as UnitDefinition;
  const mkEnemy = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'otherSide' as const, name: id, type,
    stats: { maxHealth: 90, mobility: 6, vision: 4, armor: 1, morale: 55, ...base }
  }) as UnitDefinition;

  const allyInf = mk('ally-infantry', 'infantry', { weaponRanges: { rifle: 5 }, weaponPower: { rifle: 12 }, weaponAccuracy: { rifle: 0.75 } });
  const allyTank = mk('ally-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 24 }, weaponAccuracy: { cannon: 0.65 } });
  const allyArt = mk('ally-artillery', 'artillery', { weaponRanges: { howitzer: 8 }, weaponPower: { howitzer: 20 }, weaponAccuracy: { howitzer: 0.5 } });
  const allyAA = mk('ally-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.9 }, weaponTargets: { aa: ['air'] } });
  const allyAir = mk('ally-air', 'air', { mobility: 9, weaponRanges: { rockets: 3 }, weaponPower: { rockets: 18 }, weaponAccuracy: { rockets: 0.7 } });
  const allyHero = mk('ally-hero', 'hero', { weaponRanges: { sabre: 1 }, weaponPower: { sabre: 6 }, weaponAccuracy: { sabre: 1.0 } });

  const imp = mkEnemy('imp-raiders', 'infantry', { weaponRanges: { claws: 1 }, weaponPower: { claws: 8 }, weaponAccuracy: { claws: 0.55 } });
  const orc = mkEnemy('orc-grunts', 'infantry', { maxHealth: 110, armor: 1.2, weaponRanges: { axe: 1 }, weaponPower: { axe: 10 }, weaponAccuracy: { axe: 0.6 } });
  const enemyTank = mkEnemy('enemy-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 22 }, weaponAccuracy: { cannon: 0.6 } });
  const enemyArt = mkEnemy('enemy-artillery', 'artillery', { weaponRanges: { mortar: 7 }, weaponPower: { mortar: 18 }, weaponAccuracy: { mortar: 0.5 } });
  const enemyAA = mkEnemy('enemy-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.85 }, weaponTargets: { aa: ['air'] } });
  const enemyAir = mkEnemy('enemy-air', 'air', { mobility: 9, weaponRanges: { sting: 2 }, weaponPower: { sting: 14 }, weaponAccuracy: { sting: 0.7 } });

  const clamp = (q: number, r: number) => ({ q: Math.max(0, Math.min(width - 1, q)), r: Math.max(0, Math.min(height - 1, r)) });

  let allies = [
    { definition: allyHero, coordinate: clamp(6, Math.floor(height * 0.55) - 2) },
    { definition: allyInf, coordinate: clamp(8, Math.floor(height * 0.55)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.50)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.60)) },
    { definition: allyTank, coordinate: clamp(12, Math.floor(height * 0.58)) },
    { definition: allyArt, coordinate: clamp(10, Math.floor(height * 0.65)) },
    { definition: allyAA, coordinate: clamp(11, Math.floor(height * 0.48)) },
    { definition: allyAir, coordinate: clamp(7, Math.floor(height * 0.40)) },
  ];

  // Fewer reinforcements than mega
  for (let i = 0; i < 5; i++) allies.push({ definition: allyInf, coordinate: clamp(14 + i * 2, Math.floor(height * 0.55) + ((i % 3) - 1) * 2) });
  for (let i = 0; i < 2; i++) allies.push({ definition: allyTank, coordinate: clamp(18 + i * 3, Math.floor(height * 0.58) - i) });
  allies.push({ definition: allyArt, coordinate: clamp(14, Math.floor(height * 0.66)) });
  allies.push({ definition: allyAA, coordinate: clamp(18, Math.floor(height * 0.48)) });

  let enemies = [
    { definition: imp, coordinate: clamp(Math.floor(width * 0.78), Math.floor(height * 0.52)) },
    { definition: orc, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.55)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.84), Math.floor(height * 0.58)) },
    { definition: enemyArt, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.66)) },
    { definition: enemyAA, coordinate: clamp(Math.floor(width * 0.88), Math.floor(height * 0.48)) },
    { definition: enemyAir, coordinate: clamp(Math.floor(width * 0.90), Math.floor(height * 0.40)) },
  ];
  for (let i = 0; i < 6; i++) enemies.push({ definition: orc, coordinate: clamp(Math.floor(width * 0.72) + (i % 3) * 2, Math.floor(height * 0.52) + ((i % 5) - 2) * 2) });
  for (let i = 0; i < 2; i++) enemies.push({ definition: enemyTank, coordinate: clamp(Math.floor(width * 0.76) + i * 2, Math.floor(height * 0.60) - i) });

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      { faction: 'alliance', units: allies },
      { faction: 'otherSide', units: enemies }
    ],
    startingFaction: 'alliance'
  };

  return spec;
}
```


---

## apps/web/src/modules/tactical-sandbox/components/BattlefieldStage.tsx

```tsx
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { FactionId, HexCoordinate, TacticalBattleState } from '@spellcross/core';
import { movementMultiplierForStance } from '@spellcross/core';
import { canAffordAttack } from '@spellcross/core';
import { axialDistance } from '@spellcross/core';
import { Container, Graphics, Stage, Text } from '@pixi/react';
import { Matrix, Texture } from 'pixi.js';

import { TextStyle } from 'pixi.js';

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)


// Isometric elevation illusion parameters
const ELEV_Y_OFFSET = 12;     // vertical pixel offset per elevation level (screen space)
const CLIFF_DEPTH = 12;       // was 16 – slightly subtler cliff height

const terrainPalette: Record<string, number> = {
  plain: 0x2f4f4f,
  road: 0x566573,
  forest: 0x145214,
  urban: 0x5e5b70,
  hill: 0x4f614f,
  water: 0x143464,

  swamp: 0x3d5e4a,
  structure: 0x6f5f4f
};

export interface BattlefieldStageProps {
  battleState: TacticalBattleState;
  onSelectUnit?: (unitId: string) => void;
  onSelectTile?: (coordinate: HexCoordinate) => void;
  plannedPath?: HexCoordinate[];
  plannedDestination?: HexCoordinate;
  targetUnitId?: string;
  selectedUnitId?: string;
  viewerFaction?: FactionId;
  width?: number;
  height?: number;
  cameraMode?: 'fit' | 'follow';
  showAttackOverlay?: boolean;
}

const axialToPixel = ({ q, r }: { q: number; r: number }) => {
  const x = (hexWidth * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r)) / Math.sqrt(3);
  const y = hexHeight * (1.5 * r);
  return { x, y };
};


// Spellcross mode: isometric square grid rendering (A-step prototype)
const ISO_MODE = true; // TODO: make this a prop/setting
const ISO_TILE_W = tileSize;            // diamond width
const ISO_TILE_H = Math.max(8, Math.floor(tileSize * 0.5)); // diamond height (≈ half width)

const isoSquareToPixel = ({ q, r }: { q: number; r: number }) => {
  const col = q, row = r;
  const x = (col - row) * (ISO_TILE_W / 2);
  const y = (col + row) * (ISO_TILE_H / 2);
  return { x, y };
};

const toScreen = ({ q, r }: { q: number; r: number }) => (ISO_MODE ? isoSquareToPixel({ q, r }) : axialToPixel({ q, r }));

// Tiny procedural CC0-like tile textures generated at runtime (keeps repo lean)
function makeCanvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 32, h = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  (ctx as any).imageSmoothingEnabled = false;
  draw(ctx, w, h);
  return Texture.from(canvas);
}

function hexToRgb(hex: number) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function shade(c: number, f: number) {
  const { r, g, b } = hexToRgb(c);
  const nr = Math.min(255, Math.max(0, Math.round(r * f)));
  const ng = Math.min(255, Math.max(0, Math.round(g * f)));
  const nb = Math.min(255, Math.max(0, Math.round(b * f)));
  return `rgb(${nr},${ng},${nb})`;
}


export function BattlefieldStage({
  battleState,
  onSelectUnit,
  onSelectTile,
  plannedPath,
  plannedDestination,
  targetUnitId,
  selectedUnitId,
  viewerFaction = 'alliance',
  width,
  height,
  cameraMode = 'fit',
  showAttackOverlay
}: BattlefieldStageProps) {
  const map = battleState.map;
  const viewerVision = battleState.vision[viewerFaction];
  const visibleTiles = viewerVision?.visibleTiles ?? new Set<number>();
  const exploredTiles = viewerVision?.exploredTiles ?? new Set<number>();
  const stageDimensions = useMemo(() => {
    if (ISO_MODE) {
      const width = (map.width + map.height) * (ISO_TILE_W / 2) + ISO_TILE_W;
      const height = (map.width + map.height) * (ISO_TILE_H / 2) + ISO_TILE_H;
      return { width, height };
    } else {
      const width = map.width * hexWidth + hexWidth;
      const height = map.height * hexHeight + hexHeight;
      return { width, height };
    }
  }, [map.height, map.width]);
```

```tsx
// (continued)
  // Debug: center alignment markers
  const DEBUG_ALIGN = false; // disable debug dots

  // In ISO mode, isoSquareToPixel can produce negative X for top-left; shift world so minX≈0
  const isoBaseX = ISO_MODE ? map.height * (ISO_TILE_W / 2) : 0;



  // Responsive container sizing (debounced + RO). Use props as initial hint only.
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostSize, setHostSize] = useState<{ w: number; h: number }>(() => ({
    w: typeof width === 'number' ? width : stageDimensions.width,
    h: typeof height === 'number' ? height : stageDimensions.height
  }));
  const sizePendingRef = useRef<{ w: number; h: number } | null>(null);
  const sizeTimerRef = useRef<number | null>(null);
  const commitSize = (w: number, h: number) => {
    setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  };
  const scheduleSize = (w: number, h: number) => {
    sizePendingRef.current = { w, h };
    if (sizeTimerRef.current) window.clearTimeout(sizeTimerRef.current);
    sizeTimerRef.current = window.setTimeout(() => {
      const p = sizePendingRef.current; if (p) commitSize(Math.round(p.w), Math.round(p.h));
    }, 120) as unknown as number;
  };
  // Apply prop size (as hint) but debounced, do not return early
  useEffect(() => {
    if (typeof width === 'number' && typeof height === 'number') {
      scheduleSize(width, height);
    }
  }, [width, height]);
  // ResizeObserver
  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) scheduleSize(cr.width, cr.height);
    });
    ro.observe(el);
    // initialize once
    const rect = el.getBoundingClientRect();
    scheduleSize(rect.width, rect.height);
    return () => {
      ro.disconnect();
      if (sizeTimerRef.current) window.clearTimeout(sizeTimerRef.current);
    };
  }, []);


  // Minimap toggle
  const [minimapVisible, setMinimapVisible] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setMinimapVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  // Keyboard help overlay toggle (H or ?)
  const [helpVisible, setHelpVisible] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === 'h' || k === 'H' || k === '?' || k === '/' || k === 'F1' || e.code === 'KeyH' || e.code === 'Slash' || e.code === 'F1') {
        e.preventDefault();
        setHelpVisible((v) => !v);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
```

```tsx
// (continued)
  // Procedural terrain textures (tiny, generated once per mount)
  const terrainTextures = useMemo(() => {
    const grassBase = terrainPalette.plain;
    const forestBase = terrainPalette.forest;
    const roadBase = terrainPalette.road;
    const urbanBase = terrainPalette.urban;
    const hillBase = terrainPalette.hill;
    const waterBase = terrainPalette.water;
    const swampBase = terrainPalette.swamp;
    const structureBase = terrainPalette.structure;

    const dot = (ctx: CanvasRenderingContext2D, x: number, y: number, c: string, a = 1) => {
      ctx.fillStyle = c; ctx.globalAlpha = a; ctx.fillRect(x, y, 1, 1); ctx.globalAlpha = 1;
    };

    const grass = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(grassBase, 1.0); ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w * h * 0.08; i++) { dot(ctx, (i*29)%w, (i*53)%h, shade(grassBase, 1.08), 0.9); }
      for (let i = 0; i < w * h * 0.04; i++) { dot(ctx, (i*17)%w, (i*41)%h, shade(grassBase, 0.9), 0.9); }
    });

    const forest = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(forestBase, 1.0); ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w * h * 0.10; i++) { dot(ctx, (i*13)%w, (i*37)%h, shade(forestBase, 0.8), 0.9); }
      for (let i = 0; i < w * h * 0.06; i++) { dot(ctx, (i*23)%w, (i*19)%h, shade(forestBase, 1.15), 0.9); }
    });

    const road = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(roadBase, 0.95); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(roadBase, 0.75);
      for (let y = 0; y < h; y += 4) { ctx.fillRect(0, y, w, 1); }
    });

    const urban = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(urbanBase, 0.95); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(urbanBase, 0.8);
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    });

    const hill = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(hillBase, 1.0); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(hillBase, 0.85);
      for (let y = 0; y < h; y += 5) { ctx.fillRect(0, y, w, 1); }
    });

    const water = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(waterBase, 0.9); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(waterBase, 1.1);
      for (let i = 0; i < w; i++) ctx.fillRect((i*7)%w, (i*3)%h, 1, 1);
    });

    const swamp = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(swampBase, 1.0); ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w * h * 0.06; i++) { dot(ctx, (i*11)%w, (i*17)%h, shade(swampBase, 0.8), 0.9); }
      for (let i = 0; i < w * h * 0.04; i++) { dot(ctx, (i*31)%w, (i*23)%h, '#3b2f2f', 0.8); }
    });

    const structure = makeCanvasTexture((ctx, w, h) => {
      ctx.fillStyle = shade(structureBase, 1.0); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = shade(structureBase, 0.8);
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
    });

    return { plain: grass, road, forest, urban, hill, water, swamp, structure } as Record<string, Texture>;
  }, []);

  // Minimap-driven camera target (world pixel coordinates)
  const [followTargetPx, setFollowTargetPx] = useState<{ x: number; y: number } | null>(null);
  const [minimapDragging, setMinimapDragging] = useState(false);
  useEffect(() => {
    const onUp = () => setMinimapDragging(false);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('pointerleave', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('pointerleave', onUp);
    };
  }, []);

  // Auto-center camera on first friendly unit at start
  const didAutoCenterRef = useRef(false);
  useEffect(() => {
    if (didAutoCenterRef.current) return;
    let friendly: any | undefined;
    for (const side of Object.values(battleState.sides) as any[]) {
      for (const u of (side as any).units.values() as any[]) {
        if ((u as any).faction === viewerFaction) { friendly = u; break; }
      }
      if (friendly) break;
    }
    if (friendly) {
      const p = toScreen((friendly as any).coordinate);
      setFollowTargetPx({ x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y });
      didAutoCenterRef.current = true;
    }
  }, [battleState.sides, viewerFaction]);

  // Camera panning control
  const PAN_SPEED = 800; // pixels per second (keyboard)
  const [panVel, setPanVel] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panVelRef = useRef(panVel);
  useEffect(() => { panVelRef.current = panVel; }, [panVel]);
  // live scale ref to avoid restarting RAF loop on every zoom
  const scaleRef = useRef(1);

  // Mouse-drag camera state
  const [draggingCam, setDraggingCam] = useState(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  // Arrow-key keyboard panning (camera-centric: Right/Down move kameru doprava/dole)
  // live follow-target ref so wheel handler doesn't rebind on every pan
  const followRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { followRef.current = followTargetPx; }, [followTargetPx]);

  useEffect(() => {
    const pressed = new Set<string>();
    const recompute = () => {
      const left = pressed.has('ArrowLeft');
      const right = pressed.has('ArrowRight');
      const up = pressed.has('ArrowUp');
      const down = pressed.has('ArrowDown');
      // Camera-centric: increasing center.x moves kamera doprava (mapa sa posúva doľava)
      const vx = (right ? PAN_SPEED : 0) + (left ? -PAN_SPEED : 0);
      const vy = (down ? PAN_SPEED : 0) + (up ? -PAN_SPEED : 0);
      setPanVel({ x: vx, y: vy });
    };
    const keys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']);
    const onDown = (e: KeyboardEvent) => {
      if (!keys.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      pressed.add(e.key);
      recompute();
    };
    const onUp = (e: KeyboardEvent) => {
      if (!keys.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      pressed.delete(e.key);
      recompute();
    };
    const onBlur = () => { pressed.clear(); setPanVel({ x: 0, y: 0 }); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);


  // Camera/scale (use exact stage size; padding here causes mis-centering)
  const contentWidth = stageDimensions.width;
  const contentHeight = stageDimensions.height;

  // Follow zoom (clamped) and wheel handler (works when in follow OR when a follow target is set)
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Always prevent page scroll when interacting over canvas
      e.preventDefault();
      e.stopPropagation();
      const hasFollow = !!followRef.current;
      if (!(cameraMode === 'follow' || hasFollow)) return;
      const current = zoomRef.current;
      const delta = Math.sign(e.deltaY);
      const next = Math.min(2.0, Math.max(0.4, current * (delta > 0 ? 0.9 : 1.1)));
      // If we don't yet have a follow center, adopt selected unit or map center
      if (!hasFollow) {
        let selected: any | undefined;
        if (selectedUnitId) {
          for (const side of Object.values(battleState.sides) as any[]) {
            const u = (side as any).units.get(selectedUnitId);
            if (u) { selected = u; break; }
          }
        }
        const coord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
        const p = toScreen(coord);
        setFollowTargetPx({ x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y });
      }
      if (next !== current) setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cameraMode, battleState.sides, selectedUnitId, map.width, map.height]);

  const fitScale = Math.min(
    hostSize.w > 0 ? hostSize.w / contentWidth : 1,
    hostSize.h > 0 ? hostSize.h / contentHeight : 1
  );
```

```tsx
// (continued)
  // Choose scale: fit or follow
  const scale = (cameraMode === 'follow' || !!followTargetPx) ? zoom : fitScale;

  // keep scaleRef in sync
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  // Calculate offsets
  let offsetX = 0;
  let offsetY = 0;
  const forceFollow = !!followTargetPx;
  if (cameraMode === 'fit' && !forceFollow) {
    offsetX = (hostSize.w - stageDimensions.width * scale) / 2;
    offsetY = (hostSize.h - stageDimensions.height * scale) / 2;
  } else {
    // Center on follow target (minimap override > selected unit > map center)
    const selected = (() => {
      if (!selectedUnitId) return undefined;
      for (const side of Object.values(battleState.sides) as any[]) {
        const u = (side as any).units.get(selectedUnitId);
        if (u) return u;
      }
      return undefined;
    })();
    if (followTargetPx) {

      offsetX = hostSize.w / 2 - followTargetPx.x * scale;
      offsetY = hostSize.h / 2 - followTargetPx.y * scale;
    } else {
      const followCoord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
      const { x: tx, y: ty } = toScreen(followCoord);
      const adjx = ISO_MODE ? tx + isoBaseX : tx;
      offsetX = hostSize.w / 2 - adjx * scale;
      offsetY = hostSize.h / 2 - ty * scale;
    }
  }

  // Precompute friendly units by coordinate for quick tile-click selection
  const friendlyByCoord = useMemo(() => {
    const m = new Map<string, any>();
    for (const side of Object.values(battleState.sides) as any[]) {
      for (const u of (side as any).units.values()) {
        if (u.faction === viewerFaction && u.stance !== 'destroyed') {
          m.set(`${u.coordinate.q},${u.coordinate.r}`, u);
        }
      }
    }
    return m;
  }, [battleState.sides, viewerFaction]);

  // Precompute snapped per-vertex heights (renderer-only) derived from elevEdges
  const snappedCorners = useMemo(() => {
    const w = map.width, h = map.height;
    const idxAt = (qq: number, rr: number) => rr * w + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < w && rr < h;
    const tileAt = (qq: number, rr: number) => (inb(qq, rr) ? (map.tiles[idxAt(qq, rr)] as any) : undefined);
    const neighbors = [
      { dq: 0, dr: -1 }, // N
      { dq: +1, dr: 0 }, // E
      { dq: 0, dr: +1 }, // S
      { dq: -1, dr: 0 }  // W
    ];
    const opp: Record<'N'|'E'|'S'|'W','N'|'E'|'S'|'W'> = { N: 'S', E: 'W', S: 'N', W: 'E' };
    const hasSlopeEdgeFromHigher = (qq: number, rr: number, dir: 'N'|'E'|'S'|'W') => {
      const t = tileAt(qq, rr); if (!t) return false;
      const dIdx = { N:0, E:1, S:2, W:3 }[dir];
      const nt = tileAt(qq + neighbors[dIdx].dq, rr + neighbors[dIdx].dr); if (!nt) return false;
      const eHere = (t.elevation ?? 0), eNei = (nt.elevation ?? 0);
      if (eHere - eNei !== 1) return false;
      const markHere = (t.elevEdges?.[dir] === 'slope');
      const markNei = (nt.elevEdges?.[opp[dir]] === 'slope');
      return markHere || markNei;
    };
    const rawCorners = (qq: number, rr: number) => {
      const t = tileAt(qq, rr); const e = t ? (t.elevation ?? 0) : 0;
      let hNW = e, hNE = e, hSE = e, hSW = e;
      if (hasSlopeEdgeFromHigher(qq, rr, 'N')) { hNW = e - 1; hNE = e - 1; }
      if (hasSlopeEdgeFromHigher(qq, rr, 'E')) { hNE = e - 1; hSE = e - 1; }
      if (hasSlopeEdgeFromHigher(qq, rr, 'S')) { hSW = e - 1; hSE = e - 1; }
      if (hasSlopeEdgeFromHigher(qq, rr, 'W')) { hNW = e - 1; hSW = e - 1; }
      return { hNW, hNE, hSE, hSW };
    };
    // Build (w+1) x (h+1) grid of vertex heights using max across contributors
    const V: number[][] = Array.from({ length: w + 1 }, () => new Array<number>(h + 1).fill(-1e9));
    for (let rr = 0; rr < h; rr++) {
      for (let qq = 0; qq < w; qq++) {
        const c = rawCorners(qq, rr);
        V[qq][rr] = Math.max(V[qq][rr], c.hNW);
        V[qq + 1][rr] = Math.max(V[qq + 1][rr], c.hNE);
        V[qq + 1][rr + 1] = Math.max(V[qq + 1][rr + 1], c.hSE);
        V[qq][rr + 1] = Math.max(V[qq][rr + 1], c.hSW);
      }
    }
    return {
      getCorners: (qq: number, rr: number) => ({
        hNW: V[qq][rr],
        hNE: V[qq + 1][rr],
        hSE: V[qq + 1][rr + 1],
        hSW: V[qq][rr + 1]
      })
    } as const;
  }, [map.tiles, map.width, map.height]);
```

```tsx
// (continued)
  const tileGraphics = useMemo(() => {
    return map.tiles.map((tile: any, index: number) => {
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = toScreen({ q, r });
      const elev = (tile as any).elevation ?? 0;
      const posY = pos.y - elev * ELEV_Y_OFFSET;
      const isVisible = visibleTiles.has(index);
      const isExplored = exploredTiles.has(index);

      return (
        <Graphics
          key={`tile-${index}`}

          x={pos.x}
          y={posY}
          interactive={isExplored}
          cursor={isExplored ? 'pointer' : 'not-allowed'}
          pointerdown={() => {
            if (!isExplored) return;
            const key = `${q},${r}`;
            const friendly = friendlyByCoord.get(key);
            if (friendly) {
              onSelectUnit?.(friendly.id);
            } else {
              onSelectTile?.({ q, r });
            }
          }}
          draw={(g) => {
            g.clear();
            const size = tileSize / 2;
            const hw = hexWidth / 2;
            const points = ISO_MODE
              ? [
                  { x: 0, y: -(ISO_TILE_H / 2) }, // N
                  { x: ISO_TILE_W / 2, y: 0 },    // E
                  { x: 0, y: ISO_TILE_H / 2 },    // S
                  { x: -ISO_TILE_W / 2, y: 0 }    // W
                ]
              : [
                  { x: 0, y: -size },
                  { x: hw, y: -size / 2 },
                  { x: hw, y: size / 2 },
                  { x: 0, y: size },
                  { x: -hw, y: size / 2 },
                  { x: -hw, y: -size / 2 }
                ];

            if (!isExplored) {
              // unexplored = dark
              g.beginFill(0x030509, 0.95);
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
              g.closePath();
              g.endFill();
            } else {
              // 1) solid base color
              const baseColor = (terrainPalette as any)[tile.terrain] ?? terrainPalette.plain;
              g.beginFill(baseColor, isVisible ? 1.0 : 0.6);
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
              g.closePath();
              g.endFill();

              // 2) subtle pattern overlay (reduced alpha, no scaling to avoid moir)
              const tex = (terrainTextures as any)[tile.terrain] ?? (terrainTextures as any).plain;
              const m = new Matrix();
              const ox = (q * 13 + r * 7) % 32;
              const oy = (q * 5 + r * 11) % 32;
              m.translate(ox, oy);
              g.beginTextureFill({ texture: tex, matrix: m, alpha: isVisible ? 0.15 : 0.08 });
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
              g.closePath();
              g.endFill();

              // 2.5) elevation-based light/shade wedges + edge blending (Spellcross-like)
              {
                const elev = (tile as any).elevation ?? 0;
                const idxAt = (qq: number, rr: number) => rr * map.width + qq;
                const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;
                const getElev = (qq: number, rr: number) => (inb(qq, rr) ? ((map.tiles[idxAt(qq, rr)] as any).elevation ?? 0) : elev);
                const terr = (tile as any).terrain ?? 'plain';
                // Terrain factor to keep water/roads flatter visually
                const terrShadeFactor = terr === 'water' ? 0.3 : terr === 'road' ? 0.5 : terr === 'urban' ? 0.6 : terr === 'forest' ? 0.7 : 1.0;


                        // 2.5.a) (moved) Vertical faces/walls will be drawn in a later pass above UI overlays.
                        // Intentionally no walls here to keep ground pass clean.

                        // 2.5.b) Removed per-hex wedges; rely on walls + top shading for readability.

                // Directional top shading based on elevation gradient (reduces per-hex wedges)
                const eR = getElev(q + 1, r);
                const eL = getElev(q - 1, r);
                const eB = getElev(q, r + 1);
                const eT = getElev(q, r - 1);
                const gx = eR - eL;
                const gy = eB - eT;
                const dot = gx * 0.7 + gy * 1.0; // >0 = slopes away from light (darken)
                const aTop = (isVisible ? 0.12 : 0.06) * terrShadeFactor * Math.min(1, Math.abs(dot) * 0.5 + 0.15);
                g.beginFill(dot > 0 ? 0x000000 : 0xffffff, aTop);
                g.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
                g.closePath();
                g.endFill();

                        // Slope surface gradient (per-corner model derived from elevEdges)
                        if (ISO_MODE) {
                          const opp: Record<'N'|'E'|'S'|'W','N'|'E'|'S'|'W'> = { N: 'S', E: 'W', S: 'N', W: 'E' };
                          const tileAt = (qq: number, rr: number) => inb(qq, rr) ? (map.tiles[idxAt(qq, rr)] as any) : undefined;
                          const hasSlopeEdgeFromHigher = (qq: number, rr: number, dir: 'N'|'E'|'S'|'W') => {
                            const t = tileAt(qq, rr); if (!t) return false;
                            const dirIdx = { N:0, E:1, S:2, W:3 }[dir];
                            const nQ = qq + [ {dq:0,dr:-1}, {dq:+1,dr:0}, {dq:0,dr:+1}, {dq:-1,dr:0} ][dirIdx].dq;
                            const nR = rr + [ {dq:0,dr:-1}, {dq:+1,dr:0}, {dq:0,dr:+1}, {dq:-1,dr:0} ][dirIdx].dr;
                            const nt = tileAt(nQ, nR); if (!nt) return false;
                            const eHere = (t.elevation ?? 0), eNei = (nt.elevation ?? 0);
                            if (eHere - eNei !== 1) return false;
                            const markHere = (t.elevEdges?.[dir] === 'slope');
                            const markNei = (nt.elevEdges?.[opp[dir]] === 'slope');
                            return markHere || markNei;
                          };
                          const c = snappedCorners.getCorners(q, r);
                          const vals = [c.hNW, c.hNE, c.hSE, c.hSW];
                          const maxv = Math.max(...vals); const minv = Math.min(...vals);
                          if (maxv - minv === 1) {
                            // classify orientation by which two adjacent corners are lower
                            let ori: 'N'|'E'|'S'|'W'|null = null;
                            if (c.hSW === minv && c.hSE === minv) ori = 'S';
                            else if (c.hNE === minv && c.hSE === minv) ori = 'E';
                            else if (c.hNW === minv && c.hNE === minv) ori = 'N';
                            else if (c.hNW === minv && c.hSW === minv) ori = 'W';
                            if (ori) {
                              const lightA = (isVisible ? 0.07 : 0.04) * terrShadeFactor;
                              const darkA  = (isVisible ? 0.09 : 0.06) * terrShadeFactor;
                              // Triangles over the diamond
                              const tri = (a: number, b: number, c: number, color: number, alpha: number) => {
                                g.beginFill(color, alpha);
                                g.moveTo(points[a].x, points[a].y);
                                g.lineTo(points[b].x, points[b].y);
                                g.lineTo(points[c].x, points[c].y);
                                g.closePath();
                                g.endFill();
                              };
                              if (ori === 'S') { tri(0,1,3, 0xffffff, lightA); tri(2,1,3, 0x000000, darkA); }
                              else if (ori === 'E') { tri(3,0,2, 0xffffff, lightA); tri(1,0,2, 0x000000, darkA); }
                              else if (ori === 'N') { tri(2,1,3, 0xffffff, lightA); tri(0,1,3, 0x000000, darkA); }
                              else /* W */         { tri(1,0,2, 0xffffff, lightA); tri(3,0,2, 0x000000, darkA); }
                            }
                          }
                        }


                // Edge blending between different terrains / elevation steps
                const neighbors = [
                  { dq: 0, dr: -1 }, // N
                  { dq: +1, dr: 0 }, // E
                  { dq: 0, dr: +1 }, // S
                  { dq: -1, dr: 0 }  // W
                ];
                for (let ei = 0; ei < (ISO_MODE ? 4 : 6); ei++) {
                  const nq = q + neighbors[ei].dq; const nr = r + neighbors[ei].dr;
                  if (!inb(nq, nr)) continue;
                  const nIdx = idxAt(nq, nr);
                  if (nIdx <= index) continue; // draw once to avoid double-rendering
                  const nTile = map.tiles[nIdx] as any;
                  const terrDiff = (nTile.terrain ?? terr) !== terr;
                  const elevDiff = (nTile.elevation ?? 0) !== elev;
                  let p0: any; let p1: any;

                  p0 = points[ei]; p1 = points[(ei + 1) % points.length];

                  if (!p0 || !p1) { continue; }

                  if (!terrDiff && !elevDiff) continue;
                  /*

                  const p0 = points[ei]; const p1 = points[(ei + 1) % points.length];
                  */
                  p0 = points[ei]; p1 = points[(ei + 1) % points.length];

                  const w = elevDiff ? 2 : 1;
                  const alpha = ((isVisible ? 0.18 : 0.10) + (elevDiff ? 0.06 : 0)) * terrShadeFactor;
                  g.lineStyle(w, 0x000000, Math.min(0.26, alpha));
                  g.moveTo(p0.x, p0.y);
                  g.lineTo(p1.x, p1.y);
                  g.lineStyle();
                }
              }

            }

            if (isExplored && !isVisible) {
              g.lineStyle(1, 0x0a1a2c, 0.22);
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
              }
              g.closePath();
            }

            // debug: tile center marker
            if (DEBUG_ALIGN) {
              g.lineStyle(0);
              g.beginFill(0xff00ff, 0.9);
              g.drawCircle(0, 0, 1.6);
              g.endFill();
            }
          }}
        />
      );
    });
  }, [exploredTiles, map, onSelectTile, visibleTiles]);
```

```tsx
// (continued)
  const tileOverlays = useMemo(() => {
    return map.tiles
      .map((_: any, index: number) => {
        const q = index % map.width;
        const r = Math.floor(index / map.width);
        const pos = toScreen({ q, r });
        const elev = ((map.tiles[index] as any).elevation ?? 0);
        const posY = pos.y - elev * ELEV_Y_OFFSET;
        const isVisible = visibleTiles.has(index);
        const isExplored = exploredTiles.has(index);
        if (!isExplored) return null;
        return (
          <Graphics
            key={`overlay-${index}`}
            x={pos.x}
            y={posY}
            draw={(g) => {
              g.clear();
              const s = tileSize / 2;
              const hw = hexWidth / 2;
              const pts = ISO_MODE
                ? [
                    { x: 0, y: -(s * 0.5) },
                    { x: hw, y: 0 },
                    { x: 0, y: (s * 0.5) },
                    { x: -hw, y: 0 }
                  ]
                : [
                    { x: 0, y: -s },
                    { x: hw, y: -s / 2 },
                    { x: hw, y: s / 2 },
                    { x: 0, y: s },
                    { x: -hw, y: s / 2 },
                    { x: -hw, y: -s / 2 }
                  ];
              // subtle border (softer)
              g.lineStyle(1, 0x0d1b24, isVisible ? 0.14 : 0.10);
              g.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath();

              // subtle inner shading only for HEX mode; ISO keeps clean tiles
              if (!ISO_MODE) {
                // ensure no stroke on shading triangles
                g.lineStyle();
                const varf = (((q * 31 + r * 57) % 7) - 3) * 0.01;
                // top-left light
                g.beginFill(0xffffff, (isVisible ? 0.06 : 0.03) + varf * 0.3);
                g.moveTo(0, 0);
                g.lineTo(-hw, -s / 2);
                g.lineTo(0, -s);
                g.closePath();
                g.endFill();

                // bottom-right shade
                g.beginFill(0x000000, isVisible ? 0.07 : 0.04);
                g.moveTo(0, 0);
                g.lineTo(hw, s / 2);
                g.lineTo(0, s);
                g.closePath();
                g.endFill();
              }
            }}
          />
        );
      })
        .filter(Boolean) as JSX.Element[];
    }, [map.tiles, map.width, visibleTiles, exploredTiles]);

  // Local helper to keep UI overlays consistent with core movement rules
  const uiCanEnter = (unitType: any, tile: { terrain: string; passable: boolean }) => {
    if (!tile || !tile.passable) return false;
    switch (tile.terrain) {
      case 'forest':
        return unitType === 'infantry' || unitType === 'hero';
      case 'water':
        return unitType === 'air';
      case 'swamp':
        return unitType !== 'air';
      case 'structure':
        return false;
      default:
        return true;
    }
  };

  const movementRangeOverlays = useMemo(() => {
    if (!selectedUnitId) return null;

    // find selected unit in state
    let selected: any | undefined;
    for (const side of Object.values(battleState.sides) as any[]) {
      const u = (side as any).units.get(selectedUnitId);
      if (u) { selected = u; break; }
    }
    if (!selected) return null;

    // Only show for viewer's own unit
    if (viewerFaction && selected.faction !== viewerFaction) return null;

    const start = selected.coordinate as { q: number; r: number };
    const apBudget: number = selected.actionPoints ?? 0;
    if (apBudget <= 0) return null;

    // Build occupied set (exclude self, exclude destroyed)
    const occupied = new Set<string>();
    for (const side of Object.values(battleState.sides) as any[]) {
      for (const other of (side as any).units.values()) {
        if (other.id === selected.id) continue;
        if (other.stance === 'destroyed') continue;
        occupied.add(`${other.coordinate.q},${other.coordinate.r}`);
      }
    }



    const mult = movementMultiplierForStance ? movementMultiplierForStance(selected.stance) : 1;

    // Dijkstra over hex grid up to AP budget
    const best = new Map<string, number>();
    const frontier: Array<{ q: number; r: number; cost: number }> = [{ q: start.q, r: start.r, cost: 0 }];
    best.set(`${start.q},${start.r}`, 0);

    const dirs = ISO_MODE
      ? [
        { dq: 0, dr: -1 }, { dq: 1, dr: -1 }, { dq: 1, dr: 0 }, { dq: 1, dr: 1 },
        { dq: 0, dr: 1 }, { dq: -1, dr: 1 }, { dq: -1, dr: 0 }, { dq: -1, dr: -1 }
      ]
      : [
        { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
      ];

    const inBounds = (q: number, r: number) => q >= 0 && r >= 0 && q < map.width && r < map.height;
    const tileAt = (q: number, r: number) => inBounds(q, r) ? (map as any).tiles[r * map.width + q] : undefined;

    while (frontier.length > 0) {
      // pop node with smallest cost (simple selection; maps are moderate)
      let idx = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[idx].cost) idx = i;
      const { q, r, cost } = frontier.splice(idx, 1)[0];

      for (const d of dirs) {
        const nq = q + d.dq, nr = r + d.dr;
        if (!inBounds(nq, nr)) continue;
        const key = `${nq},${nr}`;
        // cannot move into occupied tiles (except starting tile which we already popped)
        if (occupied.has(key)) continue;
        const tile = tileAt(nq, nr);
        if (!tile || !uiCanEnter(selected.unitType, tile)) continue;
        const step = (tile.movementCostModifier ?? 1) * mult;
        const newCost = cost + step;
        if (newCost > apBudget) continue;
        const prev = best.get(key);
        if (prev == null || newCost < prev) {
          best.set(key, newCost);
          frontier.push({ q: nq, r: nr, cost: newCost });
        }
      }
    }

    // Build overlays
    const elements: JSX.Element[] = [];
    best.forEach((cost, key) => {
      const [qStr, rStr] = key.split(',');
      const q = Number(qStr), r = Number(rStr);
      const idx = r * map.width + q;
      if (!visibleTiles.has(idx)) return; // respect FoW for rendering
      const p = toScreen({ q, r });
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
      const x = p.x;
      const y = p.y - elev * ELEV_Y_OFFSET;
      const leftAP = Math.max(0, apBudget - cost);
      const canShoot = (() => {
        try { return canAffordAttack({ ...(selected as any), actionPoints: Math.floor(leftAP) } as any); }
        catch { return leftAP >= 2; }
      })();

      elements.push(
        <Graphics
          key={`mv-${q}-${r}`}
          x={x}
          y={y}
          draw={(g) => {
            g.clear();
            const s = (tileSize / 2) * 0.92; const hw = (hexWidth / 2) * 0.92;
            const pts = ISO_MODE
              ? [
                  { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                ]
              : [
                  { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
                  { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
                ];
            g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, canShoot ? 0.16 : 0.12);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath(); g.endFill();

            // subtle outline to stand out over terrain overlay
            g.lineStyle(1, canShoot ? 0x6fb3ff : 0x3a78c4, 0.45);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();

            // perimeter ring: draw thicker edges where neighbor is outside range
            g.lineStyle(1, canShoot ? 0x86b7ff : 0x3a78c4, 0.7);
            for (let ei = 0; ei < (ISO_MODE ? 4 : 6); ei++) {
              const d = dirs[ei];
              const nq = q + d.dq, nr = r + d.dr;
              const nkey = `${nq},${nr}`;
              if (!best.has(nkey)) {
                const a = pts[ei];
                const b = pts[(ei + 1) % pts.length];
                if (!a || !b) { continue; }
                g.moveTo(a.x, a.y);
                g.lineTo(b.x, b.y);
              }
            }

          }}
        />
      );
    });

    // Do not draw highlight on the origin tile to avoid clutter

    return elements.filter((el) => (el as any).key !== `mv-${start.q}-${start.r}`);
  }, [battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles]);

  const attackRangeOverlays = useMemo(() => {
    if (!showAttackOverlay || !selectedUnitId) return null;

    // find selected unit
    let selected: any | undefined;
    for (const side of Object.values(battleState.sides) as any[]) {
      const u = (side as any).units.get(selectedUnitId);
      if (u) { selected = u; break; }
    }
    if (!selected) return null;
    if (viewerFaction && selected.faction !== viewerFaction) return null;

    const ranges = Object.keys(selected?.stats?.weaponRanges ?? {});
    const weaponId = ranges[0];
    const maxRange: number = weaponId ? (selected.stats.weaponRanges[weaponId] ?? 0) : 0;
    if (!maxRange || maxRange <= 0) return null;

    const start = selected.coordinate as { q: number; r: number };

    const inRange = new Set<string>();
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const d = ISO_MODE ? Math.max(Math.abs(start.q - q), Math.abs(start.r - r)) : axialDistance(start as any, { q, r } as any);
        if (d <= maxRange) inRange.add(`${q},${r}`);
      }
    }

    const dirs = ISO_MODE
      ? [
        { dq: 0, dr: -1 }, { dq: 1, dr: -1 }, { dq: 1, dr: 0 }, { dq: 1, dr: 1 },
        { dq: 0, dr: 1 }, { dq: -1, dr: 1 }, { dq: -1, dr: 0 }, { dq: -1, dr: -1 }
      ]
      : [
        { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
        { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
      ];

    const elements: JSX.Element[] = [];
    inRange.forEach((_, key) => {
      const [qStr, rStr] = key.split(',');
      const q = Number(qStr), r = Number(rStr);
      const idx = r * map.width + q;
      if (!visibleTiles.has(idx)) return;
      const p = toScreen({ q, r });
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
      const x = p.x;
      const y = p.y - elev * ELEV_Y_OFFSET;

      elements.push(
        <Graphics key={`atk-${q}-${r}`} x={x} y={y} draw={(g) => {
          g.clear();
          const s = (tileSize / 2) * 0.92; const hw = (hexWidth / 2) * 0.92;
          const pts = ISO_MODE
            ? [
                { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
              ]
            : [
                { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
                { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
              ];
          // soft orange fill
          g.beginFill(0xffa726, 0.12);
          g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
          g.closePath();
          g.endFill();

          // ring edges only on perimeter of range
          g.lineStyle(1, 0xffc107, 0.75);
          for (let ei = 0; ei < (ISO_MODE ? 4 : 6); ei++) {
            const d = dirs[ei];
            const nq = q + d.dq, nr = r + d.dr;
            const nkey = `${nq},${nr}`;
            if (!inRange.has(nkey)) {
              const a = pts[ei];
              const b = pts[(ei + 1) % pts.length];
              if (!a || !b) { continue; }
              g.moveTo(a.x, a.y);
              g.lineTo(b.x, b.y);
            }
          }
        }} />
      );
    });

    // don't draw over origin to keep selection ring readable
    return elements.filter((el) => (el as any).key !== `atk-${start.q}-${start.r}`);
  }, [showAttackOverlay, battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles]);
```

```tsx
// (continued)
  const plannedPathOverlay = useMemo(() => {
    if (!plannedPath || plannedPath.length === 0) return null;

    const elements: JSX.Element[] = [];
    for (let i = 0; i < plannedPath.length; i++) {
      const { q, r } = plannedPath[i]!;
      const idx = r * map.width + q;
      if (!visibleTiles.has(idx)) continue;
      const pos = toScreen({ q, r });
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
      const x = pos.x;
      const y = pos.y - elev * ELEV_Y_OFFSET;

      elements.push(
        <Graphics
          key={`path-${i}-${q}-${r}`}
          x={x}
          y={y}
          draw={(g) => {
            g.clear();
            const s = (tileSize / 2) * 0.84; const hw = (hexWidth / 2) * 0.84;
            const pts = ISO_MODE
              ? [
                  { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                ]
              : [
                  { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
                  { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
                ];
            // filled shape with thin outline
            g.beginFill(0x7bdcb5, 0.12);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath(); g.endFill();

            g.lineStyle(1, 0x7bdcb5, 0.6);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();
          }}
        />
      );
    }

    // Link centers to show a path polyline
    const linePoints: Array<{ x: number; y: number }> = plannedPath.map(({ q, r }) => {
      const pos = toScreen({ q, r });
      const elev = ((map.tiles[r * map.width + q] as any).elevation ?? 0);
      return { x: pos.x, y: pos.y - elev * ELEV_Y_OFFSET };
    });
    if (linePoints.length >= 2) {
      elements.push(
        <Graphics key="path-poly" draw={(g) => {
          g.clear();
          g.lineStyle(2, 0x7bdcb5, 0.7);
          g.moveTo(linePoints[0]!.x, linePoints[0]!.y);
          for (let i = 1; i < linePoints.length; i++) g.lineTo(linePoints[i]!.x, linePoints[i]!.y);
        }} />
      );
    }

    return elements;
  }, [plannedPath, map.width, map.height, visibleTiles]);
```

```tsx
// (continued)
  // Vertical walls/cliffs pass using snapped corners + min–max test (delta > 0)
  const wallGraphics = useMemo(() => {
    if (!ISO_MODE) return null;
    const w = map.width, h = map.height;
    const idxAt = (qq: number, rr: number) => rr * w + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < w && rr < h;
    const tileAt = (qq: number, rr: number) => (inb(qq, rr) ? (map.tiles[idxAt(qq, rr)] as any) : undefined);
    const neighbors = [
      { dq: 0, dr: -1, dir: 'N' as const },
      { dq: +1, dr: 0, dir: 'E' as const },
      { dq: 0, dr: +1, dir: 'S' as const },
      { dq: -1, dr: 0, dir: 'W' as const },
    ];
    const opp: Record<'N'|'E'|'S'|'W','N'|'E'|'S'|'W'> = { N: 'S', E: 'W', S: 'N', W: 'E' };
    const getEdgeCorners = (q: number, r: number, dir: 'N'|'E'|'S'|'W') => {
      const c = snappedCorners.getCorners(q, r);
      if (dir === 'N') return [c.hNW, c.hNE] as const;
      if (dir === 'E') return [c.hNE, c.hSE] as const;
      if (dir === 'S') return [c.hSW, c.hSE] as const;
      return [c.hNW, c.hSW] as const; // W
    };
    const hasSlopeEdgeFromHigher = (qq: number, rr: number, dir: 'N'|'E'|'S'|'W') => {
      const t = tileAt(qq, rr); if (!t) return false;
      const nt = tileAt(qq + (dir==='E'?1:dir==='W'?-1:0), rr + (dir==='S'?1:dir==='N'?-1:0)); if (!nt) return false;
      const eHere = (t.elevation ?? 0), eNei = (nt.elevation ?? 0);
      if (eHere - eNei !== 1) return false;
      const markHere = (t.elevEdges?.[dir] === 'slope');
      const markNei = (nt.elevEdges?.[opp[dir]] === 'slope');
      return markHere || markNei;
    };

    const faces: JSX.Element[] = [];

    for (let r = 0; r < h; r++) {
      for (let q = 0; q < w; q++) {
        const me = tileAt(q, r); if (!me) continue;
        const myIdx = idxAt(q, r);
        if (!exploredTiles.has(myIdx)) continue; // don't draw in fog unexplored
        const base = toScreen({ q, r });
        const elev = (me.elevation ?? 0);
        const baseY = base.y - elev * ELEV_Y_OFFSET;

        for (const n of neighbors) {
          const nq = q + n.dq, nr = r + n.dr;
          if (!inb(nq, nr)) continue;
          const nei = tileAt(nq, nr)!;
          // per-edge min–max delta using snapped vertices
          const myEdge = getEdgeCorners(q, r, n.dir);
          const opEdge = getEdgeCorners(nq, nr, opp[n.dir]);
          const delta = Math.min(myEdge[0], myEdge[1]) - Math.max(opEdge[0], opEdge[1]);
          if (delta <= 0) continue; // no wall if equal or lower (this also removes wall under slope)

          // If this edge is a slope from higher tile, skip vertical wall completely
          if (hasSlopeEdgeFromHigher(q, r, n.dir)) continue;

          // Visibility: draw only once for the higher tile to avoid z-fighting; also require FoW visibility of higher tile
          if (!visibleTiles.has(myIdx)) continue;

          // Geometry: vertical quad between the two corner points projected down by CLIFF_DEPTH*delta
          const p0 = toScreen({ q, r });
          const p1 = toScreen({ q: nq, r: nr });
          // choose top edge endpoints in screen space for this direction (use diamond corners)
          const halfW = ISO_TILE_W / 2, halfH = ISO_TILE_H / 2;
          let topA: {x:number;y:number}, topB: {x:number;y:number};
          if (n.dir === 'N') { topA = { x: base.x - halfW, y: baseY }; topB = { x: base.x + halfW, y: baseY }; }
          else if (n.dir === 'E') { topA = { x: base.x + halfW, y: baseY }; topB = { x: base.x, y: baseY + halfH }; }
          else if (n.dir === 'S') { topA = { x: base.x + halfW, y: baseY }; topB = { x: base.x - halfW, y: baseY }; }
          else /* W */ { topA = { x: base.x - halfW, y: baseY }; topB = { x: base.x, y: baseY + halfH }; }
          const depth = CLIFF_DEPTH * delta;
          const botA = { x: topA.x, y: topA.y + depth };
          const botB = { x: topB.x, y: topB.y + depth };

          const color = (n.dir === 'E') ? 0x0b0f17 : 0x0f1520; // E darker than S/W so it reads as the right face
          const alpha = (n.dir === 'E') ? 0.82 : 0.74;

          faces.push(
            <Graphics key={`wall-${q}-${r}-${n.dir}`}
              draw={(g) => {
                g.clear();
                g.beginFill(color, alpha);
                g.moveTo(topA.x, topA.y);
                g.lineTo(topB.x, topB.y);
                g.lineTo(botB.x, botB.y);
                g.lineTo(botA.x, botA.y);
                g.closePath();
                g.endFill();

                // subtle top rim highlight
                g.lineStyle(1, 0xffffff, 0.16);
                g.moveTo(topA.x, topA.y);
                g.lineTo(topB.x, topB.y);
                g.lineStyle();
              }}
            />
          );
        }
      }
    }
    return faces;
  }, [ISO_MODE, map.tiles, map.width, map.height, visibleTiles, exploredTiles, snappedCorners]);
```

```tsx
// (continued)
  // Render order summary (ground -> overlays -> units -> walls):
  // - Ground tiles/patterns/shading
  // - Tile overlays (selection/grid/movement/attack)
  // - Units and markers
  // - Vertical walls/cliffs on top to occlude what is behind
  return (
    <Stage width={stageDimensions.width} height={stageDimensions.height} options={{ background: 0x03070b }}
           style={{
             width: Math.round(stageDimensions.width * scale),
             height: Math.round(stageDimensions.height * scale),
             transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
             transformOrigin: 'top left'
           }}>
      {/* Ground pass */}
      {tileGraphics}

      {/* Soft tile borders in FoW */}
      {tileOverlays}

      {/* Movement and attack overlays */}
      {movementRangeOverlays}
      {attackRangeOverlays}

      {/* Planned path */}
      {plannedPathOverlay}

      {/* Units would be here (omitted for brevity in this excerpt) */}

      {/* Walls last */}
      {wallGraphics}
    </Stage>
  );
```
