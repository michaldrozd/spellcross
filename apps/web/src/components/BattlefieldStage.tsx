import { Container, Graphics, Sprite, Stage, Text } from '@pixi/react';
import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance, MapProp, MapTile, EdgeDir } from '@spellcross/core';
import { movementMultiplierForStance } from '@spellcross/core';
import { canAffordAttack } from '@spellcross/core';
import { axialDistance } from '@spellcross/core';
import { calculateAttackRange } from '@spellcross/core';
import type { DisplayObject, FederatedPointerEvent, Graphics as PixiGraphics } from 'pixi.js';
import { BaseTexture, Matrix, Texture, Rectangle, Polygon, MIPMAP_MODES, SCALE_MODES, WRAP_MODES, settings } from 'pixi.js';
import { TextStyle } from 'pixi.js';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ARTILLERY_TRAIL_FRACTION,
  CORPSE_TTL_MS,
  DEATH_REACTION_HOLD_MS,
  SMALL_ARMS_DEBRIS_COUNT,
  SMALL_ARMS_DEBRIS_LIFETIME_MS,
  WRECK_SMOKE_ANIMATION_MS,
  activeKillingEffectForTarget,
  combatImpactWindowMs,
  combatEffectTiming,
  deathMarkerFade,
  deathMarkerExpired,
  deathMarkerVisible,
  deathReactionAlpha,
  firearmVisualProfile,
  smallArmsDebrisValue,
  type CombatEffectType
} from './combatVisuals.js';
import {
  DIRECTIONAL_UNIT_ANCHOR_Y,
  DIRECTIONAL_UNIT_ASSET_VERSION,
  DIRECTIONAL_UNIT_FRAME_SIZES,
  DIRECTIONAL_UNIT_GROUND_BIAS,
  DIRECTIONAL_UNIT_SOURCE_HEIGHTS,
  RASTER_UNIT_ANCHOR_Y,
  RASTER_UNIT_VISIBLE_HEIGHTS,
  UNIT_SHEET_DIRECTIONS,
  UNIT_SHEET_FRAME_SIZE,
  battlefieldDirectionalSprite,
  blockedRangeOverlayStyle,
  canMovingUnitFadeCanopy,
  deathMarkerDetailVisible,
  deathMarkerSpriteTransform,
  deathMarkerVisualClass,
  directionalSpriteGroundOffset,
  featheredOcclusionAlpha,
  isSupportVehicleDefinition,
  infantryGroundMotion,
  directionNameForOrientation,
  directionNameForScreenVector,
  leavesMechanicalWreck,
  rasterUnitOverride,
  rasterVehiclePose,
  rangeOverlayStyle,
  quantizeMovementOcclusionCoordinate,
  resolveMovementFrame,
  unitContactFootprint,
  unitPointerArea,
  unitVisualHeight,
  vehicleDustEnvelope,
  vehicleGearPhase,
  vehicleMotionEnvelope,
  vehicleRunningGearKind,
  vehicleSheetDirectionNameForOrientation,
  vehicleSheetDirectionNameForScreenVector,
  vehicleTurnSheetBlend,
  vehicleTurnCrossfade,
  vehicleTurnRotation,
  vehicleTurnScaleX,
  vehicleTurnScaleY,
  type UnitPointerArea
} from './unitVisuals.js';
const basename = (p: string) => {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
};
const assetUrl = (path: string) => (path.startsWith('/') ? path : `/${path}`);
BaseTexture.defaultOptions.scaleMode = SCALE_MODES.LINEAR;
settings.ROUND_PIXELS = true;

const webglContextNames = ['webgl2', 'webgl', 'experimental-webgl'] as const;
const EMPTY_TILE_SET = new Set<number>();
const VEHICLE_SIDE_OFFSETS = [-1, 1] as const;
const WHEELED_AXLE_POSITIONS = [-0.43, -0.13, 0.42] as const;

const hasWebGLRenderer = () => {
  if (typeof document === 'undefined') return true;

  try {
    const canvas = document.createElement('canvas');
    return webglContextNames.some((name) => Boolean(canvas.getContext(name)));
  } catch {
    return false;
  }
};

const crispTexture = (texture: Texture) => {
  const baseTexture = texture.baseTexture;
  if (baseTexture) {
    baseTexture.scaleMode = SCALE_MODES.LINEAR;
    baseTexture.mipmap = MIPMAP_MODES.OFF;
    baseTexture.update?.();
  }
  return texture;
};

// Painted iso building sprites used in place of the flat procedural boxes. keepTop crops the
// baked-in ground base off the bottom of each 1024² asset so it sits cleanly on the terrain.
// scaleAdj normalizes each sprite to a consistent on-tile FOOTPRINT: the generated art fills its
// 1024² frame by wildly different amounts (base width 54%–99%), so without this a wide-base sprite
// renders a far bigger footprint than a narrow one at the same scale. Measured from each asset's
// opaque base width at the keepTop crop line and normalized to the median (≈0.74), clamped [0.74,1.4].
const PAINTED_BUILDINGS: Array<{ tex: string; keepTop: number; scaleAdj?: number }> = [
  { tex: 'assets/generated/building_16.png', keepTop: 0.86, scaleAdj: 1.14 },
  { tex: 'assets/generated/hangar_building.png', keepTop: 0.84, scaleAdj: 1.40 },
  { tex: 'assets/generated/watchtower.png', keepTop: 0.86, scaleAdj: 0.75 },
  { tex: 'assets/generated/ruins_building.png', keepTop: 0.80, scaleAdj: 0.82 }, // tall sprite — extra trim so it doesn't tower
  // 16 additional building variants so dense districts don't repeat the same few sprites. keepTop crops
  // the thick 3-D soil plinth off the bottom of each diorama base — left on, a building's plinth juts
  // down-screen into the building below it and they read as glued together even when properly spaced.
  { tex: 'assets/generated/building_01.png', keepTop: 0.86, scaleAdj: 1.05 }, // brick apartment block
  { tex: 'assets/generated/building_02.png', keepTop: 0.86, scaleAdj: 1.05 }, // concrete apartment tower
  { tex: 'assets/generated/building_03.png', keepTop: 0.86, scaleAdj: 1.21 }, // brick townhouse
  { tex: 'assets/generated/building_04.png', keepTop: 0.86, scaleAdj: 1.28 }, // red-tile cottage
  { tex: 'assets/generated/building_05.png', keepTop: 0.86, scaleAdj: 0.92 }, // thatched cottage
  { tex: 'assets/generated/building_06.png', keepTop: 0.86, scaleAdj: 0.88 }, // corner shop
  { tex: 'assets/generated/building_07.png', keepTop: 0.86, scaleAdj: 0.81 }, // stone church
  { tex: 'assets/generated/building_08.png', keepTop: 0.86, scaleAdj: 0.81 }, // factory with chimney
  { tex: 'assets/generated/building_09.png', keepTop: 0.86, scaleAdj: 1.37 }, // warehouse
  { tex: 'assets/generated/building_10.png', keepTop: 0.86, scaleAdj: 0.88 }, // wooden barn
  { tex: 'assets/generated/building_11.png', keepTop: 0.86, scaleAdj: 1.12 }, // water tower
  { tex: 'assets/generated/building_12.png', keepTop: 0.86, scaleAdj: 0.85 }, // grain silos
  { tex: 'assets/generated/building_13.png', keepTop: 0.86, scaleAdj: 0.93 }, // ruined apartment block
  { tex: 'assets/generated/building_14.png', keepTop: 0.86, scaleAdj: 0.99 }, // ruined house
  { tex: 'assets/generated/building_15.png', keepTop: 0.86, scaleAdj: 0.95 }, // ruined factory shell
  { tex: 'assets/generated/building_16.png', keepTop: 0.86, scaleAdj: 1.14 }  // command post / bunker HQ
];

const hashStringToIndex = (s: string, mod: number) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
};

const croppedBuildingTextureCache = new Map<string, Texture>();
// Crop the baked-in diorama base off the bottom of a building asset AND feather the cut so it blends
// into the terrain. A plain rectangular crop left a hard horizontal line across the building's base
// ("the image looks cut off at the bottom"); fading the bottom few percent to transparent removes it.
const buildFeatheredCrop = (base: Texture['baseTexture'], keepTop: number): Texture | null => {
  const src = (base.resource as { source?: CanvasImageSource })?.source;
  if (!src) return null;
  const w = Math.max(1, base.realWidth || 1024);
  const fullH = Math.max(1, base.realHeight || 1024);
  const h = Math.max(1, Math.round(fullH * keepTop));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  const feather = Math.max(2, Math.round(h * 0.07));
  ctx.globalCompositeOperation = 'destination-out';
  const grad = ctx.createLinearGradient(0, h - feather, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, h - feather, w, feather);
  ctx.globalCompositeOperation = 'source-over';
  return crispTexture(Texture.from(canvas));
};
const getCroppedBuildingTexture = (rawPath: string, keepTop: number): Texture => {
  const key = `${rawPath}@${keepTop}`;
  const cached = croppedBuildingTextureCache.get(key);
  if (cached) return cached;
  const full = crispTexture(Texture.from(rawPath.startsWith('/') ? rawPath : `/${rawPath}`));
  const base = full.baseTexture;
  if (keepTop >= 1) {
    croppedBuildingTextureCache.set(key, full);
    return full;
  }
  const frameFor = () =>
    new Rectangle(0, 0, base.realWidth || 1024, Math.round((base.realHeight || 1024) * keepTop));
  // Hard-cropped texture for immediate use; upgraded to the feathered version once pixels are available.
  const hardCropped = new Texture(base, frameFor());
  if (base.valid) {
    const feathered = buildFeatheredCrop(base, keepTop);
    const tex = feathered ?? hardCropped;
    croppedBuildingTextureCache.set(key, tex);
    return tex;
  }
  croppedBuildingTextureCache.set(key, hardCropped);
  base.once('loaded', () => {
    const feathered = buildFeatheredCrop(base, keepTop);
    if (feathered) {
      // Repoint the already-mounted texture at the feathered canvas in place. Replacing only the cache
      // entry left live sprites holding the hard-cropped reference until an unrelated re-render swapped it.
      hardCropped.baseTexture = feathered.baseTexture;
      hardCropped.frame = feathered.frame.clone();
      hardCropped.orig = feathered.orig.clone();
      hardCropped.updateUvs();
      hardCropped.update();
      croppedBuildingTextureCache.set(key, hardCropped);
    } else {
      hardCropped.frame = frameFor();
      hardCropped.updateUvs();
    }
  });
  return hardCropped;
};

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)
const SHAKE_MAX_PX = 10; // peak camera shake amplitude at full trauma


// Isometric elevation illusion parameters
const ELEV_Y_OFFSET = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // vertical pixel offset per elevation level (screen)
const CLIFF_DEPTH   = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // sheer cliff face height per level

const terrainPalette: Record<string, number> = {
  plain: 0x5d9040,
  road: 0x756650,
  forest: 0x27451f,
  urban: 0x625f57,
  hill: 0x7a7038,
  water: 0x226480,
  swamp: 0x33483a,
  structure: 0x62584b
};

export interface AttackEffect {
  id: string;
  attackerId: string;
  targetId: string;
  timelineStartIndex?: number;
  timelineEndIndex?: number;
  sourceVisible?: boolean;
  targetVisible?: boolean;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  startTime: number;
  type: CombatEffectType;
  damage?: number;
  moraleDamage?: number;
  hit?: boolean;
  killed: boolean;
  arc?: boolean; // indirect fire (mortar/howitzer/rocket) — the shell lobs in a high ballistic arc
  suppressive?: boolean;
}

export interface MovingUnit {
  unitId: string;
  path: HexCoordinate[];
  startTime: number;
  stepDuration: number;
  preAlignDuration?: number;
  segmentTurnDuration?: number;
  initialOrientation?: number;
}

export interface InvalidMoveFeedback {
  coordinate: HexCoordinate;
  time: number;
  message?: string;
}

export interface ArrivalEffect {
  id: string;
  coordinate: HexCoordinate;
  faction: FactionId;
  startTime: number;
}

export type ScenarioEventVisualKind = 'revealObjective' | 'transformTerrain' | 'pressurePulse';

export interface ScenarioEventVisualEffect {
  id: string;
  kind: ScenarioEventVisualKind;
  coordinate: HexCoordinate;
  faction: FactionId;
  startTime: number;
}

export function scenarioEventVisualStyle(kind: ScenarioEventVisualKind) {
  switch (kind) {
    case 'revealObjective':
      return { primary: 0x4ed6c4, glow: 0xc5fff3, shape: 'beacon' as const };
    case 'transformTerrain':
      return { primary: 0xe8a64a, glow: 0xffe0a3, shape: 'fracture' as const };
    case 'pressurePulse':
      return { primary: 0xd84b91, glow: 0xffb0dd, shape: 'rings' as const };
  }
}

export interface BattlefieldStageProps {
  battleState: TacticalBattleState;
  battleIdentity?: string;
  onSelectUnit?: (unitId: string) => void;
  onSelectTile?: (coordinate: HexCoordinate) => void;
  plannedPath?: HexCoordinate[];
  plannedDestination?: HexCoordinate;
  threatenedTiles?: string[]; // coordinateKey list of planned-path tiles under enemy reaction fire
  invalidMoveFeedback?: InvalidMoveFeedback | null;
  targetUnitId?: string;
  focusTargetUnitId?: string;
  restoreCameraSignal?: number;
  deployMode?: boolean;
  targetHitChance?: number; // 0-1, hit chance to display on target
  targetDamagePreview?: number; // predicted damage to show
  targetLethal?: boolean; // the previewed shot would kill the target
  onUnitHover?: (unitId: string | null) => void;
  selectedUnitId?: string;
  viewerFaction?: FactionId;
  width?: number;
  height?: number;
  cameraMode?: 'fit' | 'follow';
  showAttackOverlay?: boolean;
  rangeOverlayCoords?: Set<string>;
  blockedRangeOverlayCoords?: Set<string>;
  objectiveCoords?: HexCoordinate[];
  startZoneCoords?: HexCoordinate[];
  attackEffects?: AttackEffect[];
  arrivalEffects?: ArrivalEffect[];
  scenarioEventEffects?: ScenarioEventVisualEffect[];
  movingUnit?: MovingUnit | null;
}

type DeathMarker = {
  id: string;
  killingEffectId?: string;
  q: number;
  r: number;
  t: number;
  faction: FactionId;
  unitType?: string;
  definitionId: string;
  orientation: number;
};

// Dev/E2E camera hook installed on window while the stage is mounted.
type BattleCameraWindow = Window & {
  __battleCamera?: {
    centerOnCoord: (q: number, r: number) => boolean;
    centerOnWorld: (x: number, y: number) => boolean;
    screenForCoord: (q: number, r: number) => { x: number; y: number };
    setZoom: (next: number) => number;
    metrics: () => { centerX: number; centerY: number; scale: number; stageWidth: number; stageHeight: number };
  };
};

// Some maps carry pre-baked per-corner heights the core MapTile schema doesn't know about.
type RendererTile = MapTile & { cornerHeights?: Record<CornerKey, number> };

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
function makeCanvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 64, h = 64) {


  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, w, h);
  return crispTexture(Texture.from(canvas));
}

function hexToRgb(hex: number) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}


function mixColor(source: number, target: number, t: number) {
  const sr = (source >> 16) & 0xff;
  const sg = (source >> 8) & 0xff;
  const sb = source & 0xff;
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return (lerp(sr, tr) << 16) | (lerp(sg, tg) << 8) | lerp(sb, tb);
}

// Explored-but-not-visible ("remembered") ground: desaturate toward its own luminance and cool-tint it,
// so memory tiles read as a blue-grey recollection rather than just a dimmer version of live terrain.
function memoryColor(c: number) {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  const lum = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  const grey = (lum << 16) | (lum << 8) | lum;
  return mixColor(mixColor(c, grey, 0.5), 0x1c2a3a, 0.2);
}

const lightenColor = (color: number, amount: number) => mixColor(color, 0xffffff, amount);
const darkenColor = (color: number, amount: number) => mixColor(color, 0x000000, amount);
const tileNoise = (q: number, r: number, salt: number) => {
  const value = Math.sin(q * 127.1 + r * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

export const smoothTerrainNoise = (q: number, r: number, salt: number, scale = 4) => {
  const safeScale = Math.max(1, scale);
  const gridQ = q / safeScale;
  const gridR = r / safeScale;
  const q0 = Math.floor(gridQ);
  const r0 = Math.floor(gridR);
  const tq = gridQ - q0;
  const tr = gridR - r0;
  const ease = (amount: number) => amount * amount * (3 - 2 * amount);
  const blend = (from: number, to: number, amount: number) => from + (to - from) * amount;
  const north = blend(tileNoise(q0, r0, salt), tileNoise(q0 + 1, r0, salt), ease(tq));
  const south = blend(tileNoise(q0, r0 + 1, salt), tileNoise(q0 + 1, r0 + 1, salt), ease(tq));
  return blend(north, south, ease(tr));
};

export type TerrainDetailFamily = 'vegetation' | 'built' | 'wet';

export const terrainDetailFamily = (terrain: string): TerrainDetailFamily => {
  if (terrain === 'water' || terrain === 'swamp') return 'wet';
  if (terrain === 'road' || terrain === 'urban' || terrain === 'structure') return 'built';
  return 'vegetation';
};

export const terrainMacroPattern = (x: number, y: number) => {
  const tau = Math.PI * 2;
  const broad = Math.sin(tau * (x * 2 + y)) + Math.cos(tau * (x - y * 2));
  const medium = Math.sin(tau * (x * 5 - y * 3)) * 0.48;
  const fine = Math.cos(tau * (x * 9 + y * 7)) * 0.18;
  return Math.max(0, Math.min(1, 0.5 + broad * 0.18 + medium * 0.13 + fine * 0.08));
};

export const worldTextureMatrix = (worldX: number, worldY: number, worldUnitsPerTexel: number) => {
  const scale = Math.max(0.01, worldUnitsPerTexel);
  const matrix = new Matrix();
  // Graphics texture fills invert this matrix before producing UVs. Supplying the
  // world-to-local transform here makes the resulting UV equal (local + world) / scale.
  matrix.scale(scale, scale);
  matrix.translate(-worldX, -worldY);
  return matrix;
};

export const terrainTextureWorldUnitsPerTexel = (terrain: string) => (
  terrain === 'structure' ? 2.8 : 0.92
);

const PROCEDURAL_BUILDING_UNDERLAY_ORDER: readonly MapTile['terrain'][] = [
  'urban',
  'plain',
  'road',
  'forest',
  'hill',
  'swamp'
];

export const proceduralBuildingUnderlayTerrain = (
  tiles: readonly Pick<MapTile, 'terrain'>[],
  props: readonly MapProp[],
  width: number,
  height: number
) => {
  const underlayByTile = new Map<number, MapTile['terrain']>();
  const inBounds = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
  const tileIndex = (q: number, r: number) => r * width + q;

  for (const prop of props) {
    if (prop.kind !== 'proc-building') continue;
    const footprint = new Set<number>();
    if (prop.tiles?.length) {
      for (const coordinate of prop.tiles) {
        if (inBounds(coordinate.q, coordinate.r)) footprint.add(tileIndex(coordinate.q, coordinate.r));
      }
    } else {
      const footprintWidth = Math.max(1, prop.w ?? 1);
      const footprintHeight = Math.max(1, prop.h ?? 1);
      for (let dq = 0; dq < footprintWidth; dq += 1) {
        for (let dr = 0; dr < footprintHeight; dr += 1) {
          const q = prop.coordinate.q + dq;
          const r = prop.coordinate.r + dr;
          if (inBounds(q, r)) footprint.add(tileIndex(q, r));
        }
      }
    }

    const candidateCounts = new Map<MapTile['terrain'], number>();
    for (const index of footprint) {
      const q = index % width;
      const r = Math.floor(index / width);
      for (let dq = -1; dq <= 1; dq += 1) {
        for (let dr = -1; dr <= 1; dr += 1) {
          if (dq === 0 && dr === 0) continue;
          const neighborQ = q + dq;
          const neighborR = r + dr;
          if (!inBounds(neighborQ, neighborR)) continue;
          const neighborIndex = tileIndex(neighborQ, neighborR);
          if (footprint.has(neighborIndex)) continue;
          const terrain = tiles[neighborIndex]?.terrain;
          if (!terrain || terrain === 'structure' || terrain === 'water') continue;
          candidateCounts.set(terrain, (candidateCounts.get(terrain) ?? 0) + 1);
        }
      }
    }

    const underlay = [...candidateCounts].sort((a, b) => {
      const countDifference = b[1] - a[1];
      if (countDifference !== 0) return countDifference;
      return PROCEDURAL_BUILDING_UNDERLAY_ORDER.indexOf(a[0])
        - PROCEDURAL_BUILDING_UNDERLAY_ORDER.indexOf(b[0]);
    })[0]?.[0];

    if (!underlay) continue;

    for (const index of footprint) {
      if (tiles[index]?.terrain === 'structure') underlayByTile.set(index, underlay);
    }
  }

  return underlayByTile;
};

export const presentationTerrainAt = (
  tiles: readonly Pick<MapTile, 'terrain'>[],
  underlayByTile: ReadonlyMap<number, MapTile['terrain']>,
  index: number
) => underlayByTile.get(index) ?? tiles[index]?.terrain ?? 'plain';

export const terrainDestructionRevision = (
  events: readonly { kind: string; effectKinds?: readonly string[] }[]
) => (
  events.reduce((revision, event) => revision + (
    event.kind === 'tile:destroyed'
    || (event.kind === 'scenario:event' && event.effectKinds?.includes('transformTerrain'))
      ? 1
      : 0
  ), 0)
);

export const terrainDetailDensity = (q: number, r: number, terrain: string) => {
  const familySalt = terrainDetailFamily(terrain) === 'vegetation'
    ? 761
    : terrainDetailFamily(terrain) === 'built'
      ? 829
      : 887;
  const broad = smoothTerrainNoise(q, r, familySalt, 6.4);
  const medium = smoothTerrainNoise(q, r, familySalt + 19, 3.1);
  return clamp(0.22 + broad * 0.68 + medium * 0.2, 0.24, 1.08);
};

export const TERRAIN_GRID_ALPHA = 0.022;
export const TERRAIN_WASH_VISIBILITY_RADIUS = 4;

export type SoftShadowLayer = {
  scaleX: number;
  scaleY: number;
  alpha: number;
};

export const softShadowLayers = (strength: number): SoftShadowLayer[] => {
  const alpha = clamp(strength, 0, 1);
  return [
    { scaleX: 1.24, scaleY: 1.3, alpha: alpha * 0.2 },
    { scaleX: 1.04, scaleY: 1.08, alpha: alpha * 0.32 },
    { scaleX: 0.82, scaleY: 0.78, alpha: alpha * 0.48 }
  ];
};

export type BuildingVisibilityPresentation = {
  containerAlpha: number;
  spriteAlpha: number;
  spriteTint: number;
  shadowStrength: number;
};

export const buildingVisibilityPresentation = (
  visible: boolean,
  occlusionAlpha: number
): BuildingVisibilityPresentation => {
  if (visible) {
    return {
      containerAlpha: clamp(occlusionAlpha, 0, 1),
      spriteAlpha: 1,
      spriteTint: 0xf2ead8,
      shadowStrength: 1
    };
  }
  return {
    containerAlpha: clamp(occlusionAlpha, 0, 1),
    spriteAlpha: 1,
    spriteTint: 0x748079,
    shadowStrength: 0.72
  };
};

const snapCameraScale = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(0.5, Math.round(value * 4) / 4);
};

// Capped at 3x: past ~3x the painted ground textures magnify beyond their native resolution and go
// soft/"rastery". Keeping the ceiling here means the ground stays crisp at every zoom the player can reach.
const CAMERA_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

const nextCameraScale = (current: number, direction: 'in' | 'out') => {
  const scale = snapCameraScale(current);
  if (direction === 'in') {
    return CAMERA_ZOOM_STEPS.find((step) => step > scale + 0.001) ?? CAMERA_ZOOM_STEPS[CAMERA_ZOOM_STEPS.length - 1];
  }
  return [...CAMERA_ZOOM_STEPS].reverse().find((step) => step < scale - 0.001) ?? CAMERA_ZOOM_STEPS[0];
};

const clampCameraScale = (value: number) => Math.min(CAMERA_ZOOM_STEPS[CAMERA_ZOOM_STEPS.length - 1], Math.max(CAMERA_ZOOM_STEPS[0], value));

type CornerKey = 'NW' | 'NE' | 'SE' | 'SW';
type EdgeKey = 'N' | 'E' | 'S' | 'W';

const CORNER_OFFSETS: Record<CornerKey, { x: number; y: number }> = {
  NW: { x: 0, y: -(ISO_TILE_H / 2) },
  NE: { x: ISO_TILE_W / 2, y: 0 },
  SE: { x: 0, y: ISO_TILE_H / 2 },
  SW: { x: -(ISO_TILE_W / 2), y: 0 }
};

const EDGE_TO_CORNERS: Record<EdgeKey, [CornerKey, CornerKey]> = {
  N: ['NW', 'NE'],
  E: ['NE', 'SE'],
  S: ['SE', 'SW'],
  W: ['SW', 'NW']
};

const OPP_EDGE: Record<EdgeKey, EdgeKey> = { N: 'S', E: 'W', S: 'N', W: 'E' };

const segmentOrientation = (fromCoord: HexCoordinate, toCoord: HexCoordinate) => {
  const dq = toCoord.q - fromCoord.q;
  const dr = toCoord.r - fromCoord.r;
  if (dq > 0 && dr === 0) return 0;
  if (dq > 0 && dr < 0) return 1;
  if (dq === 0 && dr < 0) return 2;
  if (dq < 0 && dr === 0) return 3;
  if (dq < 0 && dr > 0) return 4;
  if (dq === 0 && dr > 0) return 5;
  if (dq > 0 && dr > 0) return 6;
  if (dq < 0 && dr < 0) return 7;
  return 0;
};

type InteractionUnit = {
  id: string;
  faction: FactionId;
  coordinate: HexCoordinate;
  hitArea: UnitPointerArea;
  x: number;
  y: number;
  z: number;
};

// Fraction of a sprite frame's height that is transparent padding above the visible figure.
// Sheets vary wildly (≈3% for the tank, ≈37% for the M113), so a fixed status-bar offset
// either floats above short figures or bites into tall ones. We scan the real top of the
// artwork once per texture frame and cache it, so bars can anchor to the visible head.
const spriteContentTopFracCache = new Map<string, number>();
function spriteContentTopFrac(texture: Texture | null | undefined): number {
  if (!texture || !texture.baseTexture?.valid) return 0.12;
  const fr = texture.frame;
  const key = `${texture.baseTexture.uid}:${Math.round(fr.x)},${Math.round(fr.y)},${Math.round(fr.width)}x${Math.round(fr.height)}`;
  const cached = spriteContentTopFracCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const source = (texture.baseTexture.resource as { source?: CanvasImageSource })?.source;
    if (!source) return 0.12;
    const fw = Math.max(1, Math.round(fr.width));
    const fh = Math.max(1, Math.round(fr.height));
    const probe = document.createElement('canvas');
    probe.width = fw;
    probe.height = fh;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0.12;
    ctx.drawImage(source, fr.x, fr.y, fw, fh, 0, 0, fw, fh);
    const alpha = ctx.getImageData(0, 0, fw, fh).data;
    const step = fw > 96 ? 3 : 1;
    let topRow = -1;
    for (let y = 0; y < fh && topRow < 0; y++) {
      for (let x = 0; x < fw; x += step) {
        if (alpha[(y * fw + x) * 4 + 3] > 24) { topRow = y; break; }
      }
    }
    const frac = topRow < 0 ? 0.12 : topRow / fh;
    spriteContentTopFracCache.set(key, frac);
    return frac;
  } catch {
    return 0.12;
  }
}

function orientationScreenVector(orientation: number) {
  const normalized = ((Math.round(orientation) % 8) + 8) % 8;
  const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
    { q: 1, r: 1 },
    { q: -1, r: -1 }
  ];
  const dir = directions[normalized] ?? directions[0];
  const p = toScreen(dir);
  const len = Math.max(1, Math.hypot(p.x, p.y));
  return { x: p.x / len, y: p.y / len };
}

function screenVectorBetween(from: HexCoordinate, to: HexCoordinate) {
  const fromScreen = toScreen(from);
  const toScreenPoint = toScreen(to);
  const dx = toScreenPoint.x - fromScreen.x;
  const dy = toScreenPoint.y - fromScreen.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  return { x: dx / len, y: dy / len };
}

function mixScreenVectors(a: { x: number; y: number }, b: { x: number; y: number }, amount: number) {
  const x = a.x + (b.x - a.x) * amount;
  const y = a.y + (b.y - a.y) * amount;
  const len = Math.max(1, Math.hypot(x, y));
  return { x: x / len, y: y / len };
}

function screenVectorForDirectionName(direction: string) {
  const diagonal = Math.SQRT1_2;
  const vectors: Record<string, { x: number; y: number }> = {
    e: { x: 1, y: 0 },
    se: { x: diagonal, y: diagonal },
    s: { x: 0, y: 1 },
    sw: { x: -diagonal, y: diagonal },
    w: { x: -1, y: 0 },
    nw: { x: -diagonal, y: -diagonal },
    n: { x: 0, y: -1 },
    ne: { x: diagonal, y: -diagonal }
  };
  return vectors[direction] ?? vectors.e;
}

const directionalUnitSheetPath = (spriteName: string, state: 'idle' | 'walk') => {
  const assetVersion = DIRECTIONAL_UNIT_ASSET_VERSION[spriteName];
  return `/assets/generated/${spriteName}_${state}_sheet.png${assetVersion ? `?v=${assetVersion}` : ''}`;
};

const unitSheetTexture = (
  cache: Map<string, Texture>,
  spriteName: string,
  state: 'idle' | 'walk',
  direction: string,
  frame: number
) => {
  const sheetPath = directionalUnitSheetPath(spriteName, state);
  const frameSize = DIRECTIONAL_UNIT_FRAME_SIZES[spriteName] ?? { width: UNIT_SHEET_FRAME_SIZE, height: UNIT_SHEET_FRAME_SIZE };
  const directionIndex = Math.max(0, UNIT_SHEET_DIRECTIONS.indexOf(direction));
  const frameIndex = state === 'walk' ? Math.max(0, Math.min(3, frame)) : 0;
  const key = `${sheetPath}:${directionIndex}:${frameIndex}:${frameSize.width}x${frameSize.height}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const sheet = cache.get(sheetPath) ?? crispTexture(Texture.from(sheetPath));
  cache.set(sheetPath, sheet);
  const texture = crispTexture(new Texture(
    sheet.baseTexture,
    new Rectangle(
      directionIndex * frameSize.width,
      frameIndex * frameSize.height,
      frameSize.width,
      frameSize.height
    )
  ));
  cache.set(key, texture);
  return texture;
};

const lightInfantryIdlePath = (direction: string) =>
  `/assets/generated/light_infantry_idle_${UNIT_SHEET_DIRECTIONS.includes(direction) ? direction : 'se'}.png`;

const averageCornerHeight = (c: { hNW: number; hNE: number; hSE: number; hSW: number }) =>
  (c.hNW + c.hNE + c.hSE + c.hSW) / 4;

const makeCornerPoints = (
  corners: { hNW: number; hNE: number; hSE: number; hSW: number },
  avg: number
): Record<CornerKey, { x: number; y: number }> => ({
  NW: { x: CORNER_OFFSETS.NW.x, y: CORNER_OFFSETS.NW.y - (corners.hNW - avg) * ELEV_Y_OFFSET },
  NE: { x: CORNER_OFFSETS.NE.x, y: CORNER_OFFSETS.NE.y - (corners.hNE - avg) * ELEV_Y_OFFSET },
  SE: { x: CORNER_OFFSETS.SE.x, y: CORNER_OFFSETS.SE.y - (corners.hSE - avg) * ELEV_Y_OFFSET },
  SW: { x: CORNER_OFFSETS.SW.x, y: CORNER_OFFSETS.SW.y - (corners.hSW - avg) * ELEV_Y_OFFSET }
});

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const bilerpPoint = (
  points: Record<CornerKey, { x: number; y: number }>,
  u: number,
  v: number
) => {
  const uu = clamp01(u);
  const vv = clamp01(v);
  const top = {
    x: (1 - uu) * points.NW.x + uu * points.NE.x,
    y: (1 - uu) * points.NW.y + uu * points.NE.y
  };
  const bottom = {
    x: (1 - uu) * points.SW.x + uu * points.SE.x,
    y: (1 - uu) * points.SW.y + uu * points.SE.y
  };
  return {
    x: (1 - vv) * top.x + vv * bottom.x,
    y: (1 - vv) * top.y + vv * bottom.y
  };
};

const topTrianglesFor = (c: { hNW: number; hNE: number; hSE: number; hSW: number }): Array<[CornerKey, CornerKey, CornerKey]> => {
  const d1 = c.hNW + c.hSE;
  const d2 = c.hNE + c.hSW;
  if (d1 <= d2) {
    return [
      ['NW', 'NE', 'SE'],
      ['NW', 'SE', 'SW']
    ] as Array<[CornerKey, CornerKey, CornerKey]>;
  }
  return [
    ['NE', 'SE', 'SW'],
    ['NE', 'SW', 'NW']
  ] as Array<[CornerKey, CornerKey, CornerKey]>;
};

const drawPoly = (g: PixiGraphics, poly: Array<{ x: number; y: number }>) => {
  if (!poly.length) return;
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    g.lineTo(poly[i].x, poly[i].y);
  }
  g.closePath();
};

const pointInPoly = (point: { x: number; y: number }, poly: ReadonlyArray<{ x: number; y: number }>) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (!pi || !pj) continue;
    const intersects = ((pi.y > point.y) !== (pj.y > point.y))
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / ((pj.y - pi.y) || 1e-9) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
// overshoot ease (s≈2.2) — used for damage-number "pop"
const easeOutBack = (t: number) => { const c = clamp01(t); const s = 2.2; return 1 + (s + 1) * Math.pow(c - 1, 3) + s * Math.pow(c - 1, 2); };

type WindowLayoutConfig = {
  rows: number;
  cols: number;
  marginH: number;
  marginV: number;
  widthPx: number;
  heightPx: number;
  spacingH: number;
  spacingV: number;
  frameColor: number;
  glassColor: number;
  emissive: number;
};

type DoorLayoutConfig = {
  offset?: number;
  widthPx: number;
  heightPx: number;
  color: number;
  kind: 'single' | 'double' | 'roller';
};

const fillQuad = (
  g: PixiGraphics,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  color: number,
  alpha: number,
  origin: { x: number; y: number }
) => {
  g.beginFill(color, alpha);
  g.moveTo(p0.x - origin.x, p0.y - origin.y);
  g.lineTo(p1.x - origin.x, p1.y - origin.y);
  g.lineTo(p2.x - origin.x, p2.y - origin.y);
  g.lineTo(p3.x - origin.x, p3.y - origin.y);
  g.closePath();
  g.endFill();
};

const lineSegment = (
  g: PixiGraphics,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: number,
  alpha: number,
  thickness: number,
  origin: { x: number; y: number }
) => {
  g.lineStyle(thickness, color, alpha);
  g.moveTo(from.x - origin.x, from.y - origin.y);
  g.lineTo(to.x - origin.x, to.y - origin.y);
  g.lineStyle(0, 0, 0);
};

const facePoint = (
  start: { x: number; y: number },
  ux: number,
  uy: number,
  alongPx: number,
  upPx: number
) => ({
  x: start.x + ux * alongPx,
  y: start.y + uy * alongPx - upPx
});

const fillFaceRect = (
  g: PixiGraphics,
  start: { x: number; y: number },
  ux: number,
  uy: number,
  alongPx: number,
  upPx: number,
  widthPx: number,
  heightPx: number,
  color: number,
  alpha: number,
  origin: { x: number; y: number }
) => {
  const p0 = facePoint(start, ux, uy, alongPx, upPx);
  const p1 = facePoint(start, ux, uy, alongPx + widthPx, upPx);
  const p2 = facePoint(start, ux, uy, alongPx + widthPx, upPx + heightPx);
  const p3 = facePoint(start, ux, uy, alongPx, upPx + heightPx);
  fillQuad(g, p3, p2, p1, p0, color, alpha, origin);
};

const drawFacadeMaterial = (
  g: PixiGraphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  color: number,
  material: NonNullable<MapProp['facade']>['material'],
  fogShade: number
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 24 || heightPx < 20) return;
  const ux = dx / length;
  const uy = dy / length;
  const horizontalStep = material === 'brick' ? 7 : material === 'wood' ? 10 : material === 'metal' ? 18 : 16;
  const verticalStep = material === 'brick' ? 16 : material === 'metal' ? 20 : material === 'concrete' ? 28 : 0;
  const baseAlpha = (material === 'plaster' ? 0.11 : material === 'brick' ? 0.15 : 0.12) + fogShade * 0.25;

  for (let y = horizontalStep; y < heightPx - 4; y += horizontalStep) {
    const offset = -y;
    lineSegment(
      g,
      { x: start.x, y: start.y + offset },
      { x: end.x, y: end.y + offset },
      darkenColor(color, 0.35),
      baseAlpha,
      1,
      origin
    );
  }

  if (verticalStep > 0) {
    const count = Math.max(2, Math.floor(length / verticalStep));
    for (let i = 1; i < count; i++) {
      const along = (length / count) * i;
      const maxUp = Math.min(heightPx, material === 'brick' ? heightPx - 5 : 64);
      if (material === 'brick') {
        for (let y = 6; y < maxUp; y += horizontalStep * 2) {
          const seam = facePoint(start, ux, uy, along + ((Math.floor(y / horizontalStep) % 2) * verticalStep) / 2, y);
          lineSegment(
            g,
            seam,
            { x: seam.x, y: seam.y - horizontalStep },
            darkenColor(color, 0.42),
            baseAlpha * 0.45,
            1,
            origin
          );
        }
      } else {
        const p = facePoint(start, ux, uy, along, 0);
        lineSegment(
          g,
          p,
          { x: p.x, y: p.y - maxUp },
          darkenColor(color, material === 'metal' ? 0.25 : 0.34),
          baseAlpha * 0.65,
          1,
          origin
        );
      }
    }
  }

  const chipCount = Math.max(6, Math.min(26, Math.round((length * heightPx) / 380)));
  for (let i = 0; i < chipCount; i++) {
    const salt = Math.round(length * 13 + heightPx * 7 + i * 19);
    const along = 3 + tileNoise(salt, i, 41) * Math.max(1, length - 12);
    const up = 5 + tileNoise(salt, i, 42) * Math.max(8, heightPx - 12);
    const w = material === 'brick' ? 3 + Math.floor(tileNoise(salt, i, 43) * 5) : 2 + Math.floor(tileNoise(salt, i, 43) * 9);
    const h = material === 'wood' ? 5 + Math.floor(tileNoise(salt, i, 44) * 9) : 1 + Math.floor(tileNoise(salt, i, 44) * 5);
    const patchColor = tileNoise(salt, i, 45) > 0.55
      ? lightenColor(color, material === 'plaster' ? 0.18 : 0.1)
      : darkenColor(color, material === 'brick' ? 0.36 : 0.28);
    fillFaceRect(g, start, ux, uy, along, up, w, h, patchColor, 0.1 + baseAlpha * 0.45, origin);
  }
};

const drawWindowsOnBottomEdge = (
  g: PixiGraphics,
  bottomA: { x: number; y: number },
  bottomB: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  cfg: WindowLayoutConfig,
  fogShade: number
) => {
  const dx = bottomB.x - bottomA.x;
  const dy = bottomB.y - bottomA.y;
  const length = Math.hypot(dx, dy);
  if (length < cfg.widthPx + 8 || heightPx < cfg.heightPx + 8) return;
  const ux = dx / length;
  const uy = dy / length;

  const usableWidth = Math.max(0, length - cfg.marginH * 2);
  const colWidth = cfg.widthPx + cfg.spacingH;
  const cols = Math.max(1, Math.min(cfg.cols, Math.floor((usableWidth + cfg.spacingH) / colWidth)));
  if (cols <= 0) return;
  const usedWidth = cols * cfg.widthPx + (cols - 1) * cfg.spacingH;
  const startOffset = (length - usedWidth) / 2;

  const rows = Math.max(1, cfg.rows);
  const frame = Math.max(1.5, Math.min(cfg.widthPx, cfg.heightPx) * 0.08);
  const glassAlpha = clamp(0.55 + cfg.emissive * 0.25 - fogShade * 0.25, 0.3, 0.95);

  for (let r = 0; r < rows; r++) {
    const verticalOffset = cfg.marginV + r * (cfg.heightPx + cfg.spacingV);
    if (verticalOffset + cfg.heightPx > heightPx - 2) continue;
    for (let c = 0; c < cols; c++) {
      const offset = startOffset + c * (cfg.widthPx + cfg.spacingH);
      const baseX = bottomA.x + ux * offset;
      const baseY = bottomA.y + uy * offset;
      const topLeft = { x: baseX, y: baseY - (verticalOffset + cfg.heightPx) };
      const topRight = { x: topLeft.x + ux * cfg.widthPx, y: topLeft.y + uy * cfg.widthPx };
      const bottomLeft = { x: topLeft.x, y: topLeft.y + cfg.heightPx };
      const bottomRight = { x: topRight.x, y: topRight.y + cfg.heightPx };

      fillQuad(g, bottomLeft, bottomRight, topRight, topLeft, darkenColor(cfg.frameColor, 0.15), 1, origin);

      const glassTL = { x: topLeft.x + ux * frame, y: topLeft.y + frame };
      const glassTR = { x: topRight.x - ux * frame, y: topRight.y + frame };
      const glassBL = { x: bottomLeft.x + ux * frame, y: bottomLeft.y - frame };
      const glassBR = { x: bottomRight.x - ux * frame, y: bottomRight.y - frame };

      fillQuad(g, glassBL, glassBR, glassTR, glassTL, lightenColor(cfg.glassColor, 0.12), glassAlpha, origin);

      const midTop = { x: (glassTL.x + glassTR.x) / 2, y: (glassTL.y + glassTR.y) / 2 };
      const midBottom = { x: (glassBL.x + glassBR.x) / 2, y: (glassBL.y + glassBR.y) / 2 };
      const midLeft = { x: (glassTL.x + glassBL.x) / 2, y: (glassTL.y + glassBL.y) / 2 };
      const midRight = { x: (glassTR.x + glassBR.x) / 2, y: (glassTR.y + glassBR.y) / 2 };
      lineSegment(g, midTop, midBottom, darkenColor(cfg.frameColor, 0.35), 0.7, 1, origin);
      lineSegment(g, midLeft, midRight, darkenColor(cfg.frameColor, 0.25), 0.6, 1, origin);
    }
  }
};

const drawDoorOnBottomEdge = (
  g: PixiGraphics,
  bottomA: { x: number; y: number },
  bottomB: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  cfg: DoorLayoutConfig
) => {
  const dx = bottomB.x - bottomA.x;
  const dy = bottomB.y - bottomA.y;
  const length = Math.hypot(dx, dy);
  if (length <= cfg.widthPx) return;
  const ux = dx / length;
  const uy = dy / length;
  const offset = Number.isFinite(cfg.offset) ? clamp(cfg.offset ?? 0, 0, Math.max(0, length - cfg.widthPx)) : (length - cfg.widthPx) / 2;
  const base = { x: bottomA.x + ux * offset, y: bottomA.y + uy * offset };
  const bottomRight = { x: base.x + ux * cfg.widthPx, y: base.y + uy * cfg.widthPx };
  const topLeft = { x: base.x, y: base.y - Math.min(cfg.heightPx, heightPx) };
  const topRight = { x: bottomRight.x, y: bottomRight.y - Math.min(cfg.heightPx, heightPx) };

  fillQuad(g, topLeft, topRight, bottomRight, base, cfg.color, 1, origin);
  lineSegment(g, base, topLeft, darkenColor(cfg.color, 0.35), 0.8, 2, origin);
  lineSegment(g, bottomRight, topRight, darkenColor(cfg.color, 0.35), 0.8, 2, origin);

  if (cfg.kind === 'roller') {
    const slats = Math.max(3, Math.floor((cfg.heightPx ?? 40) / 10));
    for (let s = 1; s < slats; s++) {
      const y = -((cfg.heightPx / slats) * s);
      lineSegment(g, { x: base.x, y: base.y + y }, { x: bottomRight.x, y: bottomRight.y + y }, darkenColor(cfg.color, 0.45), 0.5, 1, origin);
    }
  } else {
    const divider = { x: (base.x + bottomRight.x) / 2, y: (base.y + bottomRight.y) / 2 };
    lineSegment(
      g,
      divider,
      { x: divider.x, y: divider.y - Math.min(cfg.heightPx, heightPx) },
      darkenColor(cfg.color, 0.4),
      0.7,
      2,
      origin
    );
  }
};

const drawGrimeBand = (
  g: PixiGraphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  strength: number
) => {
  if (strength <= 0) return;
  const bandHeight = Math.min(heightPx * 0.35, 26);
  fillQuad(
    g,
    start,
    end,
    { x: end.x, y: end.y - bandHeight },
    { x: start.x, y: start.y - bandHeight },
    0x000000,
    0.05 + strength * 0.1,
    origin
  );
};

const drawFaceDamage = (
  g: PixiGraphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  color: number,
  strength: number,
  salt: number
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 16 || heightPx < 14) return;
  const ux = dx / length;
  const uy = dy / length;
  const marks = Math.max(3, Math.round(3 + strength * 4));
  for (let i = 0; i < marks; i++) {
    const alongPx = 5 + tileNoise(salt, i, 301) * Math.max(1, length - 16);
    const up = 5 + tileNoise(salt, i, 302) * Math.max(8, heightPx - 12);
    const w = 4 + tileNoise(salt, i, 303) * 10;
    const h = 2 + tileNoise(salt, i, 304) * 6;
    fillFaceRect(
      g,
      start,
      ux,
      uy,
      alongPx,
      up,
      w,
      h,
      tileNoise(salt, i, 305) > 0.45 ? darkenColor(color, 0.46) : lightenColor(color, 0.16),
      0.1 + strength * 0.1,
      origin
    );
    if (tileNoise(salt, i, 306) > 0.62) {
      const p = facePoint(start, ux, uy, alongPx + w * 0.5, up + h);
      const crack = 3 + tileNoise(salt, i, 307) * 5;
      lineSegment(
        g,
        p,
        { x: p.x + (tileNoise(salt, i, 308) - 0.5) * 5, y: p.y + crack },
        darkenColor(color, 0.58),
        0.16 + strength * 0.12,
        1,
        origin
      );
    }
  }
};

const drawFacadeEdgeWear = (
  g: PixiGraphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  heightPx: number,
  origin: { x: number; y: number },
  color: number,
  salt: number
) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 18 || heightPx < 14) return;
  const ux = dx / length;
  const uy = dy / length;
  for (let i = 0; i < 7; i++) {
    const along = 3 + tileNoise(salt, i, 361) * Math.max(1, length - 10);
    const atTop = tileNoise(salt, i, 362) > 0.42;
    const up = atTop ? heightPx - 2 - tileNoise(salt, i, 363) * 6 : 2 + tileNoise(salt, i, 364) * 7;
    const w = 2 + Math.floor(tileNoise(salt, i, 365) * 8);
    const h = 1 + Math.floor(tileNoise(salt, i, 366) * 4);
    fillFaceRect(
      g,
      start,
      ux,
      uy,
      along,
      up,
      w,
      h,
      atTop ? darkenColor(color, 0.48) : darkenColor(color, 0.56),
      atTop ? 0.24 : 0.18,
      origin
    );
  }
};

const drawRoofSurfaceDetail = (
  g: PixiGraphics,
  topPoly: Array<{ x: number; y: number }>,
  origin: { x: number; y: number },
  roofColor: number,
  fogShade: number,
  salt: number
) => {
  if (topPoly.length < 4) return;
  const west = { x: (topPoly[0].x + topPoly[3].x) / 2, y: (topPoly[0].y + topPoly[3].y) / 2 };
  const east = { x: (topPoly[1].x + topPoly[2].x) / 2, y: (topPoly[1].y + topPoly[2].y) / 2 };
  const north = { x: (topPoly[0].x + topPoly[1].x) / 2, y: (topPoly[0].y + topPoly[1].y) / 2 };
  const south = { x: (topPoly[3].x + topPoly[2].x) / 2, y: (topPoly[3].y + topPoly[2].y) / 2 };
  const bands = 4;
  for (let i = 1; i < bands; i++) {
    const t = i / bands;
    const a = { x: lerp(west.x, east.x, t), y: lerp(west.y, east.y, t) };
    const b = { x: lerp(north.x, south.x, t), y: lerp(north.y, south.y, t) };
    lineSegment(g, a, b, darkenColor(roofColor, 0.3), 0.18 + fogShade * 0.08, 1, origin);
  }
  for (let i = 0; i < 18; i++) {
    const u = 0.1 + tileNoise(salt, i, 331) * 0.8;
    const v = 0.1 + tileNoise(salt, i, 332) * 0.8;
    const top = {
      x: lerp(topPoly[0].x, topPoly[1].x, u),
      y: lerp(topPoly[0].y, topPoly[1].y, u)
    };
    const bottom = {
      x: lerp(topPoly[3].x, topPoly[2].x, u),
      y: lerp(topPoly[3].y, topPoly[2].y, u)
    };
    const px = lerp(top.x, bottom.x, v);
    const py = lerp(top.y, bottom.y, v);
    const size = tileNoise(salt, i, 333) > 0.5 ? 2 : 1;
    g.beginFill(tileNoise(salt, i, 334) > 0.5 ? darkenColor(roofColor, 0.45) : lightenColor(roofColor, 0.12), 0.22);
    g.drawRect(Math.round(px - origin.x), Math.round(py - origin.y), size, size);
    g.endFill();
  }
  for (let i = 0; i < 4; i++) {
    const u = 0.16 + tileNoise(salt, i, 341) * 0.68;
    const v = 0.16 + tileNoise(salt, i, 342) * 0.68;
    const top = {
      x: lerp(topPoly[0].x, topPoly[1].x, u),
      y: lerp(topPoly[0].y, topPoly[1].y, u)
    };
    const bottom = {
      x: lerp(topPoly[3].x, topPoly[2].x, u),
      y: lerp(topPoly[3].y, topPoly[2].y, u)
    };
    const p = {
      x: lerp(top.x, bottom.x, v),
      y: lerp(top.y, bottom.y, v)
    };
    const w = 5 + tileNoise(salt, i, 343) * 10;
    const h = 2 + tileNoise(salt, i, 344) * 5;
    g.beginFill(tileNoise(salt, i, 345) > 0.55 ? darkenColor(roofColor, 0.6) : lightenColor(roofColor, 0.16), 0.16);
    g.drawRect(Math.round(p.x - origin.x - w / 2), Math.round(p.y - origin.y - h / 2), Math.round(w), Math.round(h));
    g.endFill();
  }
};

const drawFasciaLine = (
  g: PixiGraphics,
  start: { x: number; y: number },
  end: { x: number; y: number },
  origin: { x: number; y: number },
  color: number
) => {
  lineSegment(g, start, end, color, 0.7, 2, origin);
};

const drawRoofVents = (
  g: PixiGraphics,
  topPoly: Array<{ x: number; y: number }>,
  origin: { x: number; y: number },
  count: number,
  color: number
) => {
  if (count <= 0 || topPoly.length < 4) return;
  const center = topPoly.reduce(
    (acc, p) => ({ x: acc.x + p.x / topPoly.length, y: acc.y + p.y / topPoly.length }),
    { x: 0, y: 0 }
  );
  const diag = {
    x: (topPoly[1].x - topPoly[3].x) * 0.15,
    y: (topPoly[1].y - topPoly[3].y) * 0.15
  };
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : lerp(-0.4, 0.4, i / (count - 1));
    const px = center.x + diag.x * t;
    const py = center.y + diag.y * t - 4;
    const size = 6;
    g.beginFill(color, 0.9);
    g.drawRoundedRect(px - origin.x - size / 2, py - origin.y - size / 2, size, size, 1);
    g.endFill();
  }
};

const PROP_BASE_Y_OFFSET = 0;
const PROP_SHADOW_Y = 4;
const PROP_ANCHOR_Y = 0.97; // base sits on the tile surface; 0.9 sank ~10% of each prop into the ground
// Everything under /props/ is authored hi-res (96-1024px sources) and renders at half scale.
const HI_RES_PROP_PATHS = ['/props/'];
const isHiResPropTexture = (path: string) => HI_RES_PROP_PATHS.some((prefix) => path.includes(prefix));
const missingLabelStyle = new TextStyle({
  fontSize: 9,
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 3,
  align: 'center'
});
// TextStyle construction re-rasterizes on every render; keep the recurring styles as constants.
const combatLabelStyle = (fontSize: number, fill: number) =>
  new TextStyle({
    fontFamily: 'Courier New',
    fontSize,
    fontWeight: '700',
    fill,
    stroke: 0x120604,
    strokeThickness: 3,
    align: 'center'
  });
const invalidMoveLabelStyle = combatLabelStyle(14, 0xffe6a6);
const targetReadoutStyle = combatLabelStyle(11, 0xffe6a6);
const targetReadoutLethalStyle = combatLabelStyle(11, 0xff7a6a);
// Damage numbers ramp size/colour by magnitude, so cache the handful of concrete variants.
const damageTextStyles = new Map<string, TextStyle>();
const damageTextStyle = (hit: boolean, big: boolean, fontSize: number, fill: string) => {
  const key = `${fontSize}:${fill}`;
  let style = damageTextStyles.get(key);
  if (!style) {
    style = new TextStyle({
      fontFamily: 'monospace',
      fontSize,
      fontWeight: '800',
      fill,
      stroke: hit ? (big ? '#5a0d00' : '#3a1308') : '#17130d',
      strokeThickness: hit ? 4 : 3
    });
    damageTextStyles.set(key, style);
  }
  return style;
};
const worldCornerOfTile = (
  q: number,
  r: number,
  pick: CornerKey,
  topGeomForFn: (q: number, r: number) => { avgHeight: number; P: Record<CornerKey, { x: number; y: number }> }
) => {
  const pos = toScreen({ q, r });
  const geom = topGeomForFn(q, r);
  return {
    x: pos.x + geom.P[pick].x,
    y: pos.y - geom.avgHeight * ELEV_Y_OFFSET + geom.P[pick].y
  };
};
const ensureImageDecodable = async (blob: Blob) => {
  if (typeof createImageBitmap === 'function') {
    try {
      await createImageBitmap(blob);
      return;
    } catch {
      // fallback to Image below
    }
  }
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('decode failed'));
    };
    img.src = URL.createObjectURL(blob);
  });
};

const detectBitmapColorMode = (bmp: ImageBitmap): 'colored' | 'grayscale' => {
  const SAMPLE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'colored';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bmp, 0, 0, SAMPLE, SAMPLE);
  const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  let colorScore = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    colorScore += Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
  }
  const avgDelta = colorScore / Math.max(1, pixels);
  return avgDelta > 18 ? 'colored' : 'grayscale';
};

// Terrain art is immutable per session, but each battle entry used to re-fetch every ground image
// into a fresh blob URL — and Pixi caches BaseTextures per URL string, so every mount pinned another
// full set of decoded textures (~tens of MB). Cache the load per stable asset URL and never destroy.
const externalTerrainTextureCache = new Map<string, Promise<Texture | null>>();
const loadExternalTerrainTexture = (name: string) => {
  const cacheKey = `/textures/terrain/${name}`;
  let pending = externalTerrainTextureCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      // Prefer a compact .jpg (opaque ground textures don't need alpha), fall back to .png.
      let res: Response | null = null;
      for (const ext of ['jpg', 'png']) {
        try {
          const r = await fetch(`${cacheKey}.${ext}`, { method: 'GET' });
          if (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) { res = r; break; }
        } catch { /* try next ext */ }
      }
      if (!res) return null;
      try {
        const blob = await res.blob();
        await ensureImageDecodable(blob);
        const objUrl = URL.createObjectURL(blob);
        const loaded = crispTexture(Texture.from(objUrl));
        // Painted ground is sampled across many tiles; mipmaps + linear keep it smooth and
        // painterly instead of shimmering into a crisp pixel-art grid when zoomed out.
        loaded.baseTexture.scaleMode = SCALE_MODES.LINEAR;
        loaded.baseTexture.mipmap = MIPMAP_MODES.ON;
        loaded.baseTexture.wrapMode = WRAP_MODES.REPEAT; // tile painted ground textures seamlessly
        loaded.baseTexture.update();
        const revoke = () => URL.revokeObjectURL(objUrl);
        if (loaded.baseTexture.valid) revoke();
        else loaded.baseTexture.once('loaded', revoke);
        return loaded;
      } catch {
        return null;
      }
    })();
    externalTerrainTextureCache.set(cacheKey, pending);
  }
  return pending;
};

const TERRAIN_SHEET_ORDER = ['plain', 'road', 'forest', 'urban', 'hill', 'water', 'swamp', 'structure'] as const;
const terrainSheetCache = new Map<
  string,
  Promise<{ textures: Record<string, Texture>; detectedMode: 'colored' | 'grayscale' } | null>
>();
const loadTerrainSheet = (url: string) => {
  let pending = terrainSheetCache.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) return null;
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const cols = 4, rows = 2;
        const cellW = Math.floor(bmp.width / cols);
        const cellH = Math.floor(bmp.height / rows);
        const base = crispTexture(Texture.from(bmp)).baseTexture;
        const coords: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
        const textures: Record<string, Texture> = {};
        TERRAIN_SHEET_ORDER.forEach((key, i) => {
          textures[key] = crispTexture(new Texture(base, new Rectangle(coords[i][0] * cellW, coords[i][1] * cellH, cellW, cellH)));
        });
        return { textures, detectedMode: detectBitmapColorMode(bmp) };
      } catch { return null; }
    })();
    terrainSheetCache.set(url, pending);
  }
  return pending;
};


function shade(c: number, f: number) {
  const { r, g, b } = hexToRgb(c);
  const nr = Math.min(255, Math.max(0, Math.round(r * f)));
  const ng = Math.min(255, Math.max(0, Math.round(g * f)));
  const nb = Math.min(255, Math.max(0, Math.round(b * f)));




  return `rgb(${nr},${ng},${nb})`;
}

// Procedural terrain textures (tiny, generated once per session — regenerating per mount leaked a
// fresh set of canvas-backed BaseTextures on every battle entry)
let proceduralTerrainTextures: Record<string, Texture> | null = null;
function getProceduralTerrainTextures() {
  if (proceduralTerrainTextures) return proceduralTerrainTextures;

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
    // mottled patches for painterly tonal variation (lighter/darker greens)
    for (let i = 0; i < 28; i++) {
      const t = ((i * 37) % 100) / 100;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = shade(grassBase, 0.78 + t * 0.5);
      ctx.fillRect((i * 19) % w, (i * 29) % h, 6 + (i % 9), 4 + (i % 5));
    }
    ctx.globalAlpha = 1;
    // grass blades, dark then bright
    ctx.fillStyle = shade(grassBase, 0.7);
    for (let i = 0; i < 16; i++) ctx.fillRect((i * 23) % w, (i * 31) % h, 9 + (i % 6), 2);
    ctx.fillStyle = shade(grassBase, 1.24);
    for (let i = 0; i < 14; i++) ctx.fillRect((i * 13) % w, (i * 19) % h, 7 + (i % 5), 1);
    // dry/dirt flecks + highlight speckle
    for (let i = 0; i < w * h * 0.02; i++) { dot(ctx, (i * 41) % w, (i * 23) % h, '#6b5a3a', 0.5); }
    for (let i = 0; i < w * h * 0.05; i++) { dot(ctx, (i * 29) % w, (i * 53) % h, shade(grassBase, 1.16), 0.7); }
    for (let i = 0; i < w * h * 0.035; i++) { dot(ctx, (i * 17) % w, (i * 41) % h, shade(grassBase, 0.8), 0.72); }
  });

  const forest = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(forestBase, 1.0); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(forestBase, 0.72);
    for (let i = 0; i < 20; i++) ctx.fillRect((i * 19) % w, (i * 37) % h, 7 + (i % 4), 3);
    for (let i = 0; i < w * h * 0.065; i++) { dot(ctx, (i*13)%w, (i*37)%h, shade(forestBase, 0.78), 0.82); }
    for (let i = 0; i < w * h * 0.045; i++) { dot(ctx, (i*23)%w, (i*19)%h, shade(forestBase, 1.16), 0.78); }
  });

  const road = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(roadBase, 0.95); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(roadBase, 0.75);
    for (let y = 0; y < h; y += 4) { ctx.fillRect(0, y, w, 1); }
    ctx.fillStyle = shade(roadBase, 1.12);
    for (let i = 0; i < 18; i++) ctx.fillRect((i * 17) % w, (i * 11) % h, 5 + (i % 5), 1);
    ctx.fillStyle = shade(roadBase, 0.55);
    for (let i = 0; i < 10; i++) ctx.fillRect((i * 29) % w, (i * 23) % h, 3 + (i % 4), 1);
  });

  const urban = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(urbanBase, 0.95); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(urbanBase, 0.8);
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = shade(urbanBase, 1.16);
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 31) % w, (i * 17) % h, 3 + (i % 3), 2);
    ctx.fillStyle = shade(urbanBase, 0.62);
    for (let i = 0; i < 10; i++) ctx.fillRect((i * 13) % w, (i * 29) % h, 5, 1);
  });

  const hill = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(hillBase, 1.0); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(hillBase, 0.85);
    for (let y = 0; y < h; y += 5) { ctx.fillRect(0, y, w, 1); }
    ctx.fillStyle = shade(hillBase, 1.14);
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 17) % w, (i * 29) % h, 8 + (i % 5), 1);
  });

  const water = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(waterBase, 0.9); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(waterBase, 1.1);
    for (let i = 0; i < w; i++) ctx.fillRect((i*7)%w, (i*3)%h, 1, 1);
    ctx.fillStyle = shade(waterBase, 1.28);
    for (let i = 0; i < 18; i++) ctx.fillRect((i * 19) % w, (i * 13) % h, 8 + (i % 8), 1);
    ctx.fillStyle = shade(waterBase, 0.68);
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 23) % w, (i * 31) % h, 7, 1);
  });

  const swamp = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(swampBase, 1.0); ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < w * h * 0.045; i++) { dot(ctx, (i*11)%w, (i*17)%h, shade(swampBase, 0.78), 0.78); }
    for (let i = 0; i < w * h * 0.035; i++) { dot(ctx, (i*31)%w, (i*23)%h, '#3b2f2f', 0.72); }
    ctx.fillStyle = '#1b2d19';
    for (let i = 0; i < 10; i++) ctx.fillRect((i * 17) % w, (i * 37) % h, 8, 2);
  });

  const structure = makeCanvasTexture((ctx, w, h) => {
    ctx.fillStyle = shade(structureBase, 1.0); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(structureBase, 0.8);
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = shade(structureBase, 1.16);
    for (let i = 0; i < 12; i++) ctx.fillRect((i * 19) % w, (i * 23) % h, 4 + (i % 4), 2);
    ctx.fillStyle = shade(structureBase, 0.58);
    for (let i = 0; i < 8; i++) ctx.fillRect((i * 31) % w, (i * 13) % h, 6, 1);
  });

  proceduralTerrainTextures = { plain: grass, road, forest, urban, hill, water, swamp, structure };
  return proceduralTerrainTextures;
}

// Procedural prop sprites, same once-per-session treatment as the terrain canvases above.
let propAtlas: { bush: Texture; rock: Texture } | null = null;
function getPropAtlasTextures() {
  if (propAtlas) return propAtlas;

  const bush = makeCanvasTexture((ctx) => {
    const leaf = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(10, 25, 28, 4);
    leaf(13, 15, 10, 8, '#1f421b');
    leaf(21, 11, 13, 10, '#2e5b25');
    leaf(29, 16, 9, 8, '#1a3416');
    leaf(16, 22, 16, 5, '#162b13');
    leaf(10, 20, 8, 5, '#315e25');
    leaf(32, 22, 7, 5, '#3f7130');
    leaf(20, 14, 4, 2, '#638a43');
    leaf(30, 18, 5, 2, '#5a813d');
    leaf(15, 23, 5, 1, '#0c180b');
    leaf(25, 25, 9, 1, '#0c180b');
  }, 48, 36);

  const rock = makeCanvasTexture((ctx) => {
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fillRect(8, 25, 31, 5);
    ctx.fillStyle = '#45443c';
    ctx.fillRect(12, 18, 12, 7);
    ctx.fillRect(22, 15, 11, 10);
    ctx.fillRect(31, 20, 7, 5);
    ctx.fillStyle = '#666458';
    ctx.fillRect(14, 15, 9, 5);
    ctx.fillRect(24, 13, 8, 4);
    ctx.fillStyle = '#858171';
    ctx.fillRect(16, 14, 5, 1);
    ctx.fillRect(25, 12, 5, 1);
    ctx.fillStyle = '#25241f';
    ctx.fillRect(12, 24, 10, 2);
    ctx.fillRect(26, 23, 10, 2);
  }, 48, 36);

  propAtlas = { bush, rock };
  return propAtlas;
}


export function BattlefieldStage({
  battleState,
  battleIdentity,
  onSelectUnit,
  onSelectTile,
  plannedPath,
  plannedDestination,
  threatenedTiles,
  invalidMoveFeedback,
  targetUnitId,
  focusTargetUnitId,
  restoreCameraSignal = 0,
  deployMode = false,
  targetHitChance,
  targetDamagePreview,
  targetLethal = false,
  onUnitHover,
  selectedUnitId,
  viewerFaction = 'alliance',
  width,
  height,
  cameraMode = 'fit',
  showAttackOverlay,
  rangeOverlayCoords,
  blockedRangeOverlayCoords,
  objectiveCoords = [],
  startZoneCoords = [],
  attackEffects = [],
  arrivalEffects = [],
  scenarioEventEffects = [],
  movingUnit
}: BattlefieldStageProps) {
  const { t } = useTranslation('battlefield');
  const [webglAvailable] = useState(hasWebGLRenderer);
  const map = battleState.map;
  const viewerVision = battleState.vision[viewerFaction];
  const visibleTiles = viewerVision?.visibleTiles ?? EMPTY_TILE_SET;
  const exploredTiles = viewerVision?.exploredTiles ?? EMPTY_TILE_SET;
  // The state value is only a render pulse. Reading the clock here prevents a parent-driven render
  // from evaluating a newly queued move or shot against the previous interval's stale timestamp.
  const [, setAnimationTick] = useState(() => Date.now());
  const now = Date.now();
  const activeMovementFrame = useMemo(
    () => movingUnit ? resolveMovementFrame(movingUnit, now) : null,
    [movingUnit, now]
  );
  const sampledOcclusionCoordinate = activeMovementFrame
    ? quantizeMovementOcclusionCoordinate(activeMovementFrame.displayCoord)
    : null;
  const movementOcclusionQ = sampledOcclusionCoordinate?.q ?? null;
  const movementOcclusionR = sampledOcclusionCoordinate?.r ?? null;
  const movementOcclusionCoordinate = useMemo(
    () => movementOcclusionQ === null || movementOcclusionR === null
      ? null
      : { q: movementOcclusionQ, r: movementOcclusionR },
    [movementOcclusionQ, movementOcclusionR]
  );
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  );
  const [deathMarkers, setDeathMarkers] = useState<Map<string, DeathMarker>>(new Map());
  // Wreck smoke uses the faster idle cadence only while its opening plume is both active and visible.
  // The hull and a thin settled haze remain after the animation quiesces.
  const hasActiveWreckSmoke = useMemo(
    () => !prefersReducedMotion && Array.from(deathMarkers.values()).some((marker) => {
      if (!leavesMechanicalWreck(marker.unitType, marker.definitionId)) return false;
      if (marker.faction !== viewerFaction && !visibleTiles.has(marker.r * map.width + marker.q)) return false;
      const age = now - marker.t;
      return age >= 0 && age < WRECK_SMOKE_ANIMATION_MS;
    }),
    [deathMarkers, map.width, now, prefersReducedMotion, viewerFaction, visibleTiles]
  );
  // Update more frequently during animations (and while a wreck smokes, at a lighter 16fps).
  useEffect(() => {
    const interval = (
      movingUnit
      || attackEffects.length > 0
      || arrivalEffects.length > 0
      || scenarioEventEffects.length > 0
    ) ? 16 : hasActiveWreckSmoke ? 60 : 250;
    const id = window.setInterval(() => setAnimationTick(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [movingUnit, attackEffects.length, arrivalEffects.length, scenarioEventEffects.length, hasActiveWreckSmoke]);

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
  const [overlayMask, setOverlayMask] = useState<{ mapId: string; node: PixiGraphics } | null>(null);
  const setOverlayMaskNode = useCallback((node: PixiGraphics | null) => {
    setOverlayMask(node ? { mapId: map.id, node } : null);
  }, [map.id]);
  const activeOverlayMask =
    overlayMask &&
    !overlayMask.node.destroyed &&
    // A torn-down node keeps its reference but loses its geometry; using it as a mask crashes Pixi's
    // scissor test, so fall back to unmasked rendering. The node is no longer keyed per map (it would
    // be destroyed mid-switch and freeze the renderer) — it persists and just redraws for each map.
    (overlayMask.node as { geometry?: unknown }).geometry
      ? overlayMask.node
      : undefined;

  const scheduleSize = useCallback((w: number, h: number) => {
    sizePendingRef.current = { w, h };
    if (sizeTimerRef.current) window.clearTimeout(sizeTimerRef.current);
    sizeTimerRef.current = window.setTimeout(() => {
      const pendingSize = sizePendingRef.current;
      if (pendingSize) {
        const nextSize = { w: Math.round(pendingSize.w), h: Math.round(pendingSize.h) };
        setHostSize((previousSize) => previousSize.w === nextSize.w && previousSize.h === nextSize.h ? previousSize : nextSize);
      }
    }, 120) as unknown as number;
  }, []);
  // Apply prop size (as hint) but debounced, do not return early
  useEffect(() => {
    if (typeof width === 'number' && typeof height === 'number') {
      scheduleSize(width, height);
    }
  }, [width, height, scheduleSize]);
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
  }, [scheduleSize]);


  // Maintain a local buffer of recent death markers so they fade out even if the unit object disappears.
  // A unit that died once must get exactly one marker: destroyed units stay in battleState forever, so
  // keying creation on map-presence made the TTL deletion re-add the marker every 20s (corpses flashed
  // a fresh death-cross indefinitely). Track recorded deaths in a ref so expiry can never re-create them.
  const recordedDeathsRef = useRef<Set<string>>(new Set());
  // A new map/battle: drop the previous battle's death markers and recorded-deaths guard so their
  // stale coordinates can't render onto (and crash) a different-sized map.
  useEffect(() => {
    recordedDeathsRef.current = new Set();
    setDeathMarkers(new Map());
  }, [map.id]);
  useEffect(() => {
    const next = new Map(deathMarkers);
    let changed = false;
    const recordedAt = Date.now();
    for (const side of Object.values(battleState.sides)) {
      for (const u of side.units.values()) {
        if (u.stance !== 'destroyed') continue;
        const killingEffect = activeKillingEffectForTarget(attackEffects, u.id, recordedAt);
        const effectImpactAt = killingEffect
          ? killingEffect.startTime + combatEffectTiming(killingEffect.type, killingEffect.arc).impactAtMs
          : recordedAt;
        const existing = next.get(u.id);
        if (!existing && !recordedDeathsRef.current.has(u.id)) {
          recordedDeathsRef.current.add(u.id);
          next.set(u.id, {
            id: u.id,
            killingEffectId: killingEffect?.id,
            q: u.coordinate.q,
            r: u.coordinate.r,
            t: effectImpactAt,
            faction: u.faction,
            unitType: u.unitType,
            definitionId: u.definitionId.toLowerCase(),
            orientation: u.orientation ?? 0
          });
          changed = true;
        } else if (existing && !existing.killingEffectId && killingEffect) {
          next.set(u.id, {
            ...existing,
            killingEffectId: killingEffect.id,
            t: effectImpactAt
          });
          changed = true;
        }
      }
    }
    if (changed) {
      setDeathMarkers(next);
    }
    // `battleState.sides` is a stable Map reference (mutated in place), so it never re-triggers this
    // effect — keying off the timeline length (which grows on every combat event) makes the scan run
    // when units actually die, so corpse/wreck markers appear instead of the body just vanishing.
  }, [attackEffects, battleState.sides, battleState.timeline.length, deathMarkers]);

  useEffect(() => {
    if (deathMarkers.size === 0) return;
    const expiredIds = Array.from(deathMarkers.entries())
      .filter(([, marker]) => deathMarkerExpired(
        marker.t,
        now,
        leavesMechanicalWreck(marker.unitType, marker.definitionId)
      ))
      .map(([id]) => id);
    if (expiredIds.length === 0) return;
    setDeathMarkers((markers) => {
      const next = new Map(markers);
      expiredIds.forEach((id) => next.delete(id));
      return next;
    });
  }, [now, deathMarkers]);


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

  const terrainTextures = useMemo(getProceduralTerrainTextures, []);
  const terrainMacroTexture = useMemo(() => {
    const texture = makeCanvasTexture((ctx, width, height) => {
      const pixels = ctx.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const pattern = terrainMacroPattern(x / width, y / height);
          const alpha = Math.round(Math.max(0, (pattern - 0.38) / 0.62) ** 1.35 * 255);
          const offset = (y * width + x) * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 255;
          pixels.data[offset + 2] = 255;
          pixels.data[offset + 3] = alpha;
        }
      }
      ctx.putImageData(pixels, 0, 0);
    }, 256, 256);
    texture.baseTexture.wrapMode = WRAP_MODES.REPEAT;
    texture.baseTexture.update?.();
    return texture;
  }, []);
  const rememberedBuildingProfile = useMemo(
    () => buildingVisibilityPresentation(false, 1),
    []
  );
  useEffect(() => {
    return () => {
      try { terrainMacroTexture.destroy(true); } catch { /* already gone */ }
    };
  }, [terrainMacroTexture]);
  // Optional external texture override (drop PNGs in /public/textures/terrain or a spritesheet in /public/textures/textures_black.png)
  const [externalTerrainTextures, setExternalTerrainTextures] = useState<Record<string, Texture> | null>(null);
  const [externalTexturesAreColored, setExternalTexturesAreColored] = useState<boolean>(false);
  const [missingTerrainPng, setMissingTerrainPng] = useState<Set<string>>(new Set());
  const [missingPropPaths, setMissingPropPaths] = useState<Set<string>>(new Set());
  const [allowExternalTextures] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const qs = new URLSearchParams(window.location.search);
    const pref = qs.get('textures') ?? qs.get('tileset');
    if (!pref) return true;
    const norm = pref.toLowerCase();
    if (norm === 'off' || norm === 'false' || norm === 'procedural') return false;
    if (norm === 'external' || norm === 'on' || norm === 'true' || norm === 'color') return true;
    return true;
  });
  const requiredTerrainNames = useMemo(() => {
    const usedTerrain = new Set(map.tiles.map((tile) => tile.terrain));
    return TERRAIN_SHEET_ORDER.filter((name) => usedTerrain.has(name));
  }, [map.tiles]);

  useEffect(() => {
    if (!allowExternalTextures) {
      setExternalTerrainTextures(null);
      setExternalTexturesAreColored(false);
      setMissingTerrainPng(new Set());
      return;
    }
    let cancelled = false;
    const names = requiredTerrainNames;

    (async () => {
      try {
        const out: Record<string, Texture> = {};
        let anyLoaded = false;
        let explicitColorTextures = false;
        const missing = new Set<string>();
        // 1) Per-terrain PNGs (highest priority if present)
        await Promise.all(
          names.map(async (n) => {
            const loaded = await loadExternalTerrainTexture(n);
            if (!loaded) {
              missing.add(`${n}.png`);
              return;
            }
            out[n] = loaded;
            anyLoaded = true;
            explicitColorTextures = true;
          })
        );

        // 2) Spritesheet fallback(s): prefer COLORED sheet if present; else grayscale
        const trySheet = async (url: string, forcedMode?: 'colored' | 'grayscale'): Promise<'colored' | 'grayscale' | null> => {
          const sheet = await loadTerrainSheet(url);
          if (!sheet) return null;
          let loaded = false;
          for (const key of names) {
            if (!out[key]) { // don't overwrite explicit per-terrain PNGs
              out[key] = sheet.textures[key];
              anyLoaded = true;
              loaded = true;
            }
          }
          if (!loaded) return null;
          return forcedMode ?? sheet.detectedMode;
        };
        let sheetMode: 'colored' | 'grayscale' | null = null;
        const sheetCandidates: Array<{ url: string; forcedMode?: 'colored' | 'grayscale' }> = [
          { url: '/textures/textures.png' },                 // user-supplied colored sheet
          { url: '/textures/textures_black.png', forcedMode: 'grayscale' },
          { url: '/pics/textures.png', forcedMode: 'grayscale' },          // repo placeholder sheet (keep grayscale)
          { url: '/pics/textures_black.png', forcedMode: 'grayscale' }
        ];
        if (names.some((name) => !out[name])) {
          for (const candidate of sheetCandidates) {
            const mode = await trySheet(candidate.url, candidate.forcedMode);
            if (!mode) continue;
            sheetMode = mode;
            if (mode === 'colored') break;
          }
        }

        if (cancelled) return;
        setMissingTerrainPng(missing);
        if (missing.has('structure.png')) {
          out['structure'] = terrainTextures.structure;
          missing.delete('structure.png');
        }

        const finalMode: 'colored' | 'grayscale' =
          explicitColorTextures ? 'colored' : (sheetMode ?? 'grayscale');
        setExternalTerrainTextures(finalMode === 'colored' && anyLoaded ? out : null);
        setExternalTexturesAreColored(finalMode === 'colored');
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [allowExternalTextures, requiredTerrainNames, terrainTextures]);

  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const mapProps = map.props ?? [];
      const paths = Array.from(new Set([
        '/props/tree1.png',
        ...mapProps.map((p) => p.texture).filter(Boolean).map((path) => assetUrl(path as string))
      ]));
      if (paths.length === 0) {
        setMissingPropPaths(new Set());
        return;
      }
      const missing = new Set<string>();
      await Promise.all(
        paths.map(async (path) => {
          try {
            const res = await fetch(assetUrl(path), { method: 'GET', cache: 'no-store' });
            if (!res.ok) {
              missing.add(path);
              return;
            }
            const type = res.headers.get('content-type') ?? '';
            if (!type.startsWith('image/')) {
              missing.add(path);
              return;
            }
            const blob = await res.blob();
            await ensureImageDecodable(blob);
          } catch {
            missing.add(path);
          }
        })
      );
      if (!cancelled) setMissingPropPaths(missing);
    };
    scan();
    return () => {
      cancelled = true;
    };
  }, [map.props]);


  // Minimap-driven camera target (world pixel coordinates)
  const [followTargetPx, setFollowTargetPx] = useState<{ x: number; y: number } | null>(null);
  const followRef = useRef<{ x: number; y: number } | null>(followTargetPx);
  useEffect(() => { followRef.current = followTargetPx; }, [followTargetPx]);
  const targetCameraSnapshotRef = useRef<{ targetId: string; followTargetPx: { x: number; y: number } | null; zoom: number } | null>(null);
  const lastRestoreCameraSignalRef = useRef(restoreCameraSignal);
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

  // Auto-center camera on the friendly formation at start (the only lit region under fog — centring on
  // the map middle would just frame darkness). Using the whole formation keeps every deployed unit in
  // view even when roster iteration begins at an edge of the deployment line.
  const didAutoCenterRef = useRef(false);
  useEffect(() => {
    if (didAutoCenterRef.current) return;
    const formation: Array<{ x: number; y: number }> = [];
    for (const side of Object.values(battleState.sides)) {
      for (const u of side.units.values()) {
        if (u.faction !== viewerFaction || u.stance === 'destroyed' || u.embarkedOn) continue;
        const p = toScreen(u.coordinate);
        formation.push({ x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y });
      }
    }
    if (formation.length === 0) return;
    setFollowTargetPx(formation.reduce(
      (center, position) => ({
        x: center.x + position.x / formation.length,
        y: center.y + position.y / formation.length
      }),
      { x: 0, y: 0 }
    ));
    didAutoCenterRef.current = true;
  }, [battleState.sides, isoBaseX, viewerFaction]);

  useEffect(() => {
    const targetEffect = attackEffects[attackEffects.length - 1];
    let fromCoord: HexCoordinate | undefined;
    let toCoord: HexCoordinate | undefined;

    if (targetEffect) {
      // remember the camera the cinematic zoom is about to interrupt so we can restore it afterwards
      if (!targetCameraSnapshotRef.current) {
        targetCameraSnapshotRef.current = { targetId: '__cinematic__', followTargetPx: followRef.current, zoom: zoomRef.current };
      }
      fromCoord = { q: targetEffect.fromQ, r: targetEffect.fromR };
      toCoord = { q: targetEffect.toQ, r: targetEffect.toR };
    } else if (selectedUnitId && focusTargetUnitId) {
      if (!targetCameraSnapshotRef.current) {
        targetCameraSnapshotRef.current = {
          targetId: focusTargetUnitId,
          followTargetPx: followRef.current,
          zoom: zoomRef.current
        };
      }
      for (const side of Object.values(battleState.sides)) {
        fromCoord ??= side.units.get(selectedUnitId)?.coordinate;
        toCoord ??= side.units.get(focusTargetUnitId)?.coordinate;
      }
    } else if (targetCameraSnapshotRef.current?.targetId === '__cinematic__') {
      // attack effects ended — restore the camera the cinematic zoom interrupted
      setFollowTargetPx(targetCameraSnapshotRef.current.followTargetPx);
      setZoom(targetCameraSnapshotRef.current.zoom);
      targetCameraSnapshotRef.current = null;
      return;
    }

    if (!fromCoord || !toCoord) return;

    const from = toScreen(fromCoord);
    const to = toScreen(toCoord);
    const fromWorld = { x: from.x + (ISO_MODE ? isoBaseX : 0), y: from.y };
    const toWorld = { x: to.x + (ISO_MODE ? isoBaseX : 0), y: to.y };
    const currentCenter = followRef.current;
    const currentScale = clampCameraScale(snapCameraScale(zoomRef.current));
    const pointIsFramed = (point: { x: number; y: number }) => {
      if (!currentCenter) return false;
      const screenX = hostSize.w / 2 + (point.x - currentCenter.x) * currentScale;
      const screenY = hostSize.h * 0.41 + (point.y - currentCenter.y) * currentScale;
      return screenX >= hostSize.w * 0.12
        && screenX <= hostSize.w * 0.78
        && screenY >= hostSize.h * 0.16
        && screenY <= hostSize.h * 0.76;
    };
    const attackAlreadyFramed = Boolean(targetEffect) && pointIsFramed(fromWorld) && pointIsFramed(toWorld);

    if (!attackAlreadyFramed) {
      setFollowTargetPx({
        x: (fromWorld.x + toWorld.x) / 2,
        y: ((fromWorld.y + toWorld.y) / 2) + tileSize * 0.2
      });
      setZoom((current) => Math.max(current, targetEffect ? 2.35 : 2.25));
    }
  }, [attackEffects, battleState.sides, focusTargetUnitId, hostSize.h, hostSize.w, isoBaseX, selectedUnitId]);

  useEffect(() => {
    if (restoreCameraSignal === lastRestoreCameraSignalRef.current) return;
    lastRestoreCameraSignalRef.current = restoreCameraSignal;
    const snapshot = targetCameraSnapshotRef.current;
    if (!snapshot) return;
    setFollowTargetPx(snapshot.followTargetPx);
    setZoom(snapshot.zoom);
    targetCameraSnapshotRef.current = null;
  }, [restoreCameraSignal]);

  // Pan the camera along with a unit while it glides. Without this, scripted (Auto Turn / enemy)
  // moves happened off-screen and the unit appeared to teleport to its destination. Leaves the
  // camera on the final tile when the glide ends (no snap-back), and yields to the attack
  // cinematic, which owns framing+zoom whenever an attack is on screen.
  useEffect(() => {
    if (!movingUnit || movingUnit.path.length < 2 || attackEffects.length > 0) return;
    const { path, startTime, stepDuration } = movingUnit;
    const preAlign = Math.max(0, movingUnit.preAlignDuration ?? 0);
    const totalSteps = path.length - 1;
    const panTo = () => {
      const elapsed = Math.max(0, Date.now() - startTime - preAlign);
      const traversed = stepDuration > 0 ? Math.min(totalSteps, elapsed / stepDuration) : totalSteps;
      const seg = Math.min(totalSteps - 1, Math.floor(traversed));
      const t = traversed - seg;
      const a = path[seg];
      const b = path[seg + 1];
      const sp = toScreen({ q: a.q + (b.q - a.q) * t, r: a.r + (b.r - a.r) * t });
      setFollowTargetPx({ x: sp.x + (ISO_MODE ? isoBaseX : 0), y: sp.y });
    };
    panTo();
    let frameId = window.requestAnimationFrame(function followMovement() {
      panTo();
      frameId = window.requestAnimationFrame(followMovement);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [movingUnit, attackEffects.length, isoBaseX]);

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
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('button,input,select,textarea,a')) return;
      // Always prevent page scroll when interacting over canvas
      e.preventDefault();
      e.stopPropagation();
      const hasFollow = !!followRef.current;
      if (!(cameraMode === 'follow' || hasFollow)) return;
      const delta = Math.sign(e.deltaY);
      const direction = delta > 0 ? 'out' : 'in';
      // If we don't yet have a follow center, adopt selected unit or map center
      if (!hasFollow) {
        let selected: UnitInstance | undefined;
        if (selectedUnitId) {
          for (const side of Object.values(battleState.sides)) {
            const u = side.units.get(selectedUnitId);
            if (u) { selected = u; break; }
          }
        }
        const coord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
        const p = toScreen(coord);
        setFollowTargetPx({ x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y });
      }
      setZoom((current) => {
        const next = nextCameraScale(current, direction);
        zoomRef.current = next;
        return next;
      });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [cameraMode, battleState.sides, isoBaseX, selectedUnitId, map.width, map.height]);

  const fitScaleRaw = Math.min(
    hostSize.w > 0 ? hostSize.w / contentWidth : 1,
    hostSize.h > 0 ? hostSize.h / contentHeight : 1
  );
  const fitScale = snapCameraScale(fitScaleRaw);
  const openingZoomFloor = hostSize.w >= 1200 ? 2.25 : hostSize.w >= 800 ? 2 : 1.75;
  const initialFollowZoom = clampCameraScale(Math.max(openingZoomFloor, snapCameraScale(fitScaleRaw * 1.75)));
  const didSetInitialZoomRef = useRef(false);
  useEffect(() => {
    if (cameraMode === 'follow' && !didSetInitialZoomRef.current) {
      didSetInitialZoomRef.current = true;
      setZoom(initialFollowZoom);
      return;
    }
    if (!followTargetPx || didSetInitialZoomRef.current) return;
    didSetInitialZoomRef.current = true;
    setZoom(initialFollowZoom);
  }, [cameraMode, followTargetPx, initialFollowZoom]);

  // Choose scale: fit or follow
  const scale = (cameraMode === 'follow' || !!followTargetPx) ? clampCameraScale(snapCameraScale(zoom)) : fitScale;

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
      for (const side of Object.values(battleState.sides)) {
        const u = side.units.get(selectedUnitId);
        if (u) return u;
      }
      return undefined;
    })();
    if (followTargetPx) {

      offsetX = hostSize.w / 2 - followTargetPx.x * scale;
      offsetY = hostSize.h * 0.41 - followTargetPx.y * scale;
    } else {
      const followCoord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
      const { x: tx, y: ty } = toScreen(followCoord);
      const adjx = ISO_MODE ? tx + isoBaseX : tx;
      offsetX = hostSize.w / 2 - adjx * scale;
      offsetY = hostSize.h * 0.43 - ty * scale;
    }
  }
  offsetX = Math.round(offsetX);
  offsetY = Math.round(offsetY);

  // Camera shake from live impacts. Derived purely from attackEffects (which already drive the 16ms
  // render tick), so no extra state/timer. Applied only to the visual world container below — the
  // unshaken offsetX/offsetY above stay authoritative for pointer and minimap math.
  let shakeX = 0;
  let shakeY = 0;
  let cameraPunch = 0;
  if (!prefersReducedMotion) {
    let shakeTrauma = 0;
    for (const e of attackEffects) {
      if (e.sourceVisible === false && e.targetVisible === false) continue;
      if (e.hit === false) continue;
      const elapsed = now - e.startTime;
      const timing = combatEffectTiming(e.type, e.arc);
      const impactElapsed = elapsed - timing.impactAtMs;
      const shakeDuration = Math.min(520, timing.impactMs);
      if (impactElapsed < 0 || impactElapsed > shakeDuration) continue;
      const env = 1 - impactElapsed / shakeDuration;
      const base = e.type === 'explosion' ? 0.9 : 0.32;
      const dmgScale = Math.min(1, (e.damage ?? 0) / 14);
      shakeTrauma = Math.max(shakeTrauma, base * (0.55 + 0.45 * dmgScale) * env);
      const punchDuration = e.type === 'explosion' ? 260 : 140;
      if (impactElapsed <= punchDuration) {
        const attack = Math.min(1, impactElapsed / 42);
        const release = Math.max(0, 1 - impactElapsed / punchDuration);
        cameraPunch = Math.max(cameraPunch, attack * release * (e.type === 'explosion' ? 0.024 : 0.007));
      }
    }
    if (shakeTrauma > 0) {
      const mag = shakeTrauma * shakeTrauma * SHAKE_MAX_PX;
      const a = now * 0.013;
      shakeX = Math.sin(a * 2.7) * mag;
      shakeY = Math.cos(a * 3.1) * mag;
    }
  }
  const combatScale = scale * (1 + cameraPunch);
  const combatOffsetX = hostSize.w / 2 + (offsetX + shakeX - hostSize.w / 2) * (1 + cameraPunch);
  const combatOffsetY = hostSize.h / 2 + (offsetY + shakeY - hostSize.h / 2) * (1 + cameraPunch);

  // Precompute friendly units by coordinate for quick tile-click selection
  const friendlyByCoord = useMemo(() => {
    const m = new Map<string, UnitInstance>();
    for (const side of Object.values(battleState.sides)) {
      for (const u of side.units.values()) {
        if (u.faction === viewerFaction && u.stance !== 'destroyed') {
          m.set(`${u.coordinate.q},${u.coordinate.r}`, u);
        }
      }
    }
    return m;
  }, [battleState.sides, viewerFaction]);

  const unitByCoord = useMemo(() => {
    const m = new Map<string, UnitInstance>();
    for (const side of Object.values(battleState.sides)) {
      for (const u of side.units.values()) {
        if (u.stance === 'destroyed' || u.embarkedOn) continue;
        const tileIdx = u.coordinate.r * map.width + u.coordinate.q;
        if (u.faction !== viewerFaction && !visibleTiles.has(tileIdx)) continue;
        m.set(`${u.coordinate.q},${u.coordinate.r}`, u);
      }
    }
    return m;
  }, [battleState.sides, map.width, viewerFaction, visibleTiles]);

  // Precompute snapped per-vertex heights (renderer-only) derived from elevEdges
  const snappedCorners = useMemo(() => {
    const w = map.width, h = map.height;
    const idxAt = (qq: number, rr: number) => rr * w + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < w && rr < h;
    const tileAt = (qq: number, rr: number) => (inb(qq, rr) ? (map.tiles[idxAt(qq, rr)] as RendererTile) : undefined);
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
      const t = tileAt(qq, rr);
      if (t?.cornerHeights) {
        const h = t.cornerHeights;
        return { hNW: h.NW, hNE: h.NE, hSE: h.SE, hSW: h.SW };
      }
      const e = t ? (t.elevation ?? 0) : 0;
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
    // Bounds-safe: a stale coordinate (e.g. a leftover marker from a larger previous map) must not
    // index past the vertex grid and crash the whole battlefield render — fall back to flat ground.
    const vAt = (qq: number, rr: number) => (V[qq] !== undefined && V[qq][rr] !== undefined ? V[qq][rr] : 0);
    return {
      getCorners: (qq: number, rr: number) => ({
        hNW: vAt(qq, rr),
        hNE: vAt(qq + 1, rr),
        hSE: vAt(qq + 1, rr + 1),
        hSW: vAt(qq, rr + 1)
      })
    } as const;
  }, [map.tiles, map.width, map.height]);

  const topGeomFor = useCallback((q: number, r: number) => {
    const idx = r * map.width + q;
    if (ISO_MODE) {
      const corners = snappedCorners.getCorners(q, r);
      const avgHeight = averageCornerHeight(corners);
      const P = makeCornerPoints(corners, avgHeight);
      const quad = [P.NW, P.NE, P.SE, P.SW] as const;
      const center = {
        x: (P.NW.x + P.NE.x + P.SE.x + P.SW.x) / 4,
        y: (P.NW.y + P.NE.y + P.SE.y + P.SW.y) / 4
      };
      const inset = (k: number) =>
        quad.map((p) => ({ x: center.x + (p.x - center.x) * k, y: center.y + (p.y - center.y) * k }));
      return { avgHeight, P, quad, center, inset };
    }
    const tile = map.tiles[idx];
    const elev = tile?.elevation ?? 0;
    const s = tileSize / 2;
    const hw = hexWidth / 2;
    const quadBase = [
      { x: 0, y: -s },
      { x: hw, y: -s / 2 },
      { x: 0, y: s },
      { x: -hw, y: -s / 2 }
    ] as const;
    const center = { x: 0, y: 0 };
    const inset = (k: number) =>
      quadBase.map((p) => ({ x: center.x + (p.x - center.x) * k, y: center.y + (p.y - center.y) * k }));
    const P = {
      NW: quadBase[0],
      NE: quadBase[1],
      SE: quadBase[2],
      SW: quadBase[3]
    } as Record<CornerKey, { x: number; y: number }>;
    return { avgHeight: elev, P, quad: quadBase, center, inset };
  }, [map.tiles, map.width, snappedCorners]);

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    const worldCenterForCoord = (q: number, r: number) => {
      const pos = toScreen({ q, r });
      const geom = topGeomFor(q, r);
      return {
        x: pos.x + (ISO_MODE ? isoBaseX : 0) + geom.center.x,
        y: pos.y - geom.avgHeight * ELEV_Y_OFFSET + geom.center.y
      };
    };
    (window as BattleCameraWindow).__battleCamera = {
      centerOnCoord: (q: number, r: number) => {
        setFollowTargetPx(worldCenterForCoord(q, r));
        return true;
      },
      centerOnWorld: (x: number, y: number) => {
        setFollowTargetPx({ x, y });
        return true;
      },
      screenForCoord: (q: number, r: number) => {
        const center = worldCenterForCoord(q, r);
        return {
          x: offsetX + center.x * scale,
          y: offsetY + center.y * scale
        };
      },
      setZoom: (next: number) => {
        const clamped = clampCameraScale(next);
        zoomRef.current = clamped;
        setZoom(clamped);
        return clamped;
      },
      metrics: () => ({
        centerX: (-offsetX + hostSize.w / 2) / scale,
        centerY: (-offsetY + hostSize.h / 2) / scale,
        scale,
        stageWidth: stageDimensions.width,
        stageHeight: stageDimensions.height
      })
    };
    return () => {
      delete (window as BattleCameraWindow).__battleCamera;
    };
  }, [hostSize.h, hostSize.w, isoBaseX, offsetX, offsetY, scale, stageDimensions.height, stageDimensions.width, topGeomFor]);

  const tileAtWorldPoint = useCallback((point: { x: number; y: number }): HexCoordinate | null => {
    const roughCol = ((point.y / (ISO_TILE_H / 2)) + (point.x / (ISO_TILE_W / 2))) / 2;
    const roughRow = ((point.y / (ISO_TILE_H / 2)) - (point.x / (ISO_TILE_W / 2))) / 2;
    const baseQ = Math.round(roughCol);
    const baseR = Math.round(roughRow);
    let best: { coord: HexCoordinate; distance: number } | null = null;

    for (let r = baseR - 2; r <= baseR + 2; r++) {
      for (let q = baseQ - 2; q <= baseQ + 2; q++) {
        if (q < 0 || r < 0 || q >= map.width || r >= map.height) continue;
        const pos = toScreen({ q, r });
        const geom = topGeomFor(q, r);
        const local = {
          x: point.x - pos.x,
          y: point.y - (pos.y - geom.avgHeight * ELEV_Y_OFFSET)
        };
        if (!pointInPoly(local, geom.quad)) continue;
        const distance = Math.hypot(local.x - geom.center.x, local.y - geom.center.y);
        if (!best || distance < best.distance) {
          best = { coord: { q, r }, distance };
        }
      }
    }

    return best?.coord ?? null;
  }, [map.height, map.width, topGeomFor]);

  const interactionUnits = useMemo(() => {
    const unitsForInteraction: InteractionUnit[] = [];
    let selectedEmbarkedCarrierId: string | undefined;
    if (selectedUnitId) {
      for (const side of Object.values(battleState.sides)) {
        const selected = side.units.get(selectedUnitId);
        if (selected?.embarkedOn) {
          selectedEmbarkedCarrierId = selected.embarkedOn;
          break;
        }
      }
    }

    for (const side of Object.values(battleState.sides)) {
      for (const unit of side.units.values()) {
        if (unit.stance === 'destroyed' || unit.embarkedOn) continue;
        const tileIndex = unit.coordinate.r * map.width + unit.coordinate.q;
        const isFriendly = unit.faction === viewerFaction;
        if (!isFriendly && !visibleTiles.has(tileIndex)) continue;
        const pos = toScreen(unit.coordinate);
        const geom = topGeomFor(unit.coordinate.q, unit.coordinate.r);
        const unitType = unit.unitType as string;
        const definitionId = String(unit.definitionId ?? '').toLowerCase();
        const selectedForHitArea = unit.id === selectedUnitId || unit.id === selectedEmbarkedCarrierId;
        const y = pos.y - geom.avgHeight * ELEV_Y_OFFSET;
        unitsForInteraction.push({
          id: unit.id,
          faction: unit.faction,
          coordinate: unit.coordinate,
          hitArea: unitPointerArea(tileSize, unitType, definitionId, selectedForHitArea),
          x: pos.x,
          y,
          z: Math.round(y)
        });
      }
    }

    return unitsForInteraction.sort((a, b) => b.z - a.z);
  }, [battleState.sides, map.width, selectedUnitId, topGeomFor, viewerFaction, visibleTiles]);

  const handleBattlefieldTap = useCallback((event: FederatedPointerEvent) => {
    if (minimapDragging) return;
    event.stopPropagation();
    const local = event.getLocalPosition?.(event.currentTarget as DisplayObject) ?? event.global;
    const worldPoint = {
      x: (local.x - offsetX) / scale - (ISO_MODE ? isoBaseX : 0),
      y: (local.y - offsetY) / scale
    };
    const tile = tileAtWorldPoint(worldPoint);
    const unitHit = interactionUnits.find((unit) => {
      const localX = worldPoint.x - unit.x;
      const localY = worldPoint.y - unit.y;
      return localX >= unit.hitArea.x
        && localX <= unit.hitArea.x + unit.hitArea.width
        && localY >= unit.hitArea.y
        && localY <= unit.hitArea.y + unit.hitArea.height;
    });

    if (tile) {
      const tileUnit = unitByCoord.get(`${tile.q},${tile.r}`);
      if (!tileUnit) {
        onSelectTile?.(tile);
        return;
      }
      if (tileUnit.faction === viewerFaction) {
        onSelectUnit?.(tileUnit.id);
      } else {
        onSelectTile?.(tileUnit.coordinate);
      }
      return;
    }

    if (!unitHit) return;
    if (unitHit.faction === viewerFaction) {
      onSelectUnit?.(unitHit.id);
    } else {
      onSelectTile?.(unitHit.coordinate);
    }
  }, [
    interactionUnits,
    isoBaseX,
    minimapDragging,
    offsetX,
    offsetY,
    onSelectTile,
    onSelectUnit,
    scale,
    tileAtWorldPoint,
    unitByCoord,
    viewerFaction
  ]);

  // The full-screen tap catcher sits above the world container, so per-unit pointerover/pointerout
  // never fire — replicate the enemy hover (shot preview + crosshair cursor) with the same hit test
  // the tap handler uses.
  const hoveredEnemyIdRef = useRef<string | null>(null);
  const handleBattlefieldHover = useCallback((event: FederatedPointerEvent) => {
    const local = event.getLocalPosition?.(event.currentTarget as DisplayObject) ?? event.global;
    const worldPoint = {
      x: (local.x - offsetX) / scale - (ISO_MODE ? isoBaseX : 0),
      y: (local.y - offsetY) / scale
    };
    const enemyHit = interactionUnits.find((unit) => {
      if (unit.faction === viewerFaction) return false;
      const localX = worldPoint.x - unit.x;
      const localY = worldPoint.y - unit.y;
      return localX >= unit.hitArea.x
        && localX <= unit.hitArea.x + unit.hitArea.width
        && localY >= unit.hitArea.y
        && localY <= unit.hitArea.y + unit.hitArea.height;
    });
    const hoveredId = enemyHit?.id ?? null;
    if (hoveredId === hoveredEnemyIdRef.current) return;
    hoveredEnemyIdRef.current = hoveredId;
    event.currentTarget.cursor = hoveredId ? 'crosshair' : 'pointer';
    onUnitHover?.(hoveredId);
  }, [interactionUnits, isoBaseX, offsetX, offsetY, onUnitHover, scale, viewerFaction]);
  const handleBattlefieldHoverEnd = useCallback((event: FederatedPointerEvent) => {
    if (hoveredEnemyIdRef.current === null) return;
    hoveredEnemyIdRef.current = null;
    event.currentTarget.cursor = 'pointer';
    onUnitHover?.(null);
  }, [onUnitHover]);


  const battlefieldMood = useMemo(() => {
    switch (map.environment) {
      case 'industrial':
        return { screen: 0x080908, glow: 0x2b2115, apron: 0x3a3224, apronAlt: 0x2d2d22, soil: 0x342a1c };
      case 'river':
      case 'canal':
        return { screen: 0x040b0d, glow: 0x12343b, apron: 0x214147, apronAlt: 0x263c2e, soil: 0x213429 };
      case 'forest':
        return { screen: 0x040a06, glow: 0x14331a, apron: 0x274323, apronAlt: 0x1e381f, soil: 0x26341d };
      case 'alpine':
        return { screen: 0x090a06, glow: 0x31341c, apron: 0x454329, apronAlt: 0x344127, soil: 0x38321f };
      case 'coast':
        return { screen: 0x040a0c, glow: 0x123440, apron: 0x1f4149, apronAlt: 0x2b4431, soil: 0x24362c };
      case 'oldtown':
        return { screen: 0x090806, glow: 0x332919, apron: 0x41382b, apronAlt: 0x303329, soil: 0x3d3021 };
      case 'ruins':
        return { screen: 0x090706, glow: 0x382218, apron: 0x40352c, apronAlt: 0x352a24, soil: 0x42291d };
      case 'rift':
        return { screen: 0x100504, glow: 0x4a160d, apron: 0x47251c, apronAlt: 0x34211d, soil: 0x4c2116 };
      case 'urban':
      default:
        return { screen: 0x050907, glow: 0x1b3020, apron: 0x35402d, apronAlt: 0x2b3529, soil: 0x303421 };
    }
  }, [map.environment]);

  const battlefieldBackdrop = useMemo(() => {
    const nw = worldCornerOfTile(0, 0, 'NW', topGeomFor);
    const ne = worldCornerOfTile(map.width - 1, 0, 'NE', topGeomFor);
    const se = worldCornerOfTile(map.width - 1, map.height - 1, 'SE', topGeomFor);
    const sw = worldCornerOfTile(0, map.height - 1, 'SW', topGeomFor);
    const cx = (nw.x + ne.x + se.x + sw.x) / 4;
    const cy = (nw.y + ne.y + se.y + sw.y) / 4;
    const expand = (p: { x: number; y: number }, amount: number) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      return { x: p.x + (dx / len) * amount, y: p.y + (dy / len) * amount };
    };
    const outer = [expand(nw, 72), expand(ne, 88), expand(se, 94), expand(sw, 82)];
    const middle = [expand(nw, 36), expand(ne, 48), expand(se, 50), expand(sw, 42)];
    return (
      <Graphics
        zIndex={5000}
        draw={(g) => {
          g.clear();
          g.beginFill(battlefieldMood.apronAlt, 0.34);
          drawPoly(g as unknown as PixiGraphics, outer);
          g.endFill();
          g.beginFill(battlefieldMood.apron, 0.18);
          drawPoly(g as unknown as PixiGraphics, middle);
          g.endFill();
          // Plateau thickness: give the map a solid side along its camera-facing (lower) edges so it
          // reads as a slab with depth instead of a flat cutout floating on the void — the hard
          // grass-to-dark edge is what made props near the boundary look like they drop off.
          const corners = [nw, ne, se, sw];
          const SLAB_D = Math.max(18, Math.round(tileSize * 0.5));
          for (let i = 0; i < 4; i += 1) {
            const a = corners[i];
            const b = corners[(i + 1) % 4];
            if ((a.y + b.y) / 2 <= cy + 1) continue; // only lower (camera-facing) edges
            // soil band just under the rim, then a darker face fading into the void
            g.beginFill(battlefieldMood.soil, 0.94);
            g.drawPolygon([a.x, a.y, b.x, b.y, b.x, b.y + SLAB_D * 0.32, a.x, a.y + SLAB_D * 0.32]);
            g.endFill();
            g.beginFill(darkenColor(battlefieldMood.soil, 0.62), 0.94);
            g.drawPolygon([a.x, a.y + SLAB_D * 0.32, b.x, b.y + SLAB_D * 0.32, b.x, b.y + SLAB_D, a.x, a.y + SLAB_D]);
            g.endFill();
          }
          for (let i = 0; i < 18; i++) {
            const salt = 810 + i * 3;
            const u = tileNoise(i, map.width, salt);
            const v = tileNoise(i, map.height, salt + 1);
            const left = outer[3].x + (outer[2].x - outer[3].x) * u;
            const right = outer[0].x + (outer[1].x - outer[0].x) * u;
            const top = outer[0].y + (outer[3].y - outer[0].y) * v;
            const bottom = outer[1].y + (outer[2].y - outer[1].y) * v;
            const x = (left + right) / 2 + (tileNoise(i, map.width, salt + 2) - 0.5) * 70;
            const y = (top + bottom) / 2 + (tileNoise(i, map.height, salt + 3) - 0.5) * 48;
            g.beginFill(
              tileNoise(i, map.width, salt + 4) > 0.5 ? battlefieldMood.apron : battlefieldMood.apronAlt,
              0.075
            );
            g.drawEllipse(x, y, 38 + tileNoise(i, map.width, salt + 5) * 70, 12 + tileNoise(i, map.height, salt + 6) * 30);
            g.endFill();
          }
        }}
      />
    );
  }, [battlefieldMood, map.height, map.width, topGeomFor]);

  // A skirt of dark out-of-bounds terrain diamonds ringing the playable map, fading into the backdrop.
  // Without it the battlefield is a lit cut-out floating in black and reads as a tiny arena; the skirt
  // makes it sit inside a larger darkened landscape (the requested "part of a world", not an island).
  const voidSkirt = useMemo(() => {
    const M = 12;
    const hw = ISO_TILE_W / 2;
    const hh = ISO_TILE_H / 2;
    const diamonds: { x: number; y: number; color: number; alpha: number }[] = [];
    for (let r = -M; r < map.height + M; r += 1) {
      for (let q = -M; q < map.width + M; q += 1) {
        if (q >= 0 && q < map.width && r >= 0 && r < map.height) continue; // skip the real map
        const dq = q < 0 ? -q : q >= map.width ? q - (map.width - 1) : 0;
        const dr = r < 0 ? -r : r >= map.height ? r - (map.height - 1) : 0;
        const t = Math.min(1, Math.max(dq, dr) / M);
        const alpha = (1 - t) * (1 - t) * 0.92; // ease-out fade so the ring melts into the dark
        if (alpha <= 0.02) continue;
        const p = toScreen({ q, r });
        const n = tileNoise(q + 100, r + 100, 41);
        const base = n > 0.72
          ? mixColor(battlefieldMood.apron, battlefieldMood.soil, 0.38)
          : n > 0.4
            ? battlefieldMood.apron
            : battlefieldMood.apronAlt;
        diamonds.push({ x: p.x, y: p.y, color: darkenColor(base, t * 0.72), alpha });
      }
    }
    return (
      <Graphics
        draw={(g) => {
          g.clear();
          for (const d of diamonds) {
            g.beginFill(d.color, d.alpha);
            g.drawPolygon([d.x, d.y - hh, d.x + hw, d.y, d.x, d.y + hh, d.x - hw, d.y]);
            g.endFill();
          }
        }}
      />
    );
  }, [battlefieldMood, map.width, map.height]);

  const terrainPresentationRevision = useMemo(
    () => terrainDestructionRevision(battleState.timeline),
    // The timeline is mutated in place; length is the existing notification that new events arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [battleState.timeline, battleState.timeline.length]
  );
  const procBuildingUnderlay = useMemo(
    () => proceduralBuildingUnderlayTerrain(map.tiles, map.props ?? [], map.width, map.height),
    // Terrain mutations keep the tiles array identity, so the semantic timeline revision invalidates
    // the cached underlay and tile graphics after both demolition and scripted transformations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.height, map.props, map.tiles, map.width, terrainPresentationRevision]
  );
  const coveredByProcBuilding = useMemo(
    () => new Set(procBuildingUnderlay.keys()),
    [procBuildingUnderlay]
  );

  const tileGraphics = useMemo(() => {
    const EDGE_KEYS: EdgeKey[] = ['N', 'E', 'S', 'W'];
    const EDGE_VECTORS: Record<EdgeKey, { dq: number; dr: number }> = {
      N: { dq: 0, dr: -1 },
      E: { dq: +1, dr: 0 },
      S: { dq: 0, dr: +1 },
      W: { dq: -1, dr: 0 }
    };
    const idxAt = (qq: number, rr: number) => rr * map.width + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;
    const visualTerrainAt = (index: number) => presentationTerrainAt(map.tiles, procBuildingUnderlay, index);
    return map.tiles.map((tile, index) => {
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = toScreen({ q, r });
      const corners = snappedCorners.getCorners(q, r);
      const cornerHeights: Record<CornerKey, number> = {
        NW: corners.hNW,
        NE: corners.hNE,
        SE: corners.hSE,
        SW: corners.hSW
      };
      const avgHeight = averageCornerHeight(corners);
      const cornerPoints = makeCornerPoints(corners, avgHeight);
      const tris = topTrianglesFor(corners);
      const isVisible = visibleTiles.has(index);
      const isExplored = exploredTiles.has(index);
      const visualTerrain = visualTerrainAt(index);
      const fillTerrain = visualTerrain === 'road' ? 'plain' : visualTerrain === 'water' ? 'swamp' : visualTerrain;
      let baseColor = terrainPalette[fillTerrain] ?? terrainPalette.plain;
      const colorNoise = smoothTerrainNoise(q, r, 911, 4.2) - 0.5;
      if (visualTerrain !== 'water') {
        // gentle per-tile variation: too much turns the ground into a low-poly patchwork of
        // hard-edged diamonds, so keep the step between neighbours subtle.
        baseColor = colorNoise > 0
          ? lightenColor(baseColor, colorNoise * 0.045)
          : darkenColor(baseColor, Math.abs(colorNoise) * 0.06);
      }
      const roadColor = terrainPalette.road;
      const waterColor = terrainPalette.water;
      const tex =
        (externalTerrainTextures?.[fillTerrain] ?? externalTerrainTextures?.plain) ??
        (terrainTextures[fillTerrain] ?? terrainTextures.plain);
      const roadTex =
        externalTerrainTextures?.road ??
        (terrainTextures.road ?? tex);
      const waterTex =
        externalTerrainTextures?.water ??
        (terrainTextures.water ?? tex);
      const coloredTex = !!externalTerrainTextures && externalTexturesAreColored;
      // Memory tiles lean on the desaturated base color, so the texture sits back further when not visible.
      // Memory (explored, not visible) keeps the continuous texture nearly opaque too — just with a
      // cool desaturating tint — so fogged ground reads as one dimmed painted surface instead of a
      // patchwork of per-tile dark diamonds.
      const overlayAlpha = coloredTex ? (isVisible ? 0.9 : 0.82) : (isVisible ? 0.4 : 0.18);
      let texMatrix: Matrix;
      if (coloredTex) {
        // Map the large painted texture continuously in WORLD space so the ground reads as one
        // cohesive painted surface (REPEAT wrap tiles it seamlessly).
        const k = terrainTextureWorldUnitsPerTexel(fillTerrain);
        const gx = pos.x;
        const gy = pos.y - avgHeight * ELEV_Y_OFFSET;
        texMatrix = worldTextureMatrix(gx, gy, k);
      } else {
        texMatrix = new Matrix();
        texMatrix.translate((q * 13 + r * 7) % 64, (q * 5 + r * 11) % 64);
      }
      const macroScale = 3.2;
      const macroTextureMatrix = worldTextureMatrix(
        pos.x,
        pos.y - avgHeight * ELEV_Y_OFFSET,
        macroScale
      );
      const center = {
        x: (cornerPoints.NW.x + cornerPoints.NE.x + cornerPoints.SE.x + cornerPoints.SW.x) / 4,
        y: (cornerPoints.NW.y + cornerPoints.NE.y + cornerPoints.SE.y + cornerPoints.SW.y) / 4
      };
      const tileHitArea = new Polygon([
        cornerPoints.NW.x,
        cornerPoints.NW.y,
        cornerPoints.NE.x,
        cornerPoints.NE.y,
        cornerPoints.SE.x,
        cornerPoints.SE.y,
        cornerPoints.SW.x,
        cornerPoints.SW.y
      ]);

      return (
        <Graphics
          key={`tile-${index}`}
          x={pos.x}
          y={pos.y - avgHeight * ELEV_Y_OFFSET}
          hitArea={tileHitArea}
          eventMode={isExplored ? 'static' : 'none'}
          cursor={isExplored ? 'pointer' : 'not-allowed'}
          pointertap={(event: FederatedPointerEvent) => {
            event.stopPropagation();
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
              if (!isExplored) {
                // Constant fog colour (not per-tile baseColor) so a region of unknown reads as one
                // dark expanse instead of a patchwork of subtly different dark diamonds.
                const hiddenColor = 0x101a18;
                g.beginFill(hiddenColor, 0.84);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                g.endFill();
                g.beginTextureFill({ texture: tex, matrix: texMatrix, alpha: 0.17, color: 0x718179 });
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                g.endFill();
                EDGE_KEYS.forEach((edge, edgeIndex) => {
                  const vec = EDGE_VECTORS[edge];
                  const nq = q + vec.dq;
                  const nr = r + vec.dr;
                  if (!inb(nq, nr)) return;
                  const neighborIndex = idxAt(nq, nr);
                  if (!exploredTiles.has(neighborIndex)) return;
                  const [cornerA, cornerB] = EDGE_TO_CORNERS[edge];
                  const a = cornerPoints[cornerA];
                  const b = cornerPoints[cornerB];
                  const towardCenter = (point: { x: number; y: number }, amount: number) => ({
                    x: point.x + (center.x - point.x) * amount,
                    y: point.y + (center.y - point.y) * amount
                  });
                  const neighborTerrain = visualTerrainAt(neighborIndex);
                  const neighborColor = memoryColor(terrainPalette[neighborTerrain] ?? terrainPalette.plain);
                  const featherColor = mixColor(neighborColor, hiddenColor, 0.48);
                  const jitter = tileNoise(q, r, 980 + edgeIndex) * 0.05;
                  const bands = [
                    { d0: 0, d1: 0.2 + jitter, alpha: 0.34 },
                    { d0: 0.2 + jitter, d1: 0.42 + jitter, alpha: 0.2 },
                    { d0: 0.42 + jitter, d1: 0.66, alpha: 0.09 }
                  ];
                  for (const band of bands) {
                    g.beginFill(featherColor, band.alpha);
                    drawPoly(g as unknown as PixiGraphics, [
                      towardCenter(a, band.d0),
                      towardCenter(b, band.d0),
                      towardCenter(b, band.d1),
                      towardCenter(a, band.d1)
                    ]);
                    g.endFill();
                  }
                });
                return;
              }
              const fillCol = isVisible ? baseColor : memoryColor(baseColor);
              const fillA = isVisible ? 0.98 : 0.66;
              for (const tri of tris) {
                const [a, b, c] = tri;
                g.beginFill(fillCol, fillA);
                g.moveTo(cornerPoints[a].x, cornerPoints[a].y);
                g.lineTo(cornerPoints[b].x, cornerPoints[b].y);
                g.lineTo(cornerPoints[c].x, cornerPoints[c].y);
                g.closePath();
                g.endFill();
              }
              for (const tri of tris) {
                const [a, b, c] = tri;
                // Memory (explored, not visible) tiles get a cool desaturating tint on the texture too, so
                // the saturated terrain texture doesn't fight the desaturated base fill / grime.
                g.beginTextureFill({ texture: tex, matrix: texMatrix, alpha: overlayAlpha, color: isVisible ? 0xffffff : 0x9aa3b0 });
                g.moveTo(cornerPoints[a].x, cornerPoints[a].y);
                g.lineTo(cornerPoints[b].x, cornerPoints[b].y);
                g.lineTo(cornerPoints[c].x, cornerPoints[c].y);
                g.closePath();
                g.endFill();
              }

              if (tile.terrain === 'road') {
                const roadNeighbor = (edge: EdgeKey) => {
                  const vec = EDGE_VECTORS[edge];
                  if (!inb(q + vec.dq, r + vec.dr)) return false;
                  const neighbor = map.tiles[idxAt(q + vec.dq, r + vec.dr)];
                  return neighbor?.terrain === 'road' || neighbor?.terrain === 'urban' || neighbor?.terrain === 'structure';
                };
                const edgeMid = (edge: EdgeKey) => {
                  const [a, b] = EDGE_TO_CORNERS[edge];
                  return {
                    x: (cornerPoints[a].x + cornerPoints[b].x) / 2,
                    y: (cornerPoints[a].y + cornerPoints[b].y) / 2
                  };
                };
                const connected = EDGE_KEYS.filter(roadNeighbor);
                const exits = connected.length > 0 ? connected : (['E', 'W'] as EdgeKey[]);
                const roadAlpha = isVisible ? 0.96 : 0.68;
                const shoulderColor = mixColor(roadColor, baseColor, 0.34);
                const drawRoadBand = (edge: EdgeKey, width: number, color: number, alpha: number, jitterSalt: number) => {
                  const p = edgeMid(edge);
                  const dx = p.x - center.x;
                  const dy = p.y - center.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  const nx = (-dy / len) * width;
                  const ny = (dx / len) * width * 0.72;
                  const j1 = (tileNoise(q, r, jitterSalt) - 0.5) * 1.8;
                  const j2 = (tileNoise(q, r, jitterSalt + 1) - 0.5) * 1.8;
                  const poly = [
                    { x: center.x + nx + j1, y: center.y + ny },
                    { x: p.x + nx + j2, y: p.y + ny },
                    { x: p.x - nx + j2, y: p.y - ny },
                    { x: center.x - nx + j1, y: center.y - ny }
                  ];
                  g.beginFill(color, alpha);
                  drawPoly(g as unknown as PixiGraphics, poly);
                  g.endFill();
                };
                exits.forEach((edge, i) => {
                  drawRoadBand(edge, 10.5, darkenColor(shoulderColor, 0.1), isVisible ? 0.92 : 0.58, 310 + i * 7);
                });
                g.beginFill(darkenColor(shoulderColor, 0.12), isVisible ? 0.95 : 0.62);
                g.drawEllipse(center.x, center.y, 12.5, 5.8);
                g.endFill();
                exits.forEach((edge, i) => {
                  drawRoadBand(edge, 7.2, roadColor, roadAlpha, 340 + i * 7);
                });
                g.beginFill(roadColor, roadAlpha);
                g.drawEllipse(center.x, center.y, 9.2, 4.2);
                g.endFill();
                exits.forEach((edge, i) => {
                  const p = edgeMid(edge);
                  const dx = p.x - center.x;
                  const dy = p.y - center.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  const nx = (-dy / len) * 4.8;
                  const ny = (dx / len) * 3;
                  const poly = [
                    { x: center.x + nx, y: center.y + ny },
                    { x: p.x + nx, y: p.y + ny },
                    { x: p.x - nx, y: p.y - ny },
                    { x: center.x - nx, y: center.y - ny }
                  ];
                  const roadTextureMatrix = coloredTex
                    ? worldTextureMatrix(pos.x, pos.y - avgHeight * ELEV_Y_OFFSET, 0.92)
                    : new Matrix();
                  if (!coloredTex) {
                    roadTextureMatrix.translate((q * 17 + r * 5 + i * 11) % 64, (q * 3 + r * 19 + i * 7) % 32);
                  }
                  g.beginTextureFill({ texture: roadTex, matrix: roadTextureMatrix, alpha: isVisible ? 0.32 : 0.18 });
                  drawPoly(g as unknown as PixiGraphics, poly);
                  g.endFill();
                  g.lineStyle(1, darkenColor(roadColor, 0.24), isVisible ? 0.35 : 0.18);
                  g.moveTo(center.x + nx, center.y + ny);
                  g.lineTo(p.x + nx, p.y + ny);
                  g.moveTo(center.x - nx, center.y - ny);
                  g.lineTo(p.x - nx, p.y - ny);
                  g.lineStyle();
                });
              }

              if (tile.terrain === 'water') {
                // Continuous blue base across the whole tile + world-mapped water texture, so a body
                // of water reads as one surface instead of swamp-green showing through the gaps
                // between river bands (which made each tile a distinct low-poly diamond).
                const waterQuad = [cornerPoints.NW, cornerPoints.NE, cornerPoints.SE, cornerPoints.SW];
                g.beginFill(waterColor, isVisible ? 0.72 : 0.5);
                drawPoly(g as unknown as PixiGraphics, waterQuad);
                g.endFill();
                const fullWaterMatrix = coloredTex
                  ? worldTextureMatrix(pos.x, pos.y - avgHeight * ELEV_Y_OFFSET, 0.92)
                  : new Matrix();
                if (!coloredTex) {
                  fullWaterMatrix.translate((q * 23 + r * 7) % 64, (q * 5 + r * 17) % 32);
                }
                // Let the realistic painted water texture carry the surface; it maps continuously
                // across tiles so a body of water reads as one rippling sheet.
                g.beginTextureFill({ texture: waterTex, matrix: fullWaterMatrix, alpha: isVisible ? 0.82 : 0.5 });
                drawPoly(g as unknown as PixiGraphics, waterQuad);
                g.endFill();
                // Soft central depth darkening for body. The rippling surface + colour now come
                // from the continuous painted water texture above; the old per-tile river bands +
                // ellipses are what made the water read as faceted low-poly diamonds, so they're gone.
                g.beginFill(darkenColor(waterColor, 0.3), isVisible ? 0.2 : 0.12);
                g.drawEllipse(center.x, center.y, 15, 6.8);
                g.endFill();
              }

              const detailFamily = terrainDetailFamily(visualTerrain);
              const detailDensity = terrainDetailDensity(q, r, visualTerrain);
              const macroTint = detailFamily === 'wet'
                ? 0x678f8b
                : detailFamily === 'built'
                  ? 0x554938
                  : 0x425a34;
              const macroAlpha = detailFamily === 'wet' ? 0.1 : detailFamily === 'built' ? 0.085 : 0.09;
              for (const tri of tris) {
                const [a, b, c] = tri;
                g.beginTextureFill({
                  texture: terrainMacroTexture,
                  matrix: macroTextureMatrix,
                  alpha: macroAlpha * (isVisible ? 1 : 0.32),
                  color: isVisible ? macroTint : memoryColor(macroTint)
                });
                g.moveTo(cornerPoints[a].x, cornerPoints[a].y);
                g.lineTo(cornerPoints[b].x, cornerPoints[b].y);
                g.lineTo(cornerPoints[c].x, cornerPoints[c].y);
                g.closePath();
                g.endFill();
              }

              if (isVisible) {
                // With the painted photo texture present, heavy per-tile decals just stamp
                // tile-confined clumps over a continuous surface → that's what read as a low-poly
                // patchwork. Keep them very light so the painted ground carries the detail.
                const decalAlpha = coloredTex ? 0.075 : 0.25;
                const drawSpot = (salt: number, color: number, alpha: number, rx: number, ry: number) => {
                  const px = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.56;
                  const py = (tileNoise(q, r, salt + 17) - 0.5) * ISO_TILE_H * 0.58;
                  const angle = (tileNoise(q, r, salt + 31) - 0.5) * 0.8;
                  const len = Math.max(2, rx * (0.8 + tileNoise(q, r, salt + 32) * 0.55));
                  const dx = Math.cos(angle) * len * 0.5;
                  const dy = Math.sin(angle) * Math.max(1, ry) * 0.55;
                  g.lineStyle(1, color, alpha * 0.75);
                  g.moveTo(px - dx, py - dy);
                  g.lineTo(px + dx, py + dy);
                  g.lineStyle();
                  g.beginFill(color, alpha * 0.45);
                  g.drawRect(Math.round(px - rx * 0.12), Math.round(py - 0.5), Math.max(1, Math.round(rx * 0.24)), 1);
                  g.endFill();
                };
                const drawStroke = (salt: number, color: number, alpha: number, len = 12) => {
                  const px = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.58;
                  const py = (tileNoise(q, r, salt + 9) - 0.5) * ISO_TILE_H * 0.56;
                  const angle = (tileNoise(q, r, salt + 19) - 0.5) * 0.7;
                  const dx = Math.cos(angle) * len * 0.5;
                  const dy = Math.sin(angle) * len * 0.22;
                  g.lineStyle(1, color, alpha);
                  g.moveTo(px - dx, py - dy);
                  g.lineTo(px + dx, py + dy);
                  g.lineStyle();
                };
                const pointOnTile = (u: number, v: number) => {
                  const top = {
                    x: lerp(cornerPoints.NW.x, cornerPoints.NE.x, u),
                    y: lerp(cornerPoints.NW.y, cornerPoints.NE.y, u)
                  };
                  const bottom = {
                    x: lerp(cornerPoints.SW.x, cornerPoints.SE.x, u),
                    y: lerp(cornerPoints.SW.y, cornerPoints.SE.y, u)
                  };
                  return {
                    x: lerp(top.x, bottom.x, v),
                    y: lerp(top.y, bottom.y, v)
                  };
                };
                const drawPixelBreakup = (
                  saltBase: number,
                  count: number,
                  colors: number[],
                  alpha = 0.34,
                  maxLen = 5
                ) => {
                  for (let i = 0; i < count; i++) {
                    const u = 0.08 + tileNoise(q, r, saltBase + i * 13) * 0.84;
                    const v = 0.1 + tileNoise(q, r, saltBase + i * 13 + 1) * 0.8;
                    const p = pointOnTile(u, v);
                    const color = colors[Math.floor(tileNoise(q, r, saltBase + i * 13 + 2) * colors.length)] ?? colors[0];
                    const horizontal = tileNoise(q, r, saltBase + i * 13 + 3) > 0.38;
                    const len = 1 + Math.floor(tileNoise(q, r, saltBase + i * 13 + 4) * maxLen);
                    const thickness = tileNoise(q, r, saltBase + i * 13 + 5) > 0.82 ? 2 : 1;
                    g.beginFill(color, alpha * (0.55 + tileNoise(q, r, saltBase + i * 13 + 6) * 0.5));
                    if (horizontal) {
                      g.drawRect(Math.round(p.x - len / 2), Math.round(p.y), len, thickness);
                    } else {
                      g.drawRect(Math.round(p.x), Math.round(p.y - len / 2), thickness, len);
                    }
                    g.endFill();
                  }
                };
                const detailCount = (base: number) => Math.max(
                  coloredTex ? 1 : 2,
                  Math.round(base * detailDensity * (coloredTex ? 0.24 : 1))
                );
                if (visualTerrain === 'plain') {
                  drawPixelBreakup(410, detailCount(14), [darkenColor(baseColor, 0.28), darkenColor(baseColor, 0.16), lightenColor(baseColor, 0.2), 0x334829], 0.26, 5);
                } else if (visualTerrain === 'forest') {
                  drawPixelBreakup(430, detailCount(20), [0x0b180d, 0x153015, 0x2e4a21, 0x4d6c32], 0.36, 5);
                } else if (visualTerrain === 'hill') {
                  drawPixelBreakup(450, detailCount(18), [darkenColor(baseColor, 0.3), 0x7e7c49, 0x454629, 0x97905d], 0.31, 6);
                } else if (visualTerrain === 'road') {
                  drawPixelBreakup(470, detailCount(14), [0x342a20, 0x7d6d54, 0x4a3d2f, 0x998a6b], 0.32, 7);
                } else if (visualTerrain === 'urban' || visualTerrain === 'structure') {
                  drawPixelBreakup(490, detailCount(16), [0x2d2c29, 0x746f65, 0x494640, 0x938c7c], 0.31, 5);
                } else if (visualTerrain === 'swamp') {
                  drawPixelBreakup(510, detailCount(14), [0x182516, 0x594c30, 0x416138, 0x0e1d12], 0.32, 5);
                } else if (visualTerrain === 'water') {
                  drawPixelBreakup(530, detailCount(10), [0x0c2a3a, 0x2f6b7b, 0x78aab0], 0.28, 7);
                }
                const scar = tileNoise(q, r, 103);
                if (scar > 0.7 && visualTerrain !== 'water') {
                  drawSpot(104, 0x17130f, decalAlpha * 1.25, 7 + tileNoise(q, r, 105) * 5, 3.2);
                  drawSpot(106, 0x5f5a4a, decalAlpha * 0.55, 4.5, 1.8);
                }
                if (visualTerrain === 'plain' || visualTerrain === 'hill' || visualTerrain === 'swamp') {
                  drawSpot(1, darkenColor(baseColor, 0.32), decalAlpha, 9, 3.5);
                  drawSpot(2, lightenColor(baseColor, 0.13), decalAlpha * 0.8, 11, 2.7);
                  drawSpot(8, darkenColor(baseColor, 0.24), decalAlpha * 0.8, 4.5, 2.2);
                  drawSpot(15, 0x1b2514, decalAlpha * 0.55, 6, 2.5);
                  drawStroke(30, lightenColor(baseColor, 0.13), decalAlpha * 0.95, 11);
                  drawStroke(31, darkenColor(baseColor, 0.28), decalAlpha * 0.75, 15);
                  drawStroke(37, 0x1a2516, decalAlpha * 0.7, 17);
                } else if (visualTerrain === 'forest') {
                  drawSpot(3, 0x0f2310, decalAlpha * 1.65, 10, 5.5);
                  drawSpot(4, 0x3a5c27, decalAlpha * 1.05, 8, 3.3);
                  drawSpot(12, 0x0b1a0d, decalAlpha * 1.35, 6, 4.4);
                  drawStroke(33, 0x172e14, decalAlpha * 1.1, 15);
                  drawStroke(38, 0x314c24, decalAlpha * 0.7, 11);
                } else if (visualTerrain === 'road' || visualTerrain === 'urban') {
                  const markBase = visualTerrain === 'road' ? roadColor : baseColor;
                  g.lineStyle(1, darkenColor(markBase, 0.26), decalAlpha * 0.9);
                  for (let i = 0; i < 3; i++) {
                    const px = (tileNoise(q, r, 50 + i) - 0.5) * ISO_TILE_W * 0.55;
                    const py = (tileNoise(q, r, 60 + i) - 0.5) * ISO_TILE_H * 0.55;
                    g.moveTo(px - 7, py);
                    g.lineTo(px + 8, py + (tileNoise(q, r, 70 + i) - 0.5) * 2);
                  }
                  g.lineStyle();
                  drawSpot(5, lightenColor(markBase, 0.1), decalAlpha * 0.68, 8, 2.3);
                  drawSpot(14, 0x211a12, decalAlpha * 0.72, 6, 2.8);
                  drawStroke(54, 0x1a1511, decalAlpha * 0.98, 20);
                  drawStroke(55, 0x756954, decalAlpha * 0.52, 13);
                } else if (visualTerrain === 'water') {
                  // ripples come from the continuous painted water texture now; the old per-tile
                  // wave strokes just read as digital stripes. Keep only a faint depth darkening.
                  drawSpot(92, 0x0d2f43, 0.12, 12, 3.2);
                }
              }

              EDGE_KEYS.forEach((edge) => {
                const [cornerA, cornerB] = EDGE_TO_CORNERS[edge];
                const myEdgeHeight = (cornerHeights[cornerA] + cornerHeights[cornerB]) / 2;
                const vec = EDGE_VECTORS[edge];
                const nq = q + vec.dq;
                const nr = r + vec.dr;
                if (!inb(nq, nr)) return;
                const neighborIdx = idxAt(nq, nr);
                if (!exploredTiles.has(neighborIdx)) return;
                const neighborVisualTerrain = visualTerrainAt(neighborIdx);
                const neighborCorners = snappedCorners.getCorners(nq, nr);
                const neighborHeights: Record<CornerKey, number> = {
                  NW: neighborCorners.hNW,
                  NE: neighborCorners.hNE,
                  SE: neighborCorners.hSE,
                  SW: neighborCorners.hSW
                };
                const oppEdge = OPP_EDGE[edge];
                const [oppA, oppB] = EDGE_TO_CORNERS[oppEdge];
                const neighborHeight = (neighborHeights[oppA] + neighborHeights[oppB]) / 2;
                const delta = neighborHeight - myEdgeHeight;
                if (visualTerrain === 'water' || neighborVisualTerrain === 'water') {
                  const a = cornerPoints[cornerA];
                  const b = cornerPoints[cornerB];
                  const edgeIndex = EDGE_KEYS.indexOf(edge);
                  const towardCenter = (p: { x: number; y: number }, amount: number) => ({
                    x: p.x + (center.x - p.x) * amount,
                    y: p.y + (center.y - p.y) * amount
                  });
                  const mid = {
                    x: (a.x + b.x) / 2 + (tileNoise(q, r, 620 + edgeIndex) - 0.5) * 3.4,
                    y: (a.y + b.y) / 2 + (tileNoise(q, r, 624 + edgeIndex) - 0.5) * 2.2
                  };
                  if (visualTerrain !== neighborVisualTerrain) {
                    const landTerrain = visualTerrain === 'water' ? neighborVisualTerrain : visualTerrain;
                    const landColor = terrainPalette[landTerrain] ?? terrainPalette.plain;
                    const bankBase = mixColor(landColor, terrainPalette.water, visualTerrain === 'water' ? 0.18 : 0.32);
                    const depthA = 0.13 + tileNoise(q, r, 630 + edgeIndex) * 0.08;
                    const depthB = 0.13 + tileNoise(q, r, 634 + edgeIndex) * 0.08;
                    const depthM = 0.2 + tileNoise(q, r, 638 + edgeIndex) * 0.09;
                    const bank = [
                      a,
                      b,
                      towardCenter(b, depthB),
                      towardCenter(mid, depthM),
                      towardCenter(a, depthA)
                    ];
                    g.beginFill(bankBase, visualTerrain === 'water' ? (isVisible ? 0.88 : 0.58) : (isVisible ? 0.62 : 0.36));
                    drawPoly(g as unknown as PixiGraphics, bank);
                    g.endFill();
                    const wet = [
                      towardCenter(a, Math.max(0.04, depthA - 0.05)),
                      towardCenter(b, Math.max(0.04, depthB - 0.05)),
                      towardCenter(b, depthB + 0.04),
                      towardCenter(mid, depthM + 0.04),
                      towardCenter(a, depthA + 0.04)
                    ];
                    g.beginFill(mixColor(bankBase, 0x0b2532, 0.35), isVisible ? 0.34 : 0.2);
                    drawPoly(g as unknown as PixiGraphics, wet);
                    g.endFill();
                  }
                  const shoreColor = visualTerrain === neighborVisualTerrain ? 0x24485b : 0x8c8a6d;
                  const shoreAlpha = visualTerrain === neighborVisualTerrain ? 0.08 : 0.36;
                  g.lineStyle(visualTerrain === neighborVisualTerrain ? 1 : 2, shoreColor, shoreAlpha);
                  g.moveTo(a.x, a.y);
                  g.lineTo(mid.x, mid.y);
                  g.lineTo(b.x, b.y);
                  g.lineStyle();
                } else if (visualTerrain !== neighborVisualTerrain) {
                  // Feather land↔land boundaries (grass/road/dirt) so the ground reads as one painted
                  // surface instead of hard-cut low-poly diamonds. Bleed the neighbour's tone a short
                  // way into this tile along the shared edge with a few fading bands.
                  const a = cornerPoints[cornerA];
                  const b = cornerPoints[cornerB];
                  const edgeIndex = EDGE_KEYS.indexOf(edge);
                  const toC = (p: { x: number; y: number }, amt: number) => ({
                    x: p.x + (center.x - p.x) * amt,
                    y: p.y + (center.y - p.y) * amt
                  });
                  const nColor = terrainPalette[neighborVisualTerrain] ?? baseColor;
                  const blend = mixColor(baseColor, nColor, 0.62);
                  const bands = [
                    { d: 0.13 + tileNoise(q, r, 700 + edgeIndex) * 0.05, a: isVisible ? 0.5 : 0.32 },
                    { d: 0.27 + tileNoise(q, r, 706 + edgeIndex) * 0.06, a: isVisible ? 0.28 : 0.17 },
                    { d: 0.42 + tileNoise(q, r, 712 + edgeIndex) * 0.06, a: isVisible ? 0.13 : 0.08 }
                  ];
                  let pa = a, pb = b;
                  for (const band of bands) {
                    const ca = toC(a, band.d);
                    const cb = toC(b, band.d);
                    g.beginFill(blend, band.a);
                    drawPoly(g as unknown as PixiGraphics, [pa, pb, cb, ca]);
                    g.endFill();
                    pa = ca; pb = cb;
                  }
                }
                if (delta > 0 && delta <= 1.05 && visualTerrain !== 'water') {
                  const tint = mixColor(
                    baseColor,
                    terrainPalette[neighborVisualTerrain] ?? baseColor,
                    0.45
                  );
                  const alpha = (coloredTex ? (isVisible ? 0.16 : 0.12) : (isVisible ? 0.4 : 0.3)) * Math.min(1, delta);
                  g.beginFill(tint, alpha);
                  g.moveTo(center.x, center.y);
                  g.lineTo(cornerPoints[cornerA].x, cornerPoints[cornerA].y);
                  g.lineTo(cornerPoints[cornerB].x, cornerPoints[cornerB].y);
                  g.closePath();
                  g.endFill();
                } else if (delta < 0) {
                  const depth = Math.min(1, Math.abs(delta));
                  const tint = darkenColor(baseColor, 0.25);
                  const alpha = (coloredTex ? (isVisible ? 0.12 : 0.08) : (isVisible ? 0.26 : 0.16)) * depth;
                  g.beginFill(tint, alpha);
                  g.moveTo(center.x, center.y);
                  g.lineTo(cornerPoints[cornerB].x, cornerPoints[cornerB].y);
                  g.lineTo(cornerPoints[cornerA].x, cornerPoints[cornerA].y);
                  g.closePath();
                  g.endFill();
                }
              });

              EDGE_KEYS.forEach((edge, edgeIndex) => {
                const [cornerA, cornerB] = EDGE_TO_CORNERS[edge];
                const vec = EDGE_VECTORS[edge];
                const nq = q + vec.dq;
                const nr = r + vec.dr;
                const neighborIdx = inb(nq, nr) ? idxAt(nq, nr) : -1;
                if (neighborIdx >= 0 && exploredTiles.has(neighborIdx)) return;
                const a = cornerPoints[cornerA];
                const b = cornerPoints[cornerB];
                const towardCenter = (p: { x: number; y: number }, amount: number) => ({
                  x: p.x + (center.x - p.x) * amount,
                  y: p.y + (center.y - p.y) * amount
                });
                // Soft gradient skirt that fades the explored ground into the dark unknown over
                // several miznuce bands — no hard fringe band or edge line — so the fog frontier
                // reads as a soft shadow, not a low-poly diamond cut.
                const dk = 0x101a18;
                const n = 0.04 + tileNoise(q, r, 960 + edgeIndex) * 0.06;
                const bands = [
                  { d0: 0, d1: 0.10 + n, a: isVisible ? 0.36 : 0.26 },
                  { d0: 0.10 + n, d1: 0.23 + n, a: isVisible ? 0.2 : 0.14 },
                  { d0: 0.23 + n, d1: 0.38 + n, a: isVisible ? 0.1 : 0.07 }
                ];
                for (const band of bands) {
                  g.beginFill(dk, band.a);
                  drawPoly(g as unknown as PixiGraphics, [
                    towardCenter(a, band.d0), towardCenter(b, band.d0),
                    towardCenter(b, band.d1), towardCenter(a, band.d1)
                  ]);
                  g.endFill();
                }
              });

            }}
          />
      );
    });
  }, [
    externalTerrainTextures,
    externalTexturesAreColored,
    exploredTiles,
    friendlyByCoord,
    map.height,
    map.tiles,
    map.width,
    onSelectTile,
    onSelectUnit,
    procBuildingUnderlay,
    snappedCorners,
    terrainMacroTexture,
    terrainTextures,
    visibleTiles
  ]);

  const screenBackdrop = useMemo(() => {
    return (
      <Graphics
        draw={(g) => {
          g.clear();
          g.beginFill(battlefieldMood.screen, 1);
          g.drawRect(0, 0, hostSize.w, hostSize.h);
          g.endFill();
          g.beginFill(battlefieldMood.glow, 0.34);
          g.drawPolygon([
            -hostSize.w * 0.08, hostSize.h * 0.22,
            hostSize.w * 0.42, -hostSize.h * 0.1,
            hostSize.w * 1.08, hostSize.h * 0.28,
            hostSize.w * 0.52, hostSize.h * 0.72
          ]);
          g.endFill();
          g.beginFill(battlefieldMood.apronAlt, 0.22);
          g.drawPolygon([
            hostSize.w * 0.12, hostSize.h * 0.82,
            hostSize.w * 0.78, hostSize.h * 0.48,
            hostSize.w * 1.1, hostSize.h * 0.68,
            hostSize.w * 0.56, hostSize.h * 1.08
          ]);
          g.endFill();
          for (let i = 0; i < 12; i += 1) {
            const y = hostSize.h * (0.12 + i * 0.075);
            g.lineStyle(1, battlefieldMood.apron, 0.075);
            g.moveTo(-hostSize.w * 0.1, y);
            g.lineTo(hostSize.w * 1.08, y + hostSize.h * 0.45);
          }
          g.lineStyle();
          g.beginFill(0x000000, 0.18);
          g.drawRect(0, 0, hostSize.w, hostSize.h);
          g.endFill();
        }}
      />
    );
  }, [battlefieldMood, hostSize.h, hostSize.w]);

  // Screen-space vignette: darkens the corners so the eye settles on the action and the scene reads
  // as one lit space rather than flat-lit tiles. Radial gradients aren't a Pixi Graphics primitive,
  // so bake it into a canvas texture once per viewport size and draw it as a non-interactive sprite.
  const vignetteTexture = useMemo(() => {
    const w = Math.max(1, Math.round(hostSize.w));
    const h = Math.max(1, Math.round(hostSize.h));
    return makeCanvasTexture((ctx, cw, ch) => {
      const cx = cw / 2, cy = ch / 2;
      const inner = Math.max(cw, ch) * 0.62;
      const outer = Math.hypot(cx, cy);
      const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
      grad.addColorStop(0, 'rgba(4,8,14,0)');
      grad.addColorStop(1, 'rgba(4,8,14,0.11)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
    }, w, h);
  }, [hostSize.w, hostSize.h]);
  // Free the previous vignette texture + its backing canvas when the viewport size changes (and on unmount),
  // so repeated resizes don't accumulate orphaned BaseTextures.
  useEffect(() => {
    return () => { try { vignetteTexture.destroy(true); } catch { /* already gone */ } };
  }, [vignetteTexture]);

  const tileOverlays = useMemo(() => {
    return map.tiles
      .map((_, index) => {
        const q = index % map.width;
        const r = Math.floor(index / map.width);
        const pos = toScreen({ q, r });
        const corners = snappedCorners.getCorners(q, r);
        const avgHeight = averageCornerHeight(corners);
        const cornerPoints = makeCornerPoints(corners, avgHeight);
        const isVisible = visibleTiles.has(index);
        const isExplored = exploredTiles.has(index);
        if (!isExplored) return null;
        return (
          <Graphics
            key={`overlay-${index}`}
            x={pos.x}
            y={pos.y - avgHeight * ELEV_Y_OFFSET}
            draw={(g) => {
              g.clear();
              g.lineStyle(1, 0x0b1a12, isVisible ? TERRAIN_GRID_ALPHA : TERRAIN_GRID_ALPHA * 0.55);
              g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
              g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
              g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
              g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
              g.closePath();
              if (isVisible) {
                g.lineStyle(1, 0xd7e2b7, TERRAIN_GRID_ALPHA * 0.22);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
              }
              g.lineStyle();
            }}
          />
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [exploredTiles, map.tiles, map.width, snappedCorners, visibleTiles]);
  const terrainGrimeLayer = useMemo(() => {
    return (
      <Graphics
        draw={(g) => {
          g.clear();
          const indexAt = (q: number, r: number) => r * map.width + q;
          const inBounds = (q: number, r: number) => (
            q >= 0 && r >= 0 && q < map.width && r < map.height
          );
          for (let blockR = 0; blockR < map.height; blockR += 4) {
            for (let blockQ = 0; blockQ < map.width; blockQ += 4) {
              const q = Math.min(map.width - 1, blockQ + Math.floor(tileNoise(blockQ, blockR, 931) * 4));
              const r = Math.min(map.height - 1, blockR + Math.floor(tileNoise(blockQ, blockR, 947) * 4));
              const index = indexAt(q, r);
              if (!visibleTiles.has(index)) continue;
              const family = terrainDetailFamily(
                presentationTerrainAt(map.tiles, procBuildingUnderlay, index)
              );
              const neighbors: Array<{ q: number; r: number }> = [];
              for (let dr = -TERRAIN_WASH_VISIBILITY_RADIUS; dr <= TERRAIN_WASH_VISIBILITY_RADIUS; dr += 1) {
                for (let dq = -TERRAIN_WASH_VISIBILITY_RADIUS; dq <= TERRAIN_WASH_VISIBILITY_RADIUS; dq += 1) {
                  neighbors.push({ q: q + dq, r: r + dr });
                }
              }
              if (!neighbors.every((coord) => (
                inBounds(coord.q, coord.r)
                && visibleTiles.has(indexAt(coord.q, coord.r))
                && terrainDetailFamily(
                  presentationTerrainAt(map.tiles, procBuildingUnderlay, indexAt(coord.q, coord.r))
                ) === family
              ))) {
                continue;
              }
              const geom = topGeomFor(q, r);
              const pos = toScreen({ q, r });
              const cx = pos.x + geom.center.x + (tileNoise(q, r, 953) - 0.5) * ISO_TILE_W * 0.7;
              const cy = pos.y - geom.avgHeight * ELEV_Y_OFFSET + geom.center.y
                + (tileNoise(q, r, 967) - 0.5) * ISO_TILE_H * 0.7;
              const density = terrainDetailDensity(
                q,
                r,
                presentationTerrainAt(map.tiles, procBuildingUnderlay, index)
              );
              const radiusX = ISO_TILE_W * (1.08 + tileNoise(q, r, 971) * 0.86);
              const radiusY = ISO_TILE_H * (1.02 + tileNoise(q, r, 977) * 0.72);
              const color = family === 'wet' ? 0x315c5c : family === 'built' ? 0x40362b : 0x34452a;
              const highlight = family === 'wet' ? 0x6d9290 : family === 'built' ? 0x766753 : 0x75845b;
              const strength = 0.026 + density * 0.024;
              g.beginFill(color, strength * 0.62);
              g.drawEllipse(cx, cy, radiusX * 1.18, radiusY * 1.22);
              g.endFill();
              g.beginFill(color, strength);
              g.drawEllipse(cx - radiusX * 0.08, cy - radiusY * 0.04, radiusX * 0.76, radiusY * 0.72);
              g.endFill();
              g.beginFill(highlight, strength * 0.34);
              g.drawEllipse(cx + radiusX * 0.32, cy - radiusY * 0.2, radiusX * 0.52, radiusY * 0.38);
              g.endFill();
            }
          }
          for (let index = 0; index < map.tiles.length; index++) {
            if (!exploredTiles.has(index)) continue;
            const visualTerrain = presentationTerrainAt(map.tiles, procBuildingUnderlay, index);
            const q = index % map.width;
            const r = Math.floor(index / map.width);
            const visible = visibleTiles.has(index);
            const geom = topGeomFor(q, r);
            const pos = toScreen({ q, r });
            const cx = pos.x + geom.center.x;
            const cy = pos.y - geom.avgHeight * ELEV_Y_OFFSET + geom.center.y;
            const fog = visible ? 1 : 0.45;
            const seed = tileNoise(q, r, 211);
            const detailDensity = terrainDetailDensity(q, r, visualTerrain);
            const fineDetailScale = externalTexturesAreColored ? 0.42 : 1;
            if (visualTerrain !== 'water' && tileNoise(q, r, 205) > 0.08) {
              const washColor =
                visualTerrain === 'road' || visualTerrain === 'urban'
                  ? 0x5b513f
                  : visualTerrain === 'forest'
                    ? 0x24401f
                    : visualTerrain === 'hill'
                      ? 0x6a7041
                      : 0x415536;
              const len = ISO_TILE_W * (0.12 + tileNoise(q, r, 206) * 0.18);
              const ox = (tileNoise(q, r, 208) - 0.5) * ISO_TILE_W * 0.58;
              const oy = (tileNoise(q, r, 209) - 0.5) * ISO_TILE_H * 0.52;
              const skew = (tileNoise(q, r, 207) - 0.5) * ISO_TILE_H * 0.16;
              g.lineStyle(1, visible ? washColor : memoryColor(washColor), fog * (0.04 + detailDensity * 0.035));
              g.moveTo(cx + ox - len / 2, cy + oy - skew);
              g.lineTo(cx + ox + len / 2, cy + oy + skew);
              g.lineStyle();
            }
            if (visualTerrain !== 'water' && seed > 0.18) {
              const color =
                visualTerrain === 'road' || visualTerrain === 'urban'
                  ? 0x5d503d
                  : visualTerrain === 'forest'
                    ? 0x23411f
                    : 0x394d2d;
              const len = ISO_TILE_W * (0.08 + tileNoise(q, r, 212) * 0.11);
              const ox = (tileNoise(q, r, 214) - 0.5) * ISO_TILE_W * 0.45;
              const oy = (tileNoise(q, r, 215) - 0.5) * ISO_TILE_H * 0.5;
              const skew = (tileNoise(q, r, 213) - 0.5) * ISO_TILE_H * 0.12;
              g.lineStyle(1, color, fog * (0.05 + detailDensity * 0.04));
              g.moveTo(cx + ox - len / 2, cy + oy - skew);
              g.lineTo(cx + ox + len / 2, cy + oy + skew);
              g.lineStyle();
            }
            if (visualTerrain !== 'water' && tileNoise(q, r, 221) > 0.34) {
              const len = ISO_TILE_W * (0.32 + tileNoise(q, r, 222) * 0.35);
              const ox = (tileNoise(q, r, 223) - 0.5) * ISO_TILE_W * 0.5;
              const oy = (tileNoise(q, r, 224) - 0.5) * ISO_TILE_H * 0.5;
              const skew = (tileNoise(q, r, 225) - 0.5) * ISO_TILE_H * 0.28;
              g.lineStyle(1, visualTerrain === 'road' ? 0x6e604c : 0x25361f, fog * 0.14);
              g.moveTo(cx + ox - len / 2, cy + oy - skew);
              g.lineTo(cx + ox + len / 2, cy + oy + skew);
              g.lineStyle();
            }
            if (visualTerrain === 'plain' || visualTerrain === 'forest' || visualTerrain === 'hill' || visualTerrain === 'swamp') {
              const clusters = Math.max(
                1,
                Math.round((visualTerrain === 'forest' ? 8 : 6) * detailDensity * fineDetailScale)
              );
              for (let i = 0; i < clusters; i++) {
                const salt = 260 + i * 17;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.58;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.58;
                const blade = 3 + tileNoise(q, r, salt + 2) * 4;
                const color = visualTerrain === 'forest'
                  ? (tileNoise(q, r, salt + 3) > 0.5 ? 0x102610 : 0x2f4c22)
                  : (tileNoise(q, r, salt + 3) > 0.5 ? 0x273820 : 0x4f6134);
                g.lineStyle(1.15, color, fog * 0.32);
                g.moveTo(cx + ox - blade, cy + oy + 1);
                g.lineTo(cx + ox + blade, cy + oy - 1);
                g.lineStyle();
              }
              if (tileNoise(q, r, 351) > 0.6) {
                const ox = (tileNoise(q, r, 352) - 0.5) * ISO_TILE_W * 0.5;
                const oy = (tileNoise(q, r, 353) - 0.5) * ISO_TILE_H * 0.46;
                const tuftColor = visualTerrain === 'swamp' ? 0x526548 : visualTerrain === 'hill' ? 0x6a6939 : 0x3d572c;
                g.lineStyle(1.1, 0x10170d, fog * 0.3);
                g.moveTo(cx + ox - 4, cy + oy + 2);
                g.lineTo(cx + ox + 4, cy + oy + 2);
                g.lineStyle(1.2, tuftColor, fog * 0.5);
                g.moveTo(cx + ox - 3, cy + oy + 1);
                g.lineTo(cx + ox - 1, cy + oy - 4);
                g.moveTo(cx + ox, cy + oy + 1);
                g.lineTo(cx + ox + 1, cy + oy - 5);
                g.moveTo(cx + ox + 3, cy + oy + 1);
                g.lineTo(cx + ox + 5, cy + oy - 3);
                g.lineStyle();
              }
              if (tileNoise(q, r, 361) > 0.86) {
                const ox = (tileNoise(q, r, 362) - 0.5) * ISO_TILE_W * 0.5;
                const oy = (tileNoise(q, r, 363) - 0.5) * ISO_TILE_H * 0.48;
                const stone = visualTerrain === 'hill' ? 0x726e52 : 0x4e5540;
                g.beginFill(0x11140e, fog * 0.22);
                g.drawEllipse(cx + ox + 1, cy + oy + 1.3, 3.4, 1.5);
                g.endFill();
                g.beginFill(stone, fog * 0.46);
                g.drawEllipse(cx + ox, cy + oy, 2.6, 1.3);
                g.drawEllipse(cx + ox + 2.8, cy + oy + 0.8, 1.4, 0.8);
                g.endFill();
              }
            }
            if (visualTerrain !== 'water') {
              const flecks = Math.max(
                2,
                Math.round(
                  (visualTerrain === 'urban' || visualTerrain === 'road' || visualTerrain === 'structure' ? 10 : 8)
                  * detailDensity
                  * fineDetailScale
                )
              );
              for (let i = 0; i < flecks; i++) {
                const salt = 390 + i * 23;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.62;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.6;
                const warm = visualTerrain === 'road' || visualTerrain === 'urban' || visualTerrain === 'structure';
                const fleckColor = warm
                  ? (tileNoise(q, r, salt + 2) > 0.46 ? 0x7b6b53 : 0x211b15)
                  : visualTerrain === 'forest'
                    ? (tileNoise(q, r, salt + 2) > 0.52 ? 0x405b2c : 0x0c180c)
                    : (tileNoise(q, r, salt + 2) > 0.52 ? 0x647142 : 0x182313);
                const alpha = fog * (0.13 + tileNoise(q, r, salt + 3) * 0.1);
                if (tileNoise(q, r, salt + 4) > 0.56) {
                  const len = 2 + tileNoise(q, r, salt + 5) * 5;
                  const lean = (tileNoise(q, r, salt + 6) - 0.5) * 3;
                  g.lineStyle(1, fleckColor, alpha);
                  g.moveTo(cx + ox - len * 0.5, cy + oy - lean * 0.5);
                  g.lineTo(cx + ox + len * 0.5, cy + oy + lean * 0.5);
                  g.lineStyle();
                } else {
                  g.beginFill(fleckColor, alpha);
                  g.drawRect(cx + ox, cy + oy, 1.4, 1.4);
                  g.endFill();
                }
              }
            }
            if (visualTerrain === 'road' || visualTerrain === 'urban') {
              const roadMarks = !externalTexturesAreColored && detailDensity > 0.66 ? 2 : 1;
              for (let i = 0; i < roadMarks; i++) {
                const salt = 520 + i * 19;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.34;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.32;
                const len = ISO_TILE_W * (0.22 + tileNoise(q, r, salt + 2) * 0.2);
                const skew = (tileNoise(q, r, salt + 3) - 0.5) * ISO_TILE_H * 0.18;
                g.lineStyle(1, visualTerrain === 'road' ? 0x9a8564 : 0x5e5a4e, fog * 0.26);
                g.moveTo(cx + ox - len * 0.5, cy + oy - skew);
                g.lineTo(cx + ox + len * 0.5, cy + oy + skew);
                g.lineStyle(1, 0x15110d, fog * 0.18);
                g.moveTo(cx + ox - len * 0.42, cy + oy + 3 - skew);
                g.lineTo(cx + ox + len * 0.42, cy + oy + 3 + skew);
                g.lineStyle();
              }
              if (tileNoise(q, r, 575) > 0.58) {
                const ox = (tileNoise(q, r, 576) - 0.5) * ISO_TILE_W * 0.42;
                const oy = (tileNoise(q, r, 577) - 0.5) * ISO_TILE_H * 0.38;
                g.beginFill(0x17130f, fog * 0.34);
                g.drawEllipse(cx + ox, cy + oy, 5 + tileNoise(q, r, 578) * 3, 1.6 + tileNoise(q, r, 579) * 1.2);
                g.endFill();
                g.lineStyle(0.9, 0x9b8665, fog * 0.28);
                g.moveTo(cx + ox - 3, cy + oy - 1);
                g.lineTo(cx + ox + 2, cy + oy);
                g.lineStyle();
              }
            }
            if (visualTerrain === 'water') {
              const ripples = externalTexturesAreColored ? 1 : Math.max(1, Math.round(1 + detailDensity));
              for (let i = 0; i < ripples; i++) {
                const salt = 230 + i * 17;
                const len = ISO_TILE_W * (0.22 + tileNoise(q, r, salt + 2) * 0.22);
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.42;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.42;
                g.lineStyle(1.15, 0x8fc0c5, fog * (0.2 + tileNoise(q, r, salt + 3) * 0.16));
                g.moveTo(cx + ox - len / 2, cy + oy);
                g.lineTo(cx + ox + len / 2, cy + oy - 1);
                g.lineStyle(2.1, 0x0b2938, fog * 0.2);
                g.moveTo(cx + ox - len / 3, cy + oy + 4);
                g.lineTo(cx + ox + len / 3, cy + oy + 3);
                g.lineStyle();
              }
            }
          }
        }}
      />
    );
  }, [
    exploredTiles,
    externalTexturesAreColored,
    map.height,
    map.tiles,
    map.width,
    procBuildingUnderlay,
    topGeomFor,
    visibleTiles
  ]);
  const terrainMissingTexts = useMemo(() => {
    if (!allowExternalTextures) return null;
    if (!missingTerrainPng || missingTerrainPng.size === 0) return null;
    const labels: JSX.Element[] = [];
    for (let index = 0; index < map.tiles.length; index++) {
      const tile = map.tiles[index];
      const terrainName: string = tile.terrain ?? 'plain';
      if (terrainName === 'structure' && coveredByProcBuilding.has(index)) continue;
      if (!missingTerrainPng.has(`${terrainName}.png`)) continue;
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = toScreen({ q, r });
      const corners = snappedCorners.getCorners(q, r);
      const avgHeight = averageCornerHeight(corners);
      const P = makeCornerPoints(corners, avgHeight);
      const cx = (P.NW.x + P.NE.x + P.SE.x + P.SW.x) / 4;
      const cy = (P.NW.y + P.NE.y + P.SE.y + P.SW.y) / 4;
      labels.push(
        <Text
          key={`missing-tex-${index}`}
          text={`${terrainName}.png`}
          x={pos.x + cx}
          y={pos.y - avgHeight * ELEV_Y_OFFSET + cy}
          anchor={0.5}
          style={missingLabelStyle}
        />
      );
    }
    return labels;
  }, [allowExternalTextures, coveredByProcBuilding, map.tiles, map.width, missingTerrainPng, snappedCorners]);
  // Local helper to keep UI overlays consistent with core movement rules
  const uiCanEnter = (unitType: UnitInstance['unitType'], tile: { terrain: string; passable: boolean }) => {
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
    if (!plannedDestination && (!plannedPath || plannedPath.length === 0)) return null;
    if (!selectedUnitId) return null;

    // find selected unit in state
    let selected: UnitInstance | undefined;
    for (const side of Object.values(battleState.sides)) {
      const u = side.units.get(selectedUnitId);
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
    for (const side of Object.values(battleState.sides)) {
      for (const other of side.units.values()) {
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
    const tileAt = (q: number, r: number) => inBounds(q, r) ? map.tiles[r * map.width + q] : undefined;

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
      const geom = ISO_MODE ? topGeomFor(q, r) : null;
      const elev = map.tiles[idx].elevation ?? 0;
      const avgHeight = ISO_MODE ? geom!.avgHeight : elev;
      const x = p.x;
      const y = p.y - avgHeight * ELEV_Y_OFFSET;
      const leftAP = Math.max(0, apBudget - cost);
      const canShoot = (() => {
        try { return canAffordAttack({ ...selected, actionPoints: Math.floor(leftAP) }); }
        catch { return leftAP >= 2; }
      })();

      elements.push(
        <Graphics
          key={`mv-${q}-${r}`}
          x={x}
          y={y}
          draw={(g) => {
            g.clear();
                  const mvAlpha = externalTexturesAreColored ? (canShoot ? 0.045 : 0.035) : (canShoot ? 0.11 : 0.085);
            if (ISO_MODE && geom) {
              const shape = geom.inset(0.92);
              g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, mvAlpha);
              drawPoly(g as PixiGraphics, shape);
              g.endFill();

              g.lineStyle(1, canShoot ? 0x87b6bc : 0x5d7f84, canShoot ? 0.18 : 0.12);
              drawPoly(g as PixiGraphics, shape);

              const edgeDirs = [
                { dq: 0, dr: -1 },
                { dq: 1, dr: 0 },
                { dq: 0, dr: 1 },
                { dq: -1, dr: 0 }
              ];
              const edges: Array<[number, number]> = [
                [0, 1],
                [1, 2],
                [2, 3],
                [3, 0]
              ];
              g.lineStyle(1, canShoot ? 0x87b6bc : 0x5d7f84, canShoot ? 0.22 : 0.14);
              edges.forEach(([aIdx, bIdx], edgeIndex) => {
                const d = edgeDirs[edgeIndex];
                const nkey = `${q + d.dq},${r + d.dr}`;
                if (!best.has(nkey)) {
                  g.moveTo(shape[aIdx].x, shape[aIdx].y);
                  g.lineTo(shape[bIdx].x, shape[bIdx].y);
                }
              });
            } else {
              const s = (tileSize / 2) * 0.92; const hw = (hexWidth / 2) * 0.92;
              const pts = [
                { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
                { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
              ];
              g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, mvAlpha);
              g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath(); g.endFill();

              g.lineStyle(1, canShoot ? 0x87b6bc : 0x5d7f84, canShoot ? 0.18 : 0.12);
              g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath();

              g.lineStyle(1, canShoot ? 0x87b6bc : 0x5d7f84, canShoot ? 0.22 : 0.14);
              for (let ei = 0; ei < dirs.length; ei++) {
                if (ei >= pts.length) break;
                const d = dirs[ei];
                const nkey = `${q + d.dq},${r + d.dr}`;
                if (!best.has(nkey)) {
                  const a = pts[ei];
                  const b = pts[(ei + 1) % pts.length];
                  if (!a || !b) continue;
                  g.moveTo(a.x, a.y);
                  g.lineTo(b.x, b.y);
                }
              }
            }

          }}
        />
      );
    });

    // Do not draw highlight on the origin tile to avoid clutter

    return elements.filter((el) => el.key !== `mv-${start.q}-${start.r}`);
  }, [battleState.sides, selectedUnitId, viewerFaction, map.tiles, map.width, map.height, visibleTiles, externalTexturesAreColored, topGeomFor, plannedDestination, plannedPath]);

  const globalRangeOverlays = useMemo(() => {
    if (!rangeOverlayCoords || rangeOverlayCoords.size === 0) return null;

    const edgeDirs = [
      { dq: 0, dr: -1 },
      { dq: 1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: -1, dr: 0 }
    ];
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0]
    ];

    const overlays: Array<{
      q: number;
      r: number;
      isBlocked: boolean;
      origin: { x: number; y: number };
      shape: Array<{ x: number; y: number }>;
      screenShape: Array<{ x: number; y: number }>;
      style: ReturnType<typeof rangeOverlayStyle> | ReturnType<typeof blockedRangeOverlayStyle>;
    }> = [];

    rangeOverlayCoords.forEach((key) => {
      const [qStr, rStr] = key.split(',');
      const q = Number(qStr);
      const r = Number(rStr);
      if (!Number.isFinite(q) || !Number.isFinite(r)) return;
      if (q < 0 || r < 0 || q >= map.width || r >= map.height) return;
      const idx = r * map.width + q;
      if (!visibleTiles.has(idx)) return;

      const p = toScreen({ q, r });
      const geom = ISO_MODE ? topGeomFor(q, r) : null;
      const elev = map.tiles[idx].elevation ?? 0;
      const avgHeight = ISO_MODE && geom ? geom.avgHeight : elev;
      const isBlocked = blockedRangeOverlayCoords?.has(key) === true;
      const origin = {
        x: p.x,
        y: p.y - avgHeight * ELEV_Y_OFFSET
      };
      const s = (tileSize / 2) * 0.86;
      const hw = (hexWidth / 2) * 0.86;
      const shape = ISO_MODE && geom
        ? geom.inset(0.86)
        : [
            { x: 0, y: -s },
            { x: hw, y: -s / 2 },
            { x: hw, y: s / 2 },
            { x: 0, y: s },
            { x: -hw, y: s / 2 },
            { x: -hw, y: -s / 2 }
          ];

      overlays.push({
        q,
        r,
        isBlocked,
        origin,
        shape,
        screenShape: shape.map((point) => ({
          x: origin.x + point.x,
          y: origin.y + point.y
        })),
        style: isBlocked
          ? blockedRangeOverlayStyle(externalTexturesAreColored)
          : rangeOverlayStyle(externalTexturesAreColored)
      });
    });

    return (
      <Graphics
        key="global-range-overlay"
        draw={(g) => {
          g.clear();

          const overlaysFor = (isBlocked: boolean) => (
            overlays.filter((overlay) => overlay.isBlocked === isBlocked)
          );
          // Styles are uniform per blocked class; split these batches if style gains a per-tile input.
          const drawFills = (isBlocked: boolean) => {
            const matchingOverlays = overlaysFor(isBlocked);
            const style = matchingOverlays[0]?.style;
            if (!style) return;
            g.lineStyle(0, 0, 0);
            g.beginFill(style.fill, style.fillAlpha);
            matchingOverlays.forEach((overlay) => {
              drawPoly(g as PixiGraphics, overlay.screenShape);
            });
            g.endFill();
          };

          drawFills(false);
          drawFills(true);

          if (!ISO_MODE) {
            [false, true].forEach((isBlocked) => {
              const matchingOverlays = overlaysFor(isBlocked);
              const style = matchingOverlays[0]?.style;
              if (!style) return;
              g.lineStyle(2.2, style.shadow, style.shadowAlpha);
              matchingOverlays.forEach((overlay) => {
                drawPoly(g as PixiGraphics, overlay.screenShape);
              });
              g.lineStyle(1.05, style.edge, style.edgeAlpha);
              matchingOverlays.forEach((overlay) => {
                drawPoly(g as PixiGraphics, overlay.screenShape);
              });
            });
            return;
          }

          const drawIsoEdges = (isBlocked: boolean, shadow: boolean) => {
            const matchingOverlays = overlaysFor(isBlocked);
            const style = matchingOverlays[0]?.style;
            if (!style) return;
            g.lineStyle(
              shadow ? 2.4 : 1.15,
              shadow ? style.shadow : style.edge,
              shadow ? style.shadowAlpha : style.edgeAlpha
            );
            matchingOverlays.forEach(({ q, r, screenShape }) => {
              const matchesNeighbor = (dq: number, dr: number) => {
                const neighborKey = `${q + dq},${r + dr}`;
                return rangeOverlayCoords.has(neighborKey) &&
                  (blockedRangeOverlayCoords?.has(neighborKey) === true) === isBlocked;
              };
              edges.forEach(([aIdx, bIdx], edgeIndex) => {
                const d = edgeDirs[edgeIndex];
                if (matchesNeighbor(d.dq, d.dr)) return;
                g.moveTo(screenShape[aIdx].x, screenShape[aIdx].y);
                g.lineTo(screenShape[bIdx].x, screenShape[bIdx].y);
              });
            });
          };

          drawIsoEdges(false, true);
          drawIsoEdges(true, true);
          drawIsoEdges(false, false);
          drawIsoEdges(true, false);

          g.lineStyle(0.9, 0xffbd84, 0.52);
          overlaysFor(true).forEach(({ origin, shape }) => {
            g.moveTo(origin.x + shape[3].x * 0.58, origin.y + shape[3].y * 0.58);
            g.lineTo(origin.x + shape[1].x * 0.58, origin.y + shape[1].y * 0.58);
            g.moveTo(origin.x + shape[0].x * 0.42, origin.y + shape[0].y * 0.42);
            g.lineTo(origin.x + shape[2].x * 0.42, origin.y + shape[2].y * 0.42);
          });

          g.lineStyle(0.8, 0xe8e0a1, 0.42);
          overlaysFor(false).forEach(({ q, r, origin, shape }) => {
            if ((q * 7 + r * 11) % 3 === 0) {
              g.moveTo(origin.x + shape[3].x * 0.36, origin.y + shape[3].y * 0.36);
              g.lineTo(origin.x + shape[1].x * 0.56, origin.y + shape[1].y * 0.56);
            }
          });
        }}
      />
    );
  }, [rangeOverlayCoords, blockedRangeOverlayCoords, map.width, map.height, map.tiles, visibleTiles, externalTexturesAreColored, topGeomFor]);

  const attackRangeOverlays = useMemo(() => {
    if (!showAttackOverlay || !selectedUnitId) return null;

    // find selected unit
    let selected: UnitInstance | undefined;
    for (const side of Object.values(battleState.sides)) {
      const u = side.units.get(selectedUnitId);
      if (u) { selected = u; break; }
    }
    if (!selected) return null;
    if (viewerFaction && selected.faction !== viewerFaction) return null;

    const ranges = Object.keys(selected.stats.weaponRanges ?? {});
    const weaponId = ranges[0];
    const maxRange: number = weaponId ? calculateAttackRange(selected, weaponId, battleState.map) : 0;
    if (!maxRange || maxRange <= 0) return null;

    const start = selected.coordinate as { q: number; r: number };

    const inRange = new Set<string>();
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const d = ISO_MODE ? Math.max(Math.abs(start.q - q), Math.abs(start.r - r)) : axialDistance(start, { q, r });
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
      const geom = ISO_MODE ? topGeomFor(q, r) : null;
      const elev = map.tiles[idx].elevation ?? 0;
      const avgHeight = ISO_MODE ? geom!.avgHeight : elev;
      const x = p.x;
      const y = p.y - avgHeight * ELEV_Y_OFFSET;

      elements.push(
        <Graphics key={`atk-${q}-${r}`} x={x} y={y} draw={(g) => {
          g.clear();
          const atkAlpha = externalTexturesAreColored ? 0.08 : 0.12;
          if (ISO_MODE && geom) {
            const shape = geom.inset(0.92);
            g.beginFill(0xffa726, atkAlpha);
            drawPoly(g as PixiGraphics, shape);
            g.endFill();
            g.lineStyle(1, 0xffc107, 0.75);
            const edgeDirs = [
              { dq: 0, dr: -1 },
              { dq: 1, dr: 0 },
              { dq: 0, dr: 1 },
              { dq: -1, dr: 0 }
            ];
            const edges: Array<[number, number]> = [
              [0, 1],
              [1, 2],
              [2, 3],
              [3, 0]
            ];
            edges.forEach(([aIdx, bIdx], edgeIndex) => {
              const d = edgeDirs[edgeIndex];
              const nkey = `${q + d.dq},${r + d.dr}`;
              if (!inRange.has(nkey)) {
                g.moveTo(shape[aIdx].x, shape[aIdx].y);
                g.lineTo(shape[bIdx].x, shape[bIdx].y);
              }
            });
          } else {
            const s = (tileSize / 2) * 0.92; const hw = (hexWidth / 2) * 0.92;
            const pts = [
              { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
              { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
            ];
            g.beginFill(0xffa726, atkAlpha);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();
            g.endFill();
            g.lineStyle(1, 0xffc107, 0.75);
            for (let ei = 0; ei < dirs.length; ei++) {
              if (ei >= pts.length) break;
              const d = dirs[ei];
              const nkey = `${q + d.dq},${r + d.dr}`;
              if (!inRange.has(nkey)) {
                const a = pts[ei];
                const b = pts[(ei + 1) % pts.length];
                if (!a || !b) continue;
                g.moveTo(a.x, a.y);
                g.lineTo(b.x, b.y);
              }
            }
          }
        }} />
      );
    });

    // don't draw over origin to keep selection ring readable
    return elements.filter((el) => el.key !== `atk-${start.q}-${start.r}`);
  }, [showAttackOverlay, battleState.map, battleState.sides, selectedUnitId, viewerFaction, map.tiles, map.width, map.height, visibleTiles, externalTexturesAreColored, topGeomFor]);





  const plannedHighlights = useMemo(() => {
    if ((!plannedPath || plannedPath.length === 0) && !plannedDestination) {
      return null;
    }

    const steps: HexCoordinate[] = [...(plannedPath ?? [])];
    if (
      plannedDestination &&
      !steps.some((s) => s.q === plannedDestination.q && s.r === plannedDestination.r)
    ) {
      steps.push(plannedDestination);
    }

    const elements: JSX.Element[] = [];

    // Classic path outline (polyline)
    if (steps.length >= 2) {
      elements.push(
        <Graphics
          key="path-polyline"
          draw={(g) => {
            g.clear();
            g.lineStyle(2.4, 0x07110d, 0.5);
            for (let i = 0; i < steps.length - 1; i++) {
              const a = steps[i];
              const b = steps[i + 1];
              const idxA = a.r * map.width + a.q;
              const idxB = b.r * map.width + b.q;
              if (!visibleTiles.has(idxA) || !visibleTiles.has(idxB)) continue;
              const pa0 = toScreen(a);
              const pb0 = toScreen(b);
              const geomA = topGeomFor(a.q, a.r);
              const geomB = topGeomFor(b.q, b.r);
              const pa = { x: pa0.x, y: pa0.y - geomA.avgHeight * ELEV_Y_OFFSET };
              const pb = { x: pb0.x, y: pb0.y - geomB.avgHeight * ELEV_Y_OFFSET };
              g.moveTo(pa.x, pa.y);
              g.lineTo(pb.x, pb.y);
            }
            g.lineStyle(1.1, 0xa7dcc7, 0.82);
            for (let i = 0; i < steps.length - 1; i++) {
              const a = steps[i];
              const b = steps[i + 1];
              const idxA = a.r * map.width + a.q;
              const idxB = b.r * map.width + b.q;
              if (!visibleTiles.has(idxA) || !visibleTiles.has(idxB)) continue;
              const pa0 = toScreen(a);
              const pb0 = toScreen(b);
              const geomA = topGeomFor(a.q, a.r);
              const geomB = topGeomFor(b.q, b.r);
              const pa = { x: pa0.x, y: pa0.y - geomA.avgHeight * ELEV_Y_OFFSET };
              const pb = { x: pb0.x, y: pb0.y - geomB.avgHeight * ELEV_Y_OFFSET };
              g.moveTo(pa.x, pa.y);
              g.lineTo(pb.x, pb.y);
            }
            for (let i = 1; i < steps.length; i++) {
              const step = steps[i];
              const idx = step.r * map.width + step.q;
              if (!visibleTiles.has(idx)) continue;
              const p0 = toScreen(step);
              const geom = topGeomFor(step.q, step.r);
              const p = { x: p0.x, y: p0.y - geom.avgHeight * ELEV_Y_OFFSET };
              const radius = i === steps.length - 1 ? 2.6 : 1.7;
              g.beginFill(0xc7f2df, i === steps.length - 1 ? 0.7 : 0.45);
              g.lineStyle(0.8, 0x092019, 0.42);
              g.drawCircle(p.x, p.y, radius);
              g.endFill();
            }
          }}
        />
      );
    }

    // Destination hex ring (classic)
    if (plannedDestination) {
      const dest = plannedDestination;
      const idx = dest.r * map.width + dest.q;
      if (visibleTiles.has(idx)) {
        const p = toScreen(dest);
        const geom = topGeomFor(dest.q, dest.r);
        const x = p.x;
        const y = p.y - geom.avgHeight * ELEV_Y_OFFSET;
        elements.push(
          <Graphics
            key="dest-ring"
            x={x}
            y={y}
            draw={(g) => {
              g.clear();
              if (ISO_MODE) {
                const ring = geom.inset(0.9);
                g.lineStyle(2, 0xffc107, 0.95);
                drawPoly(g as PixiGraphics, ring);
                const inner = geom.inset(0.84);
                g.lineStyle(1, 0x5a3c00, 0.35);
                drawPoly(g as PixiGraphics, inner);
              } else {
                const s = (tileSize / 2) * 0.96;
                const hw = (hexWidth / 2) * 0.96;
                const pts = [
                  { x: 0, y: -s },
                  { x: hw, y: -s / 2 },
                  { x: hw, y: s / 2 },
                  { x: 0, y: s },
                  { x: -hw, y: s / 2 },
                  { x: -hw, y: -s / 2 }
                ];
                g.lineStyle(2, 0xffc107, 0.95);
                drawPoly(g as unknown as PixiGraphics, pts);
              }
            }}
          />
        );
      }
    }

    // Tiles along the route where the unit would take enemy reaction fire — flag them red so the
    // player can see the danger before committing the move.
    if (threatenedTiles && threatenedTiles.length) {
      const threatSet = new Set(threatenedTiles);
      for (let i = 1; i < steps.length; i++) {
        const step = steps[i];
        if (!threatSet.has(`${step.q},${step.r}`)) continue;
        const idx = step.r * map.width + step.q;
        if (!visibleTiles.has(idx)) continue;
        const p0 = toScreen(step);
        const geom = topGeomFor(step.q, step.r);
        const x = p0.x;
        const y = p0.y - geom.avgHeight * ELEV_Y_OFFSET;
        elements.push(
          <Graphics
            key={`threat-${step.q}-${step.r}`}
            x={x}
            y={y}
            draw={(g) => {
              g.clear();
              const ring = geom.inset(0.82);
              g.beginFill(0xe0392b, 0.16);
              drawPoly(g as PixiGraphics, ring);
              g.endFill();
              g.lineStyle(1.6, 0xe0392b, 0.85);
              drawPoly(g as PixiGraphics, ring);
              g.lineStyle(1.2, 0xffd2cc, 0.8);
              g.moveTo(-3.4, 0); g.lineTo(3.4, 0);
              g.moveTo(0, -3.4); g.lineTo(0, 3.4);
            }}
          />
        );
      }
    }

    return elements;
  }, [map.width, plannedDestination, plannedPath, threatenedTiles, visibleTiles, topGeomFor]);

  const invalidMoveHighlight = useMemo(() => {
    if (!invalidMoveFeedback) return null;
    const elapsed = now - invalidMoveFeedback.time;
    const duration = 1800;
    if (elapsed < 0 || elapsed > duration) return null;
    const coord = invalidMoveFeedback.coordinate;
    if (coord.q < 0 || coord.r < 0 || coord.q >= map.width || coord.r >= map.height) return null;

    const p = toScreen(coord);
    const geom = topGeomFor(coord.q, coord.r);
    const pulse = 1 - elapsed / duration;
    const markerScale = 0.88 + (1 - pulse) * 0.12;
    const alpha = 0.24 + pulse * 0.42;
    const x = p.x;
    const y = p.y - geom.avgHeight * ELEV_Y_OFFSET;

    const feedbackLabel = invalidMoveFeedback.message ?? t('battle:reject.moveBlocked');

    return (
      <Container key={`invalid-move-${invalidMoveFeedback.time}`} zIndex={60000} x={x} y={y}>
        <Graphics
          draw={(g) => {
            g.clear();
            // Clean "no-entry" glyph lying on the ground plane (iso ellipse + diagonal slash),
            // with a dark halo so it reads on any terrain — replaces the old crossed-beams look.
            const drawBlockedGlyph = () => {
              const gr = tileSize * 0.17;
              const grY = gr * 0.5;
              const sl = 0.66;
              g.lineStyle(3, 0x1a0604, Math.min(0.5, alpha));
              g.drawEllipse(0, 0, gr, grY);
              g.moveTo(-gr * sl, -grY * sl); g.lineTo(gr * sl, grY * sl);
              g.lineStyle(1.5, 0xff7259, Math.min(0.82, alpha + 0.2));
              g.drawEllipse(0, 0, gr, grY);
              g.moveTo(-gr * sl, -grY * sl); g.lineTo(gr * sl, grY * sl);
            };

            if (ISO_MODE) {
              const ring = geom.inset(markerScale);
              g.beginFill(0x7a1a12, alpha * 0.1);
              drawPoly(g as PixiGraphics, ring);
              g.endFill();
              // dark base stroke gives the crisp red rim something to anti-alias against
              g.lineStyle(3, 0x1a0605, alpha * 0.5);
              drawPoly(g as PixiGraphics, ring);
              g.lineStyle(1.4, 0xff6f54, Math.min(0.8, alpha + 0.14));
              drawPoly(g as PixiGraphics, ring);
              drawBlockedGlyph();
            } else {
              const s = (tileSize / 2) * markerScale;
              const hw = (hexWidth / 2) * markerScale;
              const pts = [
                { x: 0, y: -s },
                { x: hw, y: -s / 2 },
                { x: hw, y: s / 2 },
                { x: 0, y: s },
                { x: -hw, y: s / 2 },
                { x: -hw, y: -s / 2 }
              ];
              g.beginFill(0x7a1a12, alpha * 0.1);
              drawPoly(g as PixiGraphics, pts);
              g.endFill();
              g.lineStyle(3, 0x1a0605, alpha * 0.5);
              drawPoly(g as PixiGraphics, pts);
              g.lineStyle(1.4, 0xff6f54, Math.min(0.8, alpha + 0.14));
              drawPoly(g as PixiGraphics, pts);
              drawBlockedGlyph();
            }
          }}
        />
        {/* Counter-scale the label so it stays a fixed on-screen size and renders crisp
            (net scale ≈ 1) regardless of camera zoom; the tile marker above stays world-space. */}
        <Container y={-tileSize * 0.78} scale={1 / scale}>
          <Graphics
            draw={(g) => {
              g.clear();
              const labelFs = 14;
              const labelW = Math.max(108, feedbackLabel.length * labelFs * 0.6 + 34);
              const labelH = labelFs + 12;
              const x0 = -labelW / 2, y0 = -labelH / 2, rad = 7;
              const plateAlpha = Math.min(0.92, 0.6 + pulse * 0.36);
              // soft drop shadow
              g.beginFill(0x000000, plateAlpha * 0.42);
              g.drawRoundedRect(x0 - 1, y0 + 2.5, labelW + 2, labelH + 1, rad + 1);
              g.endFill();
              // body
              g.beginFill(0x14181b, plateAlpha);
              g.drawRoundedRect(x0, y0, labelW, labelH, rad);
              g.endFill();
              // inner top bevel highlight + bottom shade for a subtle 3D plate
              g.lineStyle(1, 0x3c474d, plateAlpha * 0.5);
              g.moveTo(x0 + rad, y0 + 1); g.lineTo(x0 + labelW - rad, y0 + 1);
              g.lineStyle(1, 0x05080a, plateAlpha * 0.5);
              g.moveTo(x0 + rad, y0 + labelH - 1); g.lineTo(x0 + labelW - rad, y0 + labelH - 1);
              // warm amber border
              g.lineStyle(1.2, 0xe8a24a, Math.min(0.82, 0.4 + pulse * 0.4));
              g.drawRoundedRect(x0, y0, labelW, labelH, rad);
              // warning glyph (amber triangle + exclamation) tucked into the left padding
              const gx = x0 + 13;
              g.lineStyle(0);
              g.beginFill(0xffc24a, Math.min(0.96, 0.62 + pulse * 0.34));
              g.moveTo(gx, -5.4); g.lineTo(gx + 4.8, 4.2); g.lineTo(gx - 4.8, 4.2); g.closePath();
              g.endFill();
              g.beginFill(0x14181b, 0.96);
              g.drawRect(gx - 0.7, -1.8, 1.4, 3.1);
              g.drawRect(gx - 0.7, 2.4, 1.4, 1.3);
              g.endFill();
            }}
          />
          <Text
            text={feedbackLabel}
            x={6}
            y={0}
            anchor={{ x: 0.5, y: 0.5 }}
            resolution={2}
            alpha={Math.min(0.98, 0.6 + pulse * 0.4)}
            style={invalidMoveLabelStyle}
          />
        </Container>
      </Container>
    );
  }, [invalidMoveFeedback, map.height, map.width, now, topGeomFor, scale, t]);

  // Elevation walls drawn above overlays for correct occlusion
  const tileWalls = useMemo(() => {
    if (!ISO_MODE) return null;
    const EDGE_KEYS: EdgeKey[] = ['N', 'E', 'S', 'W'];
    const EDGE_VECTORS: Record<EdgeKey, { dq: number; dr: number }> = {
      N: { dq: 0, dr: -1 },
      E: { dq: +1, dr: 0 },
      S: { dq: 0, dr: +1 },
      W: { dq: -1, dr: 0 }
    };
    const idxAt = (qq: number, rr: number) => rr * map.width + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;

    return map.tiles
      .map((_, index) => {
        const q = index % map.width;
        const r = Math.floor(index / map.width);
        const pos = toScreen({ q, r });
        const isVisible = visibleTiles.has(index);
        const isExplored = exploredTiles.has(index);
        if (!isExplored || !isVisible) return null;
        const corners = snappedCorners.getCorners(q, r);
        const avgHeight = averageCornerHeight(corners);
        const cornerPoints = makeCornerPoints(corners, avgHeight);
        const cornerHeights: Record<CornerKey, number> = {
          NW: corners.hNW,
          NE: corners.hNE,
          SE: corners.hSE,
          SW: corners.hSW
        };
        const visualTerrain = presentationTerrainAt(map.tiles, procBuildingUnderlay, index);
        const baseColor = terrainPalette[visualTerrain] ?? terrainPalette.plain;

        return (
          <Graphics
            key={`walls-${index}`}
            x={pos.x}
            y={pos.y - avgHeight * ELEV_Y_OFFSET}
            draw={(g) => {
              g.clear();
              EDGE_KEYS.forEach((edge) => {
                const vec = EDGE_VECTORS[edge];
                const nq = q + vec.dq;
                const nr = r + vec.dr;
                const neighborIdx = inb(nq, nr) ? idxAt(nq, nr) : -1;
                const neighbor = neighborIdx >= 0 ? map.tiles[neighborIdx] : null;
                const neighborCorners = neighbor ? snappedCorners.getCorners(nq, nr) : null;
                const neighborHeights: Record<CornerKey, number> | null = neighborCorners
                  ? {
                      NW: neighborCorners.hNW,
                      NE: neighborCorners.hNE,
                      SE: neighborCorners.hSE,
                      SW: neighborCorners.hSW
                    }
                  : null;
                const oppEdge = OPP_EDGE[edge];
                const [myA, myB] = EDGE_TO_CORNERS[edge];
                const [oppA, oppB] = EDGE_TO_CORNERS[oppEdge];
                const myAvg = (cornerHeights[myA] + cornerHeights[myB]) / 2;
                const neighborAvg = neighborHeights
                  ? (neighborHeights[oppA] + neighborHeights[oppB]) / 2
                  : 0;
                const delta = myAvg - neighborAvg;
                if (delta < 2) return;
                const topA = cornerPoints[myA];
                const topB = cornerPoints[myB];
                const depth = delta * CLIFF_DEPTH;
                const bottomA = { x: topA.x, y: topA.y + depth };
                const bottomB = { x: topB.x, y: topB.y + depth };
                const wallColor = darkenColor(baseColor, edge === 'E' ? 0.35 : edge === 'S' ? 0.45 : 0.4);
                g.beginFill(wallColor, 0.92);
                g.moveTo(topA.x, topA.y);
                g.lineTo(topB.x, topB.y);
                g.lineTo(bottomB.x, bottomB.y);
                g.lineTo(bottomA.x, bottomA.y);
                g.closePath();
                g.endFill();
                g.lineStyle(1, 0x000000, 0.25);
                g.moveTo(bottomA.x, bottomA.y);
                g.lineTo(bottomB.x, bottomB.y);
                g.lineStyle();
              });
            }}
          />
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [
    exploredTiles,
    map.height,
    map.tiles,
    map.width,
    procBuildingUnderlay,
    snappedCorners,
    visibleTiles
  ]);


  const propTextureCache = useMemo(() => new Map<string, Texture>(), []);
  const unitTextureCache = useMemo(() => new Map<string, Texture>(), []);
  const propAtlasTextures = useMemo(getPropAtlasTextures, []);

  useEffect(() => {
    for (const direction of UNIT_SHEET_DIRECTIONS) {
      const path = lightInfantryIdlePath(direction);
      if (!unitTextureCache.has(path)) {
        unitTextureCache.set(path, crispTexture(Texture.from(path)));
      }
    }
  }, [unitTextureCache]);


  const deathMarkerSprites = useMemo(() => {
    if (deathMarkers.size === 0) return null;
    const els: JSX.Element[] = [];
    deathMarkers.forEach((m) => {
      const idx = m.r * map.width + m.q;
      const isFriendly = m.faction === viewerFaction;
      const isVisible = visibleTiles.has(idx);
      const isExplored = exploredTiles.has(idx);
      if (!isFriendly && !isVisible && !isExplored) return;
      const visibilityAlpha = isFriendly || isVisible ? 1 : 0.82;
      const mechanicalWreck = leavesMechanicalWreck(m.unitType, m.definitionId);
      const markerVisualClass = deathMarkerVisualClass(m.unitType, m.definitionId);
      const markerTransform = deathMarkerSpriteTransform(markerVisualClass);
      const boundKillingEffect = m.killingEffectId
        ? attackEffects.find((effect) => effect.id === m.killingEffectId)
        : undefined;
      const activeKillingEffect = boundKillingEffect
        && now - boundKillingEffect.startTime <= combatEffectTiming(boundKillingEffect.type, boundKillingEffect.arc).totalMs
        ? boundKillingEffect
        : m.killingEffectId
          ? undefined
          : activeKillingEffectForTarget(attackEffects, m.id, now);
      const hitInFlight = Boolean(activeKillingEffect && deathReactionAlpha(
        now
          - activeKillingEffect.startTime
          - combatEffectTiming(activeKillingEffect.type, activeKillingEffect.arc).impactAtMs
      ) > 0);
      // Mechanical wrecks appear at impact. Organic corpses wait until the live death animation ends,
      // and future-dated reaction shots keep both marker types hidden while the victim is still moving.
      if (!deathMarkerVisible(activeKillingEffect, mechanicalWreck, now)) return;

      const p = toScreen({ q: m.q, r: m.r });
      const tile = map.tiles[idx];
      const elev = tile?.elevation ?? 0;
      const geom = ISO_MODE ? topGeomFor(m.q, m.r) : null;
      const baseHeight = ISO_MODE && geom ? geom.avgHeight : elev;
      const x = Math.round(p.x);
      const y = Math.round(p.y - baseHeight * ELEV_Y_OFFSET);
      const z = Math.round(y) + (m.id === selectedUnitId ? 5000 : 0);

      const elapsed = activeKillingEffect
        ? Math.max(0, now - activeKillingEffect.startTime - combatEffectTiming(activeKillingEffect.type, activeKillingEffect.arc).impactAtMs)
        : now - m.t;
      if (!mechanicalWreck && elapsed >= CORPSE_TTL_MS) return;
      const fade = deathMarkerFade(elapsed, mechanicalWreck);
      const corpseTexturePath = rasterUnitOverride(m.definitionId);
      let corpseTexture: Texture | null = null;
      if (corpseTexturePath) {
        corpseTexture = unitTextureCache.get(corpseTexturePath) ?? null;
        if (!corpseTexture) {
          corpseTexture = crispTexture(Texture.from(corpseTexturePath));
          unitTextureCache.set(corpseTexturePath, corpseTexture);
        }
      }

      els.push(
        <Container key={`dead-${m.id}`} x={x} y={y} alpha={fade * visibilityAlpha} zIndex={z} sortableChildren>
          <Graphics
            zIndex={0}
            draw={(g) => {
              g.clear();
              g.beginFill(0x000000, 0.20 + 0.25 * fade);
              g.drawEllipse(0, tileSize * 0.045, tileSize * (mechanicalWreck ? 0.32 : 0.26), tileSize * (mechanicalWreck ? 0.11 : 0.08));
              g.endFill();
              if (mechanicalWreck) {
                g.beginFill(0x17150f, 0.72 * fade);
                g.drawEllipse(tileSize * 0.015, tileSize * 0.052, tileSize * 0.37, tileSize * 0.115);
                g.endFill();
                g.lineStyle(1.1, 0x5d4e37, 0.36 * fade);
                g.drawEllipse(tileSize * 0.015, tileSize * 0.052, tileSize * 0.34, tileSize * 0.095);
                g.lineStyle();
                if (!hitInFlight && !corpseTexture) {
                  const facing = orientationScreenVector(m.orientation);
                  if (markerVisualClass === 'air') {
                    g.beginFill(0x302f2b, 0.96 * fade);
                    g.drawPolygon([
                      -tileSize * 0.32, tileSize * 0.02,
                      -tileSize * 0.12, -tileSize * 0.075,
                      -tileSize * 0.02, -tileSize * 0.04,
                      tileSize * 0.24, -tileSize * 0.11,
                      tileSize * 0.31, -tileSize * 0.035,
                      tileSize * 0.09, tileSize * 0.045,
                      tileSize * 0.2, tileSize * 0.11,
                      -tileSize * 0.05, tileSize * 0.075,
                      -tileSize * 0.25, tileSize * 0.115
                    ]);
                    g.endFill();
                    g.beginFill(0x11100d, 0.82 * fade);
                    g.drawEllipse(-tileSize * 0.17, tileSize * 0.065, tileSize * 0.08, tileSize * 0.035);
                    g.drawEllipse(tileSize * 0.13, -tileSize * 0.015, tileSize * 0.06, tileSize * 0.03);
                    g.endFill();
                  } else if (markerVisualClass === 'structure') {
                    g.beginFill(0x30271f, 0.96 * fade);
                    g.drawPolygon([
                      -tileSize * 0.3, tileSize * 0.09,
                      -tileSize * 0.22, -tileSize * 0.08,
                      -tileSize * 0.05, -tileSize * 0.03,
                      tileSize * 0.08, -tileSize * 0.14,
                      tileSize * 0.29, -tileSize * 0.055,
                      tileSize * 0.22, tileSize * 0.1,
                      -tileSize * 0.08, tileSize * 0.13
                    ]);
                    g.endFill();
                    g.lineStyle(4.2, 0x17110c, 0.9 * fade);
                    g.moveTo(-tileSize * 0.29, tileSize * 0.105);
                    g.lineTo(tileSize * 0.24, -tileSize * 0.115);
                    g.moveTo(-tileSize * 0.22, -tileSize * 0.105);
                    g.lineTo(tileSize * 0.26, tileSize * 0.09);
                    g.lineStyle(1.1, 0x75614b, 0.62 * fade);
                    g.moveTo(-tileSize * 0.26, tileSize * 0.085);
                    g.lineTo(tileSize * 0.21, -tileSize * 0.105);
                  } else if (markerVisualClass === 'artillery') {
                    g.beginFill(0x302f2a, 0.96 * fade);
                    g.drawPolygon([
                      -tileSize * 0.27, tileSize * 0.04,
                      -tileSize * 0.15, -tileSize * 0.1,
                      tileSize * 0.2, -tileSize * 0.075,
                      tileSize * 0.29, tileSize * 0.055,
                      tileSize * 0.08, tileSize * 0.12,
                      -tileSize * 0.2, tileSize * 0.1
                    ]);
                    g.endFill();
                    g.beginFill(0x0b0b08, 0.82 * fade);
                    g.drawEllipse(-tileSize * 0.18, tileSize * 0.08, tileSize * 0.075, tileSize * 0.045);
                    g.drawEllipse(tileSize * 0.17, tileSize * 0.085, tileSize * 0.075, tileSize * 0.045);
                    g.endFill();
                    g.lineStyle(3.4, 0x0a0906, 0.92 * fade);
                    g.moveTo(-facing.x * tileSize * 0.02, -tileSize * 0.035 - facing.y * tileSize * 0.01);
                    g.lineTo(facing.x * tileSize * 0.37, -tileSize * 0.035 + facing.y * tileSize * 0.16);
                    g.lineStyle(1.2, 0x766f60, 0.62 * fade);
                    g.moveTo(-facing.x * tileSize * 0.02, -tileSize * 0.04 - facing.y * tileSize * 0.01);
                    g.lineTo(facing.x * tileSize * 0.35, -tileSize * 0.04 + facing.y * tileSize * 0.15);
                  } else if (markerVisualClass === 'wheeled') {
                    g.beginFill(0x34322c, 0.96 * fade);
                    g.drawPolygon([
                      -tileSize * 0.28, tileSize * 0.06,
                      -tileSize * 0.2, -tileSize * 0.09,
                      tileSize * 0.02, -tileSize * 0.11,
                      tileSize * 0.1, -tileSize * 0.03,
                      tileSize * 0.28, -tileSize * 0.015,
                      tileSize * 0.3, tileSize * 0.09,
                      -tileSize * 0.23, tileSize * 0.11
                    ]);
                    g.endFill();
                    g.beginFill(0x090906, 0.88 * fade);
                    for (const wheelX of [-0.2, 0, 0.2]) {
                      g.drawEllipse(wheelX * tileSize, tileSize * 0.095, tileSize * 0.052, tileSize * 0.035);
                    }
                    g.endFill();
                  } else {
                    g.beginFill(0x2f2e29, 0.96 * fade);
                    g.drawRoundedRect(-tileSize * 0.24, -tileSize * 0.115, tileSize * 0.48, tileSize * 0.21, 3);
                    g.endFill();
                    g.lineStyle(1.3, 0x827c70, 0.62 * fade);
                    g.drawRoundedRect(-tileSize * 0.24, -tileSize * 0.115, tileSize * 0.48, tileSize * 0.21, 3);
                    g.lineStyle(3, 0x090906, 0.86 * fade);
                    g.moveTo(-tileSize * 0.22, tileSize * 0.078);
                    g.lineTo(tileSize * 0.22, tileSize * 0.078);
                    g.moveTo(-tileSize * 0.22, -tileSize * 0.084);
                    g.lineTo(tileSize * 0.22, -tileSize * 0.084);
                    g.beginFill(0x484239, 0.94 * fade);
                    g.drawEllipse(0, -tileSize * 0.035, tileSize * 0.115, tileSize * 0.073);
                    g.endFill();
                    g.lineStyle(3.1, 0x0a0906, 0.9 * fade);
                    g.moveTo(facing.x * tileSize * 0.04, -tileSize * 0.03 + facing.y * tileSize * 0.02);
                    g.lineTo(facing.x * tileSize * 0.3, -tileSize * 0.03 + facing.y * tileSize * 0.14);
                  }
                  g.lineStyle();
                  g.beginFill(0x0b0b08, 0.72 * fade);
                  g.drawEllipse(-tileSize * 0.11, -tileSize * 0.015, tileSize * 0.065, tileSize * 0.035);
                  g.drawEllipse(tileSize * 0.13, tileSize * 0.025, tileSize * 0.05, tileSize * 0.03);
                  g.endFill();
                  for (const [debrisX, debrisY, debrisW, debrisH] of [
                    [-0.33, 0.02, 0.08, 0.035],
                    [0.3, 0.07, 0.06, 0.03],
                    [-0.2, 0.13, 0.05, 0.025],
                    [0.18, -0.12, 0.045, 0.022]
                  ] as const) {
                    g.beginFill(0x3d3931, 0.84 * fade);
                    const shardX = debrisX * tileSize;
                    const shardY = debrisY * tileSize;
                    const shardW = Math.max(2, debrisW * tileSize);
                    const shardH = Math.max(1.5, debrisH * tileSize);
                    g.drawPolygon([
                      shardX - shardW * 0.55, shardY,
                      shardX - shardW * 0.08, shardY - shardH * 0.65,
                      shardX + shardW * 0.58, shardY - shardH * 0.12,
                      shardX + shardW * 0.18, shardY + shardH * 0.58
                    ]);
                    g.endFill();
                  }
                }
                const smokeLife = Math.max(0, 1 - elapsed / WRECK_SMOKE_ANIMATION_MS);
                const smokeBoost = Math.max(0, 1 - elapsed / 7000);
                if (smokeLife > 0) {
                  const coreSmoke = smokeLife * (0.38 + smokeBoost * 0.42) * fade;
                  g.beginFill(0x3f423d, coreSmoke);
                  g.drawEllipse(-tileSize * 0.025, -tileSize * 0.18, tileSize * 0.18, tileSize * 0.16);
                  g.endFill();
                  g.beginFill(0x6a6d66, coreSmoke * 0.8);
                  g.drawEllipse(tileSize * 0.035, -tileSize * 0.34, tileSize * 0.22, tileSize * 0.18);
                  g.endFill();
                  for (let s = 0; s < 8; s++) {
                    const rise = prefersReducedMotion ? (0.14 + s / 8) % 1 : ((now / 2200) + s / 8) % 1;
                    const sa = (1 - rise) * (0.24 + 0.7 * smokeBoost) * smokeLife * fade;
                    if (sa <= 0.01) continue;
                    const sx = prefersReducedMotion ? 0 : Math.sin((now / 900) + s * 1.65) * tileSize * (0.05 + rise * 0.05);
                    g.beginFill(rise < 0.38 ? 0x343530 : 0x777a73, sa);
                    g.drawEllipse(sx, -tileSize * (0.1 + rise * 0.82), tileSize * (0.13 + rise * 0.24), tileSize * (0.09 + rise * 0.18));
                    g.endFill();
                  }
                }
                const settledHaze = Math.min(1, Math.max(0, elapsed) / 9000);
                g.beginFill(0x545650, 0.11 * settledHaze * fade);
                g.drawEllipse(-tileSize * 0.025, -tileSize * 0.24, tileSize * 0.16, tileSize * 0.12);
                g.endFill();
                g.beginFill(0x74766e, 0.07 * settledHaze * fade);
                g.drawEllipse(tileSize * 0.035, -tileSize * 0.39, tileSize * 0.2, tileSize * 0.14);
                g.endFill();
              } else {
                g.beginFill(0x170b09, 0.62 * fade);
                g.drawEllipse(-tileSize * 0.02, tileSize * 0.05, tileSize * 0.28, tileSize * 0.09);
                g.endFill();
                g.beginFill(0x6b2d22, 0.62 * fade);
                g.drawEllipse(-tileSize * 0.02, tileSize * 0.045, tileSize * 0.23, tileSize * 0.065);
                g.endFill();
                g.lineStyle(1.25, 0xd1a17d, 0.48 * fade);
                g.drawEllipse(-tileSize * 0.02, tileSize * 0.045, tileSize * 0.23, tileSize * 0.065);
                g.lineStyle();
                if (!corpseTexture) {
                  const isRifleMarker = markerVisualClass === 'rifle';
                  g.beginFill(isRifleMarker ? 0x51463a : 0x4b3b34, 0.94 * fade);
                  g.drawEllipse(0, tileSize * 0.015, tileSize * (isRifleMarker ? 0.16 : 0.21), tileSize * 0.055);
                  g.endFill();
                  g.beginFill(0x2c211c, 0.92 * fade);
                  g.drawCircle(-tileSize * (isRifleMarker ? 0.17 : 0.22), -tileSize * 0.015, tileSize * (isRifleMarker ? 0.045 : 0.06));
                  g.endFill();
                  g.lineStyle(isRifleMarker ? 2 : 2.8, 0x7a6652, 0.78 * fade);
                  g.moveTo(-tileSize * 0.08, tileSize * 0.015);
                  g.lineTo(tileSize * (isRifleMarker ? 0.2 : 0.25), tileSize * 0.085);
                  g.moveTo(-tileSize * 0.02, tileSize * 0.025);
                  g.lineTo(tileSize * 0.1, -tileSize * (isRifleMarker ? 0.08 : 0.12));
                  if (isRifleMarker) {
                    g.lineStyle(2.1, 0x17130e, 0.92 * fade);
                    g.moveTo(-tileSize * 0.12, -tileSize * 0.08);
                    g.lineTo(tileSize * 0.25, tileSize * 0.075);
                    g.lineStyle(0.8, 0x8c7352, 0.7 * fade);
                    g.moveTo(-tileSize * 0.1, -tileSize * 0.085);
                    g.lineTo(tileSize * 0.23, tileSize * 0.07);
                  }
                }
              }
            }}
          />
          {corpseTexture && corpseTexturePath ? (
            <Sprite
              texture={corpseTexture}
              anchor={{ x: 0.5, y: RASTER_UNIT_ANCHOR_Y[corpseTexturePath] ?? 0.9 }}
              scale={{
                x: unitVisualHeight(tileSize, m.unitType ?? 'infantry', m.definitionId) / (RASTER_UNIT_VISIBLE_HEIGHTS[corpseTexturePath] ?? 1024) * markerTransform.scaleX,
                y: unitVisualHeight(tileSize, m.unitType ?? 'infantry', m.definitionId) / (RASTER_UNIT_VISIBLE_HEIGHTS[corpseTexturePath] ?? 1024) * markerTransform.scaleY
              }}
              y={tileSize * markerTransform.y}
              rotation={markerTransform.rotation}
              alpha={mechanicalWreck ? 0.9 : 0.98}
              tint={mechanicalWreck ? 0x777268 : 0xd1ae96}
              zIndex={1}
            />
          ) : null}
          <Graphics
            zIndex={2}
            draw={(g) => {
              g.clear();
              if (!deathMarkerDetailVisible(hitInFlight, Boolean(corpseTexture))) return;
              const dark = 0x211d17;
              const edge = mechanicalWreck ? 0xa49a82 : 0xc49a78;
              const edgeAlpha = (mechanicalWreck ? 0.7 : 0.88) * fade;
              if (markerVisualClass === 'rifle') {
                g.lineStyle(2.2, dark, 0.92 * fade);
                g.moveTo(-tileSize * 0.23, -tileSize * 0.075);
                g.lineTo(tileSize * 0.27, tileSize * 0.09);
                g.lineStyle(0.85, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.21, -tileSize * 0.082);
                g.lineTo(tileSize * 0.25, tileSize * 0.083);
                g.lineStyle();
                g.beginFill(0x392a21, 0.84 * fade);
                g.drawCircle(-tileSize * 0.19, tileSize * 0.01, tileSize * 0.036);
                g.endFill();
              } else if (markerVisualClass === 'melee') {
                g.lineStyle(2.3, dark, 0.9 * fade);
                g.moveTo(-tileSize * 0.23, tileSize * 0.045);
                g.lineTo(tileSize * 0.2, -tileSize * 0.045);
                g.moveTo(-tileSize * 0.08, tileSize * 0.015);
                g.lineTo(tileSize * 0.08, tileSize * 0.125);
                g.lineStyle(1, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.2, tileSize * 0.025);
                g.lineTo(tileSize * 0.18, -tileSize * 0.055);
                g.lineStyle(2.1, 0x34271d, 0.88 * fade);
                g.moveTo(-tileSize * 0.29, -tileSize * 0.11);
                g.quadraticCurveTo(-tileSize * 0.12, 0, -tileSize * 0.27, tileSize * 0.13);
                g.lineStyle(0.85, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.28, -tileSize * 0.1);
                g.lineTo(-tileSize * 0.27, tileSize * 0.12);
              } else if (markerVisualClass === 'heavy') {
                g.lineStyle(2.4, dark, 0.88 * fade);
                g.drawPolygon([
                  -tileSize * 0.25, tileSize * 0.035,
                  -tileSize * 0.1, -tileSize * 0.09,
                  tileSize * 0.18, -tileSize * 0.045,
                  tileSize * 0.27, tileSize * 0.075
                ]);
                g.lineStyle(1, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.18, -tileSize * 0.005);
                g.lineTo(tileSize * 0.21, tileSize * 0.055);
                g.lineStyle();
                g.beginFill(0x3a2c23, 0.84 * fade);
                g.drawCircle(-tileSize * 0.22, -tileSize * 0.005, tileSize * 0.052);
                g.endFill();
              } else if (markerVisualClass === 'creature') {
                g.beginFill(0x30251e, 0.54 * fade);
                g.drawPolygon([
                  -tileSize * 0.27, tileSize * 0.035,
                  -tileSize * 0.17, -tileSize * 0.075,
                  tileSize * 0.08, -tileSize * 0.085,
                  tileSize * 0.23, -tileSize * 0.025,
                  tileSize * 0.18, tileSize * 0.065,
                  -tileSize * 0.08, tileSize * 0.095
                ]);
                g.endFill();
                g.lineStyle(2.1, dark, 0.94 * fade);
                g.moveTo(-tileSize * 0.37, -tileSize * 0.005);
                g.lineTo(-tileSize * 0.22, tileSize * 0.035);
                g.lineTo(tileSize * 0.22, -tileSize * 0.025);
                g.moveTo(-tileSize * 0.09, tileSize * 0.045);
                g.lineTo(-tileSize * 0.18, tileSize * 0.145);
                g.moveTo(tileSize * 0.07, tileSize * 0.03);
                g.lineTo(tileSize * 0.19, tileSize * 0.125);
                g.beginFill(dark, 0.92 * fade);
                g.drawCircle(tileSize * 0.25, -tileSize * 0.025, tileSize * 0.052);
                g.endFill();
                g.lineStyle(1, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.24, tileSize * 0.018);
                g.lineTo(tileSize * 0.2, -tileSize * 0.035);
                g.moveTo(tileSize * 0.24, -tileSize * 0.07);
                g.lineTo(tileSize * 0.29, -tileSize * 0.11);
                g.moveTo(tileSize * 0.27, -tileSize * 0.02);
                g.lineTo(tileSize * 0.33, tileSize * 0.005);
              } else if (markerVisualClass === 'air') {
                g.lineStyle(2.4, dark, 0.94 * fade);
                g.moveTo(-tileSize * 0.34, tileSize * 0.02);
                g.lineTo(tileSize * 0.32, -tileSize * 0.045);
                g.moveTo(-tileSize * 0.06, -tileSize * 0.16);
                g.lineTo(tileSize * 0.08, tileSize * 0.15);
                g.lineStyle(0.9, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.31, tileSize * 0.005);
                g.lineTo(tileSize * 0.29, -tileSize * 0.055);
                g.drawEllipse(-tileSize * 0.02, -tileSize * 0.01, tileSize * 0.12, tileSize * 0.045);
              } else if (markerVisualClass === 'structure') {
                g.lineStyle(3.2, dark, 0.94 * fade);
                g.moveTo(-tileSize * 0.28, tileSize * 0.12);
                g.lineTo(tileSize * 0.24, -tileSize * 0.13);
                g.moveTo(-tileSize * 0.24, -tileSize * 0.12);
                g.lineTo(tileSize * 0.29, tileSize * 0.1);
                g.lineStyle(1, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.25, tileSize * 0.095);
                g.lineTo(tileSize * 0.21, -tileSize * 0.12);
                g.moveTo(-tileSize * 0.21, -tileSize * 0.105);
                g.lineTo(tileSize * 0.25, tileSize * 0.085);
              } else if (markerVisualClass === 'artillery') {
                g.lineStyle(2.2, dark, 0.92 * fade);
                g.drawCircle(-tileSize * 0.18, tileSize * 0.085, tileSize * 0.055);
                g.drawCircle(tileSize * 0.14, tileSize * 0.08, tileSize * 0.055);
                g.moveTo(-tileSize * 0.08, tileSize * 0.02);
                g.lineTo(tileSize * 0.37, -tileSize * 0.115);
                g.lineStyle(0.9, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.05, tileSize * 0.005);
                g.lineTo(tileSize * 0.35, -tileSize * 0.11);
              } else if (markerVisualClass === 'wheeled') {
                g.lineStyle(2.1, dark, 0.92 * fade);
                g.drawRoundedRect(-tileSize * 0.27, -tileSize * 0.07, tileSize * 0.54, tileSize * 0.15, 2);
                for (const wheelX of [-0.19, 0, 0.19]) {
                  g.drawCircle(wheelX * tileSize, tileSize * 0.09, tileSize * 0.04);
                }
                g.lineStyle(0.85, edge, edgeAlpha);
                g.moveTo(-tileSize * 0.23, -tileSize * 0.045);
                g.lineTo(tileSize * 0.23, tileSize * 0.045);
              } else {
                g.lineStyle(2.5, dark, 0.94 * fade);
                g.moveTo(-tileSize * 0.28, -tileSize * 0.075);
                g.lineTo(tileSize * 0.28, -tileSize * 0.045);
                g.moveTo(-tileSize * 0.28, tileSize * 0.075);
                g.lineTo(tileSize * 0.28, tileSize * 0.055);
                g.lineStyle(0.9, edge, edgeAlpha);
                g.drawEllipse(0, -tileSize * 0.025, tileSize * 0.11, tileSize * 0.055);
                g.moveTo(tileSize * 0.05, -tileSize * 0.035);
                g.lineTo(tileSize * 0.3, -tileSize * 0.11);
              }
              g.lineStyle();
            }}
          />
          {mechanicalWreck ? (
            <Graphics
              zIndex={3}
              draw={(g) => {
                g.clear();
                const emberLife = Math.max(0, 1 - elapsed / 14000);
                if (emberLife > 0) {
                  for (const [ex, ey, ph] of [[-0.06, -0.02, 0], [0.05, 0.01, 1.7], [0.0, -0.06, 3.1]] as const) {
                    const flick = prefersReducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(now / 120 + ph);
                    g.beginFill(0xff7a2a, emberLife * flick * 0.8 * fade);
                    g.drawCircle(ex * tileSize, ey * tileSize, Math.max(0.8, tileSize * 0.02 * flick));
                    g.endFill();
                  }
                }
                const flameLife = Math.max(0, 1 - elapsed / 10_000);
                if (flameLife <= 0) return;
                const flicker = prefersReducedMotion ? 0.7 : 0.72 + Math.sin(now / 95) * 0.18;
                g.beginFill(0x4b1909, flameLife * 0.78 * fade);
                g.drawEllipse(0, -tileSize * 0.055, tileSize * 0.075, tileSize * 0.12 * flicker);
                g.endFill();
                g.beginFill(0xff6b1c, flameLife * 0.9 * fade);
                g.drawEllipse(0, -tileSize * 0.07, tileSize * 0.04, tileSize * 0.075 * flicker);
                g.endFill();
                g.beginFill(0xffd35c, flameLife * 0.88 * fade);
                g.drawCircle(0, -tileSize * 0.045, tileSize * 0.018 * flicker);
                g.endFill();
              }}
            />
          ) : null}
        </Container>
      );
    });
    return els;
  }, [attackEffects, deathMarkers, exploredTiles, map.tiles, map.width, now, prefersReducedMotion, selectedUnitId, topGeomFor, unitTextureCache, viewerFaction, visibleTiles]);

  const targetLinkOverlay = useMemo(() => {
    const attackIsVisible = attackEffects.some((effect) => {
      const elapsed = now - effect.startTime;
      return elapsed >= 0 && elapsed <= combatEffectTiming(effect.type, effect.arc).totalMs;
    });
    if (!selectedUnitId || !targetUnitId || attackIsVisible) return null;
    let selectedUnit: UnitInstance | undefined;
    let targetUnit: UnitInstance | undefined;
    for (const side of Object.values(battleState.sides)) {
      const selectedCandidate = side.units.get(selectedUnitId);
      const targetCandidate = side.units.get(targetUnitId);
      if (selectedCandidate) selectedUnit = selectedCandidate;
      if (targetCandidate) targetUnit = targetCandidate;
    }
    if (!selectedUnit || !targetUnit || targetUnit.stance === 'destroyed') return null;
    const targetIdx = targetUnit.coordinate.r * map.width + targetUnit.coordinate.q;
    if (!visibleTiles.has(targetIdx)) return null;
    const pointFor = (unit: UnitInstance) => {
      const p = toScreen(unit.coordinate);
      const geom = ISO_MODE ? topGeomFor(unit.coordinate.q, unit.coordinate.r) : null;
      const elev = geom?.avgHeight ?? (map.tiles[unit.coordinate.r * map.width + unit.coordinate.q]?.elevation ?? 0);
      return { x: p.x, y: p.y - elev * ELEV_Y_OFFSET };
    };
    const from = pointFor(selectedUnit);
    const to = pointFor(targetUnit);
    const explicitTarget = targetHitChance !== undefined;
    const aimColor = targetLethal ? 0xff5747 : 0x91bac2;
    const readout = explicitTarget
      ? `${Math.round((targetHitChance ?? 0) * 100)}%${targetDamagePreview !== undefined ? `  -${targetDamagePreview}` : ''}${targetLethal ? `  ${t('combat.kill')}` : ''}`
      : '';
    return (
      <Container sortableChildren zIndex={30000}>
      <Graphics
        draw={(g) => {
          g.clear();
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const ux = dx / len;
          const uy = dy / len;
          const startGap = 16;
          const endGap = 14;
          const sx = from.x + ux * startGap;
          const sy = from.y + uy * startGap;
          const ex = to.x - ux * endGap;
          const ey = to.y - uy * endGap;
          const linkLen = Math.max(1, Math.hypot(ex - sx, ey - sy));
          // Thin crisp sight-line (sizes kept small in world units so the ~4.5x camera zoom
          // doesn't blow them into chunky bars): dark base + bright core.
          if (explicitTarget) {
            // Short dashes near the target end give a clean "line of fire" without a heavy bar.
            const step = 5;
            const dash = 3;
            g.lineStyle(1.5, 0x0a0d0a, 0.5);
            for (let d = 0; d < linkLen; d += step) {
              const a = d / linkLen;
              const b = Math.min(d + dash, linkLen) / linkLen;
              g.moveTo(sx + (ex - sx) * a, sy + (ey - sy) * a);
              g.lineTo(sx + (ex - sx) * b, sy + (ey - sy) * b);
            }
            g.lineStyle(0.75, aimColor, 0.92);
            for (let d = 0; d < linkLen; d += step) {
              const a = d / linkLen;
              const b = Math.min(d + dash, linkLen) / linkLen;
              g.moveTo(sx + (ex - sx) * a, sy + (ey - sy) * a);
              g.lineTo(sx + (ex - sx) * b, sy + (ey - sy) * b);
            }
            // Targeting reticle: corner brackets + small crosshair around the target.
            const cx = to.x;
            const cy = to.y - tileSize * 0.18;
            const R = 7.5;
            const L = 3;
            const reticle = () => {
              for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                const bx = cx + hx * R;
                const by = cy + hy * R;
                g.moveTo(bx, by); g.lineTo(bx - hx * L, by);
                g.moveTo(bx, by); g.lineTo(bx, by - hy * L);
              }
              g.moveTo(cx - 2.2, cy); g.lineTo(cx + 2.2, cy);
              g.moveTo(cx, cy - 2.2); g.lineTo(cx, cy + 2.2);
            };
            g.lineStyle(1.6, 0x0a0d0a, 0.6); reticle();
            g.lineStyle(0.9, aimColor, 0.96); reticle();
          } else {
            g.lineStyle(0.9, 0x0a0d0a, 0.34);
            g.moveTo(sx, sy); g.lineTo(ex, ey);
            g.lineStyle(0.5, 0xb0aa62, 0.5);
            g.moveTo(sx, sy); g.lineTo(ex, ey);
          }
        }}
      />
      {explicitTarget && readout ? (
        <Text
          text={readout}
          x={to.x}
          y={to.y - tileSize * 0.62}
          anchor={{ x: 0.5, y: 1 }}
          resolution={2}
          style={targetLethal ? targetReadoutLethalStyle : targetReadoutStyle}
        />
      ) : null}
      </Container>
    );
  }, [attackEffects, battleState.sides, map.tiles, map.width, now, selectedUnitId, targetHitChance, targetDamagePreview, targetLethal, targetUnitId, topGeomFor, visibleTiles, t]);

  const objectiveOverlays = useMemo(() => {
    if (objectiveCoords.length === 0) return [];
    const pulse = prefersReducedMotion ? 0.5 : (Math.sin(now / 420) + 1) / 2;
    return objectiveCoords.map((coord, index) => {
      const tileIdx = coord.r * map.width + coord.q;
      if (!exploredTiles.has(tileIdx)) return null;
      const pos = toScreen(coord);
      const geom = topGeomFor(coord.q, coord.r);
      const y = pos.y - geom.avgHeight * ELEV_Y_OFFSET;
      const isVisible = visibleTiles.has(tileIdx);
      return (
        <Graphics
          key={`objective-${coord.q}-${coord.r}-${index}`}
          x={pos.x}
          y={y}
          draw={(g) => {
            g.clear();
            const ring = geom.inset(0.86);
            const alpha = isVisible ? 0.62 + pulse * 0.18 : 0.3;
            g.beginFill(0xd8b33f, isVisible ? 0.08 + pulse * 0.04 : 0.04);
            drawPoly(g as PixiGraphics, ring);
            g.endFill();
            g.lineStyle(2.6, 0x090807, isVisible ? 0.5 : 0.24);
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(1.25, 0xf4cf5a, alpha);
            drawPoly(g as PixiGraphics, ring);
            const cross = geom.inset(0.34);
            g.lineStyle(1, 0xf6e6a0, isVisible ? 0.52 : 0.2);
            g.moveTo(cross[0].x, cross[0].y);
            g.lineTo(cross[2].x, cross[2].y);
            g.moveTo(cross[1].x, cross[1].y);
            g.lineTo(cross[3].x, cross[3].y);
          }}
        />
      );
    }).filter(Boolean) as JSX.Element[];
  }, [objectiveCoords, map.width, exploredTiles, visibleTiles, now, topGeomFor, prefersReducedMotion]);

  const arrivalOverlays = useMemo(() => {
    return arrivalEffects.flatMap((effect) => {
      const age = now - effect.startTime;
      if (age < 0 || age > 4200) return [];
      const tileIndex = effect.coordinate.r * map.width + effect.coordinate.q;

      const pos = toScreen(effect.coordinate);
      const geom = topGeomFor(effect.coordinate.q, effect.coordinate.r);
      const y = pos.y - geom.avgHeight * ELEV_Y_OFFSET;
      const progress = prefersReducedMotion ? 0.72 : Math.min(1, age / 2600);
      const fade = age < 3000 ? 1 : Math.max(0, 1 - (age - 3000) / 1200);
      const pulse = prefersReducedMotion ? 0.5 : (Math.sin(age / 95) + 1) / 2;
      const sensorAlpha = visibleTiles.has(tileIndex) ? 1 : 0.78;
      const primary = effect.faction === 'otherSide' ? 0xd63b62 : 0x4ed6ff;
      const glow = effect.faction === 'otherSide' ? 0xff82a3 : 0xb9f3ff;
      const ring = geom.inset(Math.max(0.48, 0.88 - progress * 0.22));

      return [(
        <Graphics
          key={effect.id}
          x={pos.x}
          y={y}
          draw={(g) => {
            g.clear();
            g.beginFill(primary, (0.1 + pulse * 0.08) * fade * sensorAlpha);
            drawPoly(g as PixiGraphics, ring);
            g.endFill();
            g.lineStyle(4.5, 0x07080b, 0.7 * fade * sensorAlpha);
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(2.2, primary, (0.82 + pulse * 0.16) * fade * sensorAlpha);
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(1.1, glow, 0.86 * fade * sensorAlpha);
            const inner = geom.inset(0.45 + pulse * 0.08);
            drawPoly(g as PixiGraphics, inner);
            g.lineStyle(3, primary, 0.18 * fade * sensorAlpha);
            g.moveTo(0, -8);
            g.lineTo(0, -58 - pulse * 12);
            g.lineStyle(1.2, glow, 0.74 * fade * sensorAlpha);
            g.moveTo(0, -10);
            g.lineTo(0, -55 - pulse * 10);
            g.beginFill(glow, (0.55 + pulse * 0.3) * fade * sensorAlpha);
            g.drawCircle(0, -58 - pulse * 10, 2.2 + pulse * 1.2);
            g.endFill();
          }}
        />
      )];
    });
  }, [arrivalEffects, map.width, now, prefersReducedMotion, topGeomFor, visibleTiles]);

  const scenarioEventOverlays = useMemo(() => scenarioEventEffects.flatMap((effect) => {
    const age = now - effect.startTime;
    if (age < 0 || age > 9000) return [];
    const progress = prefersReducedMotion ? 0.72 : Math.min(1, age / 5600);
    const fade = age < 6500 ? 1 : Math.max(0, 1 - (age - 6500) / 2500);
    const pulse = prefersReducedMotion ? 0.5 : (Math.sin(age / 120) + 1) / 2;
    const tileIndex = effect.coordinate.r * map.width + effect.coordinate.q;
    const sensorAlpha = visibleTiles.has(tileIndex) ? 1 : 0.72;
    const position = toScreen(effect.coordinate);
    const geom = topGeomFor(effect.coordinate.q, effect.coordinate.r);
    const y = position.y - geom.avgHeight * ELEV_Y_OFFSET;
    const style = scenarioEventVisualStyle(effect.kind);
    const outer = geom.inset(Math.max(0.44, 0.92 - progress * 0.26));
    const halfWidth = Math.max(...outer.map((point) => Math.abs(point.x)));
    const halfHeight = Math.max(...outer.map((point) => Math.abs(point.y)));
    const alpha = fade * sensorAlpha;

    return [(
      <Graphics
        key={effect.id}
        x={position.x}
        y={y}
        draw={(g) => {
          g.clear();
          if (style.shape === 'beacon') {
            g.beginFill(style.primary, (0.1 + pulse * 0.06) * alpha);
            drawPoly(g as PixiGraphics, outer);
            g.endFill();
            g.lineStyle(3.6, 0x07100f, 0.66 * alpha);
            drawPoly(g as PixiGraphics, outer);
            g.lineStyle(1.8, style.primary, (0.78 + pulse * 0.2) * alpha);
            drawPoly(g as PixiGraphics, outer);
            const inner = geom.inset(0.42 + pulse * 0.08);
            g.lineStyle(1.1, style.glow, 0.9 * alpha);
            drawPoly(g as PixiGraphics, inner);
            g.lineStyle(2.4, style.primary, 0.38 * alpha);
            g.moveTo(0, -6);
            g.lineTo(0, -68 - pulse * 12);
            g.lineStyle(1.1, style.glow, 0.85 * alpha);
            g.moveTo(0, -8);
            g.lineTo(0, -66 - pulse * 10);
            g.beginFill(style.glow, (0.58 + pulse * 0.28) * alpha);
            g.drawCircle(0, -69 - pulse * 10, 2.2 + pulse * 1.4);
            g.endFill();
          } else if (style.shape === 'fracture') {
            g.beginFill(style.primary, (0.08 + pulse * 0.08) * alpha);
            drawPoly(g as PixiGraphics, outer);
            g.endFill();
            g.lineStyle(3.2, 0x110b04, 0.58 * alpha);
            drawPoly(g as PixiGraphics, outer);
            g.lineStyle(1.7, style.primary, (0.72 + pulse * 0.2) * alpha);
            drawPoly(g as PixiGraphics, outer);
            g.lineStyle(1.25, style.glow, 0.86 * alpha);
            for (let index = 0; index < outer.length; index += 1) {
              const point = outer[index];
              const bend = outer[(index + 2) % outer.length];
              g.moveTo(0, 0);
              g.lineTo(point.x * 0.45, point.y * 0.45);
              g.lineTo(bend.x * 0.72, bend.y * 0.72);
            }
            const sweepY = -halfHeight * 0.36 + halfHeight * 0.72 * progress;
            g.lineStyle(2.2, style.glow, (0.34 + pulse * 0.34) * alpha);
            g.moveTo(-halfWidth * 0.6, sweepY);
            g.lineTo(halfWidth * 0.6, sweepY);
          } else {
            g.beginFill(style.primary, (0.08 + pulse * 0.08) * alpha);
            drawPoly(g as PixiGraphics, geom.inset(0.9));
            g.endFill();
            for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
              const ringProgress = (progress + ringIndex * 0.23) % 1;
              const ring = geom.inset(0.28 + ringProgress * 0.62);
              g.lineStyle(
                ringIndex === 0 ? 2.4 : 1.25,
                ringIndex === 0 ? style.glow : style.primary,
                (0.72 - ringProgress * 0.46) * alpha
              );
              drawPoly(g as PixiGraphics, ring);
            }
            g.lineStyle(1.2, style.glow, (0.46 + pulse * 0.32) * alpha);
            g.moveTo(-halfWidth * 0.58, 0);
            g.lineTo(halfWidth * 0.58, 0);
            g.moveTo(0, -halfHeight * 0.58);
            g.lineTo(0, halfHeight * 0.58);
          }
        }}
      />
    )];
  }), [map.width, now, prefersReducedMotion, scenarioEventEffects, topGeomFor, visibleTiles]);

  // Deployment start zone: a cool pulsing tint so "click a glowing tile" is literally true.
  const startZoneOverlays = useMemo(() => {
    if (startZoneCoords.length === 0) return [];
    const pulse = prefersReducedMotion ? 0.5 : (Math.sin(now / 360) + 1) / 2;
    return startZoneCoords.map((coord, index) => {
      const pos = toScreen(coord);
      const geom = topGeomFor(coord.q, coord.r);
      const y = pos.y - geom.avgHeight * ELEV_Y_OFFSET;
      return (
        <Graphics
          key={`startzone-${coord.q}-${coord.r}-${index}`}
          x={pos.x}
          y={y}
          draw={(g) => {
            g.clear();
            const ring = geom.inset(0.88);
            g.beginFill(0x4fd0c0, 0.12 + pulse * 0.07);
            drawPoly(g as PixiGraphics, ring);
            g.endFill();
            g.lineStyle(2.4, 0x06120f, 0.42);
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(1.3, 0x8ff0e2, 0.5 + pulse * 0.3);
            drawPoly(g as PixiGraphics, ring);
          }}
        />
      );
    });
  }, [startZoneCoords, now, topGeomFor, prefersReducedMotion]);


  const units = useMemo(() => {
    let selectedEmbarkedCarrierId: string | undefined;
    if (selectedUnitId) {
      for (const side of Object.values(battleState.sides)) {
        const selected = side.units.get(selectedUnitId);
        if (selected?.embarkedOn) {
          selectedEmbarkedCarrierId = selected.embarkedOn;
          break;
        }
      }
    }

    return Object.values(battleState.sides).flatMap((side) =>
      Array.from(side.units.values()).flatMap((unit) => {
        let displayCoord = unit.coordinate;
        let animatedOrientation = unit.orientation ?? 0;
        let movementPhase = 0;
        let movingThisUnit = false;
        let turningThisUnit = false;
        let initialTurnThisUnit = false;
        let vehicleTurnFromOrientation: number | null = null;
        let vehicleTurnToOrientation: number | null = null;
        let vehicleTurnProgress = 0;
        let vehicleTurnDirection = 0;
        let vehicleTurnBlend: ReturnType<typeof vehicleTurnSheetBlend> | null = null;
        let vehicleMotionIntensity = 0;
        let vehicleDustIntensity = 0;
        let moveScreenVector = orientationScreenVector(animatedOrientation);
        let movingBaseHeight: number | undefined;
        let easedProgress = 0;
        const unitType: string = unit.unitType;
        const definitionId = unit.definitionId.toLowerCase();
        const isSupportVehicle = isSupportVehicleDefinition(unitType, definitionId);
        const isGroundVehicle = unitType === 'vehicle' || unitType === 'artillery' || isSupportVehicle;
        const runningGearKind = vehicleRunningGearKind(unitType, definitionId);
        const unitDirectionalSprite = battlefieldDirectionalSprite(unitType, definitionId);

        if (movingUnit && movingUnit.unitId === unit.id && activeMovementFrame) {
          const movementPath = movingUnit.path;
          const {
            currentStep,
            displayCoord: animatedCoord,
            easedProgress: frameProgress,
            fromCoord,
            isMoving,
            isInitialTurnPhase,
            isTurnPhase,
            movementPhase: framePhase,
            stepProgress,
            toCoord,
            turnProgress
          } = activeMovementFrame;

          easedProgress = frameProgress;
          movingThisUnit = isMoving;
          turningThisUnit = isTurnPhase;
          initialTurnThisUnit = isInitialTurnPhase;
          movementPhase = framePhase;
          displayCoord = animatedCoord;
          vehicleMotionIntensity = isGroundVehicle ? vehicleMotionEnvelope(activeMovementFrame) : 0;
          vehicleDustIntensity = isGroundVehicle ? vehicleDustEnvelope(activeMovementFrame) : 0;

          const fromIdx = fromCoord.r * map.width + fromCoord.q;
          const toIdx = toCoord.r * map.width + toCoord.q;
          const fromGeom = ISO_MODE ? topGeomFor(fromCoord.q, fromCoord.r) : null;
          const toGeom = ISO_MODE ? topGeomFor(toCoord.q, toCoord.r) : null;
          const fromHeight = fromGeom ? fromGeom.avgHeight : (map.tiles[fromIdx]?.elevation ?? 0);
          const toHeight = toGeom ? toGeom.avgHeight : (map.tiles[toIdx]?.elevation ?? 0);
          movingBaseHeight = isTurnPhase
            ? toHeight
            : fromHeight + (toHeight - fromHeight) * easedProgress;

          const segmentHeading = segmentOrientation(fromCoord, toCoord);
          const currentOrientation = isInitialTurnPhase
            ? (movingUnit.initialOrientation ?? segmentHeading)
            : segmentHeading;
          const nextOrientation = isInitialTurnPhase
            ? segmentHeading
            : currentStep + 2 < movementPath.length
              ? segmentOrientation(toCoord, movementPath[currentStep + 2])
              : currentOrientation;
          animatedOrientation = isTurnPhase && turnProgress >= 0.5 ? nextOrientation : currentOrientation;
          moveScreenVector = isInitialTurnPhase
            ? orientationScreenVector(currentOrientation)
            : screenVectorBetween(fromCoord, toCoord);
          if (isGroundVehicle && isTurnPhase && (isInitialTurnPhase || currentStep + 2 < movementPath.length)) {
            const nextVector = isInitialTurnPhase
              ? orientationScreenVector(nextOrientation)
              : screenVectorBetween(toCoord, movementPath[currentStep + 2]);
            const smoothTurn = turnProgress * turnProgress * (3 - 2 * turnProgress);
            const cross = moveScreenVector.x * nextVector.y - moveScreenVector.y * nextVector.x;
            vehicleTurnFromOrientation = currentOrientation;
            vehicleTurnToOrientation = nextOrientation;
            vehicleTurnProgress = turnProgress;
            vehicleTurnDirection = Math.sign(cross) || 1;
            if (unitDirectionalSprite) {
              vehicleTurnBlend = vehicleTurnSheetBlend(
                currentOrientation,
                nextOrientation,
                unitDirectionalSprite,
                turnProgress,
                vehicleTurnDirection
              );
              const turnFromVector = screenVectorForDirectionName(vehicleTurnBlend.displayFrom);
              const turnToVector = screenVectorForDirectionName(vehicleTurnBlend.displayTo);
              const turnStepProgress = vehicleTurnBlend.progress;
              const smoothStepTurn = turnStepProgress * turnStepProgress * (3 - 2 * turnStepProgress);
              moveScreenVector = mixScreenVectors(turnFromVector, turnToVector, smoothStepTurn);
            } else {
              moveScreenVector = mixScreenVectors(moveScreenVector, nextVector, smoothTurn);
            }
          }
          const turnBlendWindow = 0.64;
          if (!isGroundVehicle && stepProgress > 1 - turnBlendWindow && currentStep + 2 < movementPath.length) {
            const nextVector = screenVectorBetween(toCoord, movementPath[currentStep + 2]);
            const t = (stepProgress - (1 - turnBlendWindow)) / turnBlendWindow;
            const smoothT = t * t * (3 - 2 * t);
            moveScreenVector = mixScreenVectors(moveScreenVector, nextVector, smoothT);
          } else if (!isGroundVehicle && stepProgress < turnBlendWindow && currentStep > 0) {
            const previousVector = screenVectorBetween(movementPath[currentStep - 1], fromCoord);
            const t = stepProgress / turnBlendWindow;
            const smoothT = t * t * (3 - 2 * t);
            moveScreenVector = mixScreenVectors(previousVector, moveScreenVector, smoothT);
          }
        }

        const stridePhase = movingThisUnit && movingUnit?.unitId === unit.id
          ? Math.max(0, now - movingUnit.startTime - (movingUnit.preAlignDuration ?? 0)) / 360
          : movementPhase;
        const locomotionPhase = isGroundVehicle ? movementPhase : stridePhase;
        const runningGearPhase = vehicleGearPhase(
          locomotionPhase,
          turningThisUnit ? vehicleTurnProgress : 0
        );
        const stepWave = movingThisUnit ? Math.sin(locomotionPhase * Math.PI * 2) : 0;
        const fastWave = movingThisUnit ? Math.sin(locomotionPhase * Math.PI * 4) : 0;
        const strideLift = Math.abs(stepWave);
        const footGroundMotion = infantryGroundMotion(stepWave, Boolean(unitDirectionalSprite));
        const p = toScreen(displayCoord);
        const displayQ = Math.min(map.width - 1, Math.max(0, Math.round(displayCoord.q)));
        const displayR = Math.min(map.height - 1, Math.max(0, Math.round(displayCoord.r)));
        const idx = displayR * map.width + displayQ;
        const elev = map.tiles[idx]?.elevation ?? 0;
        const groundTerrain = map.tiles[idx]?.terrain ?? 'plain';
        const darkVehicleGround = groundTerrain === 'road'
          || groundTerrain === 'urban'
          || groundTerrain === 'structure'
          || groundTerrain === 'swamp';
        const geom = ISO_MODE ? topGeomFor(displayQ, displayR) : null;
        const baseHeight = movingBaseHeight ?? (ISO_MODE && geom ? geom.avgHeight : elev);
        const isGhoulPack = definitionId.includes('ghoul') || definitionId.includes('zombie') || definitionId.includes('undead');
        const x = Math.round(p.x);
        const y = Math.round(p.y - baseHeight * ELEV_Y_OFFSET);
        const color = unit.faction === 'alliance' ? 0x5dade2 : 0xe74c3c;
        const isSelected = unit.id === selectedUnitId;
        const isSelectedCarrier = unit.id === selectedEmbarkedCarrierId;
        const isTarget = unit.id === targetUnitId;
        const movementTransitionActive = movingUnit?.unitId === unit.id && activeMovementFrame !== null;
        const tileIndex = displayR * map.width + displayQ;
        const isVisible = visibleTiles.has(tileIndex);
        const isFriendly = unit.faction === viewerFaction;
        const readableInFog = isFriendly && !isVisible;
        // Sort by real screen-Y so units/buildings interleave by true depth; a tiny tie-break keeps a
        // selected/targeted unit above same-tile clutter. A moving friendly that crosses remembered
        // terrain temporarily gets a reveal layer; otherwise stacked canopies can hide the squad while
        // its selection ring keeps moving on bare ground.
        const revealMovingFriendly = movementTransitionActive && readableInFog;
        const worldZ = Math.round(y)
          + (revealMovingFriendly ? 5000 : isSelected || isSelectedCarrier || isTarget || movingThisUnit ? 2 : 0);
        const isDestroyed = unit.stance === 'destroyed';
        const isEmbarked = Boolean(unit.embarkedOn);
        const incomingHit = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          const timing = combatEffectTiming(effect.type, effect.arc);
          return effect.toQ === displayQ
            && effect.toR === displayR
            && effect.hit !== false
            && elapsed >= timing.impactAtMs
            && elapsed <= timing.impactAtMs + timing.impactMs;
        });
        const outgoingShot = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.fromQ === unit.coordinate.q
            && effect.fromR === unit.coordinate.r
            && elapsed >= 0
            && elapsed <= 380; // long enough to show the recoil settle
        });
        const recentAttackSource = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.fromQ === unit.coordinate.q
            && effect.fromR === unit.coordinate.r
            && elapsed >= 0
            && elapsed <= combatEffectTiming(effect.type, effect.arc).totalMs;
        });
        const recentHitTarget = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          const timing = combatEffectTiming(effect.type, effect.arc);
          return effect.toQ === displayQ
            && effect.toR === displayR
            && effect.hit !== false
            && elapsed > timing.impactAtMs + timing.impactMs
            && elapsed <= timing.totalMs;
        });
        const hitElapsed = incomingHit ? now - incomingHit.startTime : 0;
        const incomingTiming = incomingHit ? combatEffectTiming(incomingHit.type, incomingHit.arc) : null;
        const hitReactionMs = incomingTiming ? Math.min(320, incomingTiming.impactMs) : 1;
        const hitPhase = incomingTiming ? Math.min(Math.max((hitElapsed - incomingTiming.impactAtMs) / hitReactionMs, 0), 1) : 1;
        const hitPulse = incomingHit ? 1 - hitPhase : 0;
        const impactFlash = incomingTiming ? Math.max(0, 1 - Math.abs(hitElapsed - incomingTiming.impactAtMs) / 105) : 0;
        const groundVehicleHitJolt = movingThisUnit ? 0.9 : 1.8;
        const hitJolt = incomingHit ? Math.sin(hitPhase * Math.PI * 5) * hitPulse * (unitType === 'vehicle' || unitType === 'artillery' ? groundVehicleHitJolt : 3.2) : 0;
        const shotPulse = outgoingShot ? 1 - Math.min((now - outgoingShot.startTime) / 320, 1) : 0;
        const residualTiming = recentHitTarget ? combatEffectTiming(recentHitTarget.type, recentHitTarget.arc) : null;
        const residualPulse = recentHitTarget && residualTiming
          ? 1 - Math.min((now - recentHitTarget.startTime - residualTiming.impactAtMs - residualTiming.impactMs) / Math.max(1, residualTiming.totalMs - residualTiming.impactAtMs - residualTiming.impactMs), 1)
          : 0;
        const effectVector = (effect: AttackEffect | undefined, towardTarget: boolean) => {
          if (!effect) return { x: 0, y: 0 };
          const from = toScreen({ q: effect.fromQ, r: effect.fromR });
          const to = toScreen({ q: effect.toQ, r: effect.toR });
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          return towardTarget ? { x: dx / len, y: dy / len } : { x: -dx / len, y: -dy / len };
        };
        const outgoingDir = effectVector(outgoingShot, true);
        const incomingDir = effectVector(incomingHit, true);
        const isOutgoingMelee = outgoingShot?.type === 'melee';
        const lunge = outgoingShot
          ? Math.sin(Math.min(1, (now - outgoingShot.startTime) / 320) * Math.PI) * (isOutgoingMelee ? 4.2 : 0)
          : 0;
        // Snappy recoil: a fast kick out (0-50ms) then a damped overshoot settle, instead of a flat
        // linear push — gives the shot a felt "crack" and recovery.
        const recoilT = outgoingShot ? now - outgoingShot.startTime : 0;
        const recoilKick = outgoingShot
          ? (recoilT < 50
              ? recoilT / 50
              : Math.max(0, 1 - (recoilT - 50) / 290) * Math.cos((recoilT - 50) / 290 * Math.PI * 2.2) * Math.exp(-(recoilT - 50) / 150))
          : 0;
        const recoil = outgoingShot
          ? recoilKick * (unitType === 'vehicle' || unitType === 'artillery' ? 5.5 : 3.2)
          : 0;
        const shotOffsetX = outgoingShot ? outgoingDir.x * lunge - outgoingDir.x * recoil : 0;
        const shotOffsetY = outgoingShot ? outgoingDir.y * lunge - outgoingDir.y * recoil * 0.45 : 0;
        const hitOffsetX = incomingHit ? incomingDir.x * hitJolt : 0;
        const hitOffsetY = incomingHit ? incomingDir.y * hitJolt * 0.55 : 0;
        const factionAccent = isFriendly ? 0x7ec3df : 0xe05a49;
        const capHeight = unitType === 'air' ? tileSize * 0.10 : tileSize * 0.28;
        const k = unitType === 'infantry' ? 0.32 : (unitType === 'vehicle' || unitType === 'artillery') ? 0.46 : 0.40;
        const pointerArea = unitPointerArea(tileSize, unitType, definitionId, isSelected || isSelectedCarrier);
        const unitHitArea = new Rectangle(pointerArea.x, pointerArea.y, pointerArea.width, pointerArea.height);
        const stopUnitEvent = (event: FederatedPointerEvent) => {
          event.stopPropagation();
        };
        const handleUnitTap = (event: FederatedPointerEvent) => {
          event.stopPropagation();
          if (isFriendly) {
            onSelectUnit?.(unit.id);
          } else {
            onSelectTile?.(unit.coordinate);
          }
        };

        // Respect fog-of-war for enemies — but never hide one that's actively taking a visible hit,
        // otherwise a killing blow on a tile that fogs over leaves the "HIT -N" floating over bare ground.
        if (!isFriendly && !isVisible && !recentAttackSource && !incomingHit && !recentHitTarget) return [];

        // Keep a just-killed unit on screen (faded, darkened) while its hit effect is still playing, so
        // the "HIT -N" always overlays the dying enemy instead of bare ground — otherwise a killing blow
        // culls the sprite the same frame the number appears ("I shot something but nothing is there").
        // Damage applies synchronously and reaction fire can be future-dated, so match the killing
        // effect from its scheduled start rather than waiting for its shorter impact window.
        const killingEffect = isDestroyed
          ? activeKillingEffectForTarget(attackEffects, unit.id, now)
          : undefined;
        const killingReactionElapsed = killingEffect
          ? now - killingEffect.startTime - combatEffectTiming(killingEffect.type, killingEffect.arc).impactAtMs
          : 0;
        const dyingShown = isDestroyed
          && !isEmbarked
          && Boolean(killingEffect)
          && deathReactionAlpha(killingReactionElapsed) > 0;
        if ((isDestroyed && !movingThisUnit && !dyingShown) || isEmbarked) {
          return [];
        }

        // Set by the sprite IIFE below (runs during JSX build), then read by the status-bar
        // draw callback (runs later) so the bar hugs the unit's real sprite top.
        let unitSpriteTopY = -tileSize * 0.42;
        let unitVisibleTopY = -tileSize * 0.36;

        return (
          <Container
            key={unit.id}
            x={x}
            y={y}
            zIndex={worldZ}
            sortableChildren
            eventMode="static"
            cursor={isFriendly ? 'pointer' : 'crosshair'}
            hitArea={unitHitArea}
            pointerdown={stopUnitEvent}
            pointertap={handleUnitTap}
            pointerover={!isFriendly ? () => onUnitHover?.(unit.id) : undefined}
            pointerout={!isFriendly ? () => onUnitHover?.(null) : undefined}
          >
            <Graphics
              zIndex={0}
              draw={(g) => {
                g.clear();
                const markerScale = unitType === 'vehicle' || unitType === 'artillery'
                  ? (movingThisUnit && isGroundVehicle ? 0.74 : 0.82)
                  : 1;
                const rx = tileSize * 0.25 * markerScale;
                const ry = tileSize * 0.095 * markerScale;
                const strokeArc = (startDeg: number, endDeg: number, colorValue: number, alpha: number, width: number) => {
                  const steps = 14;
                  g.lineStyle(width, colorValue, alpha);
                  for (let i = 0; i <= steps; i++) {
                    const t = (startDeg + (endDeg - startDeg) * (i / steps)) * Math.PI / 180;
                    const px = Math.cos(t) * rx;
                    const py = Math.sin(t) * ry;
                    if (i === 0) g.moveTo(px, py);
                    else g.lineTo(px, py);
                  }
                };
                const bracket = (sx: number, sy: number, colorValue: number, alpha: number, width: number) => {
                  g.lineStyle(width, colorValue, alpha);
                  g.moveTo(-sx, -2); g.lineTo(-sx + 5, -sy);
                  g.moveTo(-sx, 2); g.lineTo(-sx + 5, sy);
                  g.moveTo(sx, -2); g.lineTo(sx - 5, -sy);
                  g.moveTo(sx, 2); g.lineTo(sx - 5, sy);
                };
                if (isFriendly) {
                  if (isSelected || isSelectedCarrier) {
                    if (isGroundVehicle) {
                      // Ground vehicles already have a large silhouette; keep selection out of the tracks.
                    } else {
                      g.lineStyle(2.1, 0x071015, 0.64);
                      g.drawEllipse(0, tileSize * 0.035, rx * 1.1, ry * 1.2);
                      g.lineStyle(1, isSelectedCarrier ? 0xf0d17c : 0xc8edf3, 0.7);
                      g.drawEllipse(0, tileSize * 0.035, rx * 1.02, ry * 1.1);
                      strokeArc(194, 251, isSelectedCarrier ? 0xd8b65b : 0x7ec3df, 0.84, 1.35);
                      strokeArc(289, 346, isSelectedCarrier ? 0xd8b65b : 0x7ec3df, 0.84, 1.35);
                      g.lineStyle(1, isSelectedCarrier ? 0xffe6a3 : 0xd4f4f2, 0.58);
                      g.moveTo(-rx - 3, 1); g.lineTo(-rx + 3, -2);
                      g.moveTo(rx + 3, 1); g.lineTo(rx - 3, -2);
                    }
                    if (isSelectedCarrier) {
                      g.beginFill(0xf0d17c, 0.9);
                      g.drawRect(-7, -tileSize * 0.21, 4, 4);
                      g.drawRect(-1, -tileSize * 0.21, 4, 4);
                      g.drawRect(5, -tileSize * 0.21, 4, 4);
                      g.endFill();
                    }
                  } else {
                    const sx = tileSize * 0.19 * markerScale;
                    const sy = tileSize * 0.05 * markerScale;
                    bracket(sx, sy, 0x081014, 0.3, 1.35);
                    bracket(sx, sy, 0x75b7d3, 0.34, 0.7);
                  }
                } else {
                  const sx = isTarget ? tileSize * 0.2 * markerScale : tileSize * 0.18 * markerScale;
                  const sy = isTarget ? tileSize * 0.068 * markerScale : tileSize * 0.056 * markerScale;
                  const accent = isTarget ? 0xe08a54 : 0xe05a49;
                  bracket(sx, sy, 0x160706, isTarget ? 0.46 : 0.28, isTarget ? 1.5 : 1.35);
                  bracket(sx, sy, accent, isTarget ? 0.64 : 0.34, isTarget ? 0.75 : 0.65);
                  if (isTarget) {
                    g.lineStyle(0.9, 0xc08a55, 0.52);
                    g.moveTo(-5, 0); g.lineTo(5, 0);
                    g.moveTo(0, -3); g.lineTo(0, 3);
                  }
                }
                if (outgoingShot) {
                  const pulse = Math.max(0, shotPulse);
                  g.lineStyle(3.2, 0x0d0705, 0.86 * pulse);
                  g.drawEllipse(0, tileSize * 0.03, rx * 1.62, ry * 1.86);
                  g.lineStyle(1.8, 0xffd46d, 1 * pulse);
                  g.drawEllipse(0, tileSize * 0.03, rx * (1.34 + pulse * 0.24), ry * (1.54 + pulse * 0.24));
                  g.beginFill(0xffd46d, 0.5 * pulse);
                  g.drawEllipse(0, tileSize * 0.03, rx * 0.86, ry * 0.86);
                  g.endFill();
                }
                if (recentHitTarget) {
                  const pulse = Math.max(0, residualPulse);
                  g.beginFill(0x17120d, 0.42 * pulse);
                  g.drawEllipse(-rx * 0.12, tileSize * 0.06, rx * 0.54, ry * 0.45);
                  g.drawEllipse(rx * 0.22, tileSize * 0.12, rx * 0.28, ry * 0.25);
                  g.endFill();
                  g.beginFill(0x5c3d2c, 0.38 * pulse);
                  g.drawEllipse(-rx * 0.3, tileSize * 0.0, rx * 0.12, ry * 0.18);
                  g.drawEllipse(rx * 0.32, tileSize * 0.04, rx * 0.1, ry * 0.16);
                  g.endFill();
                  g.beginFill(0xc77c55, 0.42 * pulse);
                  g.drawRect(-rx * 0.08, -tileSize * 0.01, 2, 2);
                  g.drawRect(rx * 0.28, tileSize * 0.04, 2, 2);
                  g.endFill();
                }
              }}
            />
            {isTarget && (
              <Graphics
                draw={(g) => {
                  g.clear();
                  const ringShape = (scale: number) => {
                    if (ISO_MODE) {
                      if (geom) return geom.inset(scale);
                      const s = (tileSize / 2) * scale;
                      const hw = (hexWidth / 2) * scale;
                      return [
                        { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                      ];
                    }
                    const s = (tileSize / 2) * scale;
                    const hw = (hexWidth / 2) * scale;
                    return [
                      { x: 0, y: -s },
                      { x: hw, y: -s / 2 },
                      { x: hw, y: s / 2 },
                      { x: 0, y: s },
                      { x: -hw, y: s / 2 },
                      { x: -hw, y: -s / 2 }
                    ];
                  };
                  const pts = ringShape(0.82);
                  g.lineStyle(0.9, 0x090806, 0.26);
                  drawPoly(g as PixiGraphics, pts);
                  g.lineStyle(0.6, 0xc08a55, 0.38);
                  drawPoly(g as PixiGraphics, pts);
                }}
              />
            )}
            <Graphics
              zIndex={0}
              draw={(g) => {
                g.clear();
                if (ISO_MODE) {
	                  const footprint = unitContactFootprint(tileSize, unitType, definitionId);
                    const baseAlpha = isSelected || isTarget ? (isFriendly ? 0.18 : 0.26) : (isFriendly ? 0.20 : 0.26);
                    const baseRx = isGroundVehicle ? footprint.rx * 0.48 : footprint.rx * 1.14;
                    const baseRy = isGroundVehicle ? footprint.ry * 0.4 : footprint.ry * (1.22 - strideLift * 0.08);
                    const isTrackedContact = runningGearKind === 'tracked';
                    const isWheeledContact = runningGearKind === 'wheeled';
                    const shadowAlpha = isDestroyed
                      ? 0
                      : isGroundVehicle
                        ? (movingThisUnit || turningThisUnit ? 0.24 : 0.22)
                        : footprint.alpha;
                    const shadowRx = isGroundVehicle ? footprint.rx * 0.72 : footprint.rx;
                    const shadowRy = isGroundVehicle ? footprint.ry * 0.58 : footprint.ry;
                    const showFactionBase = isVisible || readableInFog;
	                  if (showFactionBase) {
	                    // Ground vehicles get the team disc too (their large silhouette dilutes it, so 0.7x);
	                    // this is the main friend/foe read at zoomed-out city scale.
	                    const discAlpha = (isVisible ? baseAlpha : baseAlpha * 0.55) * (isGroundVehicle ? 0.62 : 1);
	                    g.beginFill(
                        isGroundVehicle
                          ? (isFriendly ? 0x5d8f97 : 0xae5a48)
                          : (isFriendly ? 0x1b5771 : 0x861d17),
                        discAlpha
                      );
	                    g.drawEllipse(0, footprint.y, baseRx, baseRy);
	                    g.endFill();
	                    g.lineStyle(1, isFriendly ? 0x0c2f3f : 0x4a0f0a, discAlpha * 1.15);
	                    g.drawEllipse(0, footprint.y, baseRx * 0.92, baseRy * 0.92);
	                    g.lineStyle();
                  }
	                    if (shadowAlpha > 0) {
                      const visibleShadowAlpha = isVisible ? shadowAlpha : 0;
                      for (const layer of softShadowLayers(visibleShadowAlpha)) {
                        g.beginFill(isGroundVehicle ? 0x020403 : 0x000000, layer.alpha);
                        g.drawEllipse(1, footprint.y, shadowRx * layer.scaleX, shadowRy * layer.scaleY);
                        g.endFill();
                      }
	                    }
                    if (isTrackedContact && (isVisible || readableInFog)) {
                      const contactVector = movingThisUnit || turningThisUnit
                        ? moveScreenVector
                        : orientationScreenVector(animatedOrientation);
                      const perpX = -contactVector.y;
                      const perpY = contactVector.x;
                      const trackHalf = footprint.rx * 0.48;
                      const trackGap = footprint.ry * 0.74;
                      const contactY = unitDirectionalSprite === 'tank_directional'
                        ? footprint.y - tileSize * 0.055
                        : footprint.y - tileSize * 0.002;
                      for (const sideOffset of VEHICLE_SIDE_OFFSETS) {
                        const ox = perpX * trackGap * sideOffset;
                        const oy = perpY * trackGap * sideOffset;
                        g.lineStyle(
                          4.2,
                          darkVehicleGround ? 0xb8ad89 : 0x1d2419,
                          darkVehicleGround ? (isSelected ? 0.28 : 0.23) : 0.3
                        );
                        g.moveTo(ox - contactVector.x * trackHalf, contactY + oy - contactVector.y * trackHalf * 0.11);
                        g.lineTo(ox + contactVector.x * trackHalf, contactY + oy + contactVector.y * trackHalf * 0.11);
                        g.lineStyle(2.25, 0x030503, isSelected ? 0.78 : 0.7);
                        g.moveTo(ox - contactVector.x * trackHalf, contactY + oy - contactVector.y * trackHalf * 0.11);
                        g.lineTo(ox + contactVector.x * trackHalf, contactY + oy + contactVector.y * trackHalf * 0.11);
                      }
                      if (movingThisUnit || turningThisUnit) {
                        g.lineStyle();
                        const rearX = -contactVector.x * footprint.rx * 0.58;
                        const rearY = footprint.y - contactVector.y * footprint.ry * 0.42;
                        const dustPulse = vehicleDustIntensity * (0.82 + 0.18 * Math.abs(fastWave));
                        for (let dustIndex = 0; dustIndex < 4; dustIndex += 1) {
                          const dustAge = (runningGearPhase + dustIndex / 4) % 1;
                          const dustAlpha = (1 - dustAge) * 0.34 * dustPulse;
                          const side = dustIndex % 2 === 0 ? -1 : 1;
                          g.beginFill(
                            darkVehicleGround
                              ? (dustIndex === 0 ? 0xc4bda3 : 0x99937e)
                              : (dustIndex === 0 ? 0xb7a77f : 0x8e8164),
                            dustAlpha * 0.9
                          );
                          g.drawEllipse(
                            rearX - contactVector.x * footprint.rx * (0.22 + dustAge * 0.72) + perpX * side * footprint.ry * (0.12 + dustAge * 0.3),
                            rearY - contactVector.y * footprint.ry * (0.12 + dustAge * 0.4) + perpY * side * footprint.ry * 0.16 - dustAge * tileSize * 0.035,
                            footprint.rx * (0.12 + dustAge * 0.19),
                            Math.max(1.05, footprint.ry * (0.08 + dustAge * 0.11))
                          );
                          g.endFill();
                        }
                      }
                      g.lineStyle();
                    }
                    if (isWheeledContact && (isVisible || readableInFog)) {
                      const contactVector = movingThisUnit || turningThisUnit
                        ? moveScreenVector
                        : orientationScreenVector(animatedOrientation);
                      const perpX = -contactVector.y;
                      const perpY = contactVector.x;
                      const wheelGap = footprint.ry * 0.78;
                      const contactY = footprint.y + tileSize * 0.004;
                      const wheelRotation = runningGearPhase * Math.PI * 2;
                      for (const axlePosition of WHEELED_AXLE_POSITIONS) {
                        for (const sideOffset of VEHICLE_SIDE_OFFSETS) {
                          const along = footprint.rx * axlePosition;
                          const side = wheelGap * sideOffset;
                          const wheelX = contactVector.x * along + perpX * side;
                          const wheelY = contactY + contactVector.y * along * 0.2 + perpY * side;
                          const wheelRx = footprint.rx * 0.09;
                          const wheelRy = Math.max(0.74, footprint.ry * 0.16);
                          g.lineStyle();
                          g.beginFill(0x050604, isSelected ? 0.7 : 0.62);
                          g.drawEllipse(wheelX, wheelY, wheelRx, wheelRy);
                          g.endFill();
                          g.lineStyle(0.8, 0x666858, 0.72);
                          g.drawEllipse(wheelX, wheelY, wheelRx * 0.66, wheelRy * 0.66);
                          if (movingThisUnit || turningThisUnit) {
                            const spokeAngle = wheelRotation + axlePosition * Math.PI;
                            g.lineStyle(0.95, 0xc0b68a, 0.46 + vehicleMotionIntensity * 0.38);
                            g.moveTo(
                              wheelX - Math.cos(spokeAngle) * wheelRx * 0.72,
                              wheelY - Math.sin(spokeAngle) * wheelRy * 0.72
                            );
                            g.lineTo(
                              wheelX + Math.cos(spokeAngle) * wheelRx * 0.72,
                              wheelY + Math.sin(spokeAngle) * wheelRy * 0.72
                            );
                          }
                        }
                      }
                      if (movingThisUnit || turningThisUnit) {
                        g.lineStyle();
                        const rearX = -contactVector.x * footprint.rx * 0.64;
                        const rearY = footprint.y - contactVector.y * footprint.ry * 0.46;
                        const dustPulse = vehicleDustIntensity * (0.8 + 0.2 * Math.abs(fastWave));
                        for (let dustIndex = 0; dustIndex < 4; dustIndex += 1) {
                          const dustAge = (runningGearPhase + dustIndex / 4) % 1;
                          const side = dustIndex % 2 === 0 ? -1 : 1;
                          g.beginFill(dustIndex === 0 ? 0xb7a77f : 0x8e8164, (1 - dustAge) * 0.125 * dustPulse);
                          g.drawEllipse(
                            rearX - contactVector.x * footprint.rx * (0.22 + dustAge * 0.74) + perpX * side * footprint.ry * (0.1 + dustAge * 0.28),
                            rearY - contactVector.y * footprint.ry * (0.1 + dustAge * 0.42) + perpY * side * footprint.ry * 0.14 - dustAge * tileSize * 0.034,
                            footprint.rx * (0.09 + dustAge * 0.15),
                            Math.max(0.9, footprint.ry * (0.06 + dustAge * 0.085))
                          );
                          g.endFill();
                        }
                      }
                    }
                    if (!isGroundVehicle) {
		                    g.beginFill(0x000000, isVisible ? footprint.alpha * 0.45 : footprint.alpha * 0.22);
                      g.drawEllipse(
                        -moveScreenVector.x * strideLift * tileSize * 0.008,
                        footprint.y - tileSize * 0.006,
                        footprint.rx * (0.56 + strideLift * 0.04),
                        footprint.ry * (0.46 - strideLift * 0.05)
                      );
		                    g.endFill();
                      if (movingThisUnit) {
                        const footSide = footGroundMotion.plantedSide;
                        const perpendicular = { x: -moveScreenVector.y, y: moveScreenVector.x };
                        const stepAlpha = 0.18 + footGroundMotion.plantStrength * 0.42;
                        const stepX = -moveScreenVector.x * tileSize * 0.028
                          + perpendicular.x * footSide * tileSize * 0.042;
                        const stepY = footprint.y - moveScreenVector.y * tileSize * 0.018
                          + perpendicular.y * footSide * tileSize * 0.022;
                        g.beginFill(0x2d2a21, stepAlpha);
                        g.drawEllipse(
                          stepX,
                          stepY,
                          tileSize * (0.035 + footGroundMotion.plantStrength * 0.03),
                          tileSize * (0.012 + footGroundMotion.plantStrength * 0.007)
                        );
                        g.endFill();
                        g.beginFill(0x887b5e, stepAlpha * 0.5);
                        g.drawEllipse(
                          stepX - moveScreenVector.x * tileSize * 0.028,
                          stepY - tileSize * 0.009,
                          tileSize * 0.014,
                          tileSize * 0.008
                        );
                        g.endFill();
                        g.lineStyle(0.7, 0xa99a76, stepAlpha * 0.32);
                        g.moveTo(stepX - moveScreenVector.x * tileSize * 0.05, stepY);
                        g.lineTo(stepX + moveScreenVector.x * tileSize * 0.02, stepY);
                        g.lineStyle();
                      }
                    }
                } else {
                  const shadowY = tileSize * 0.16;
                  g.beginFill(0x000000, 0.2);
                  // Offset down-right: light reads from upper-left across the scene, so cast there too.
                  g.drawEllipse(tileSize * 0.07, shadowY, tileSize * 0.34, tileSize * 0.16);
                  g.endFill();
                }
              }}
            />
            {(() => {
              const defId = definitionId;
              let texturePath = '/assets/generated/infantry_squad.png';
              let desiredH = tileSize * 0.45;
              let anchorY = 0.95;
              let canMirrorForFacing = true;
              const rasterOverridePath = rasterUnitOverride(defId);
              // Unique static art wins over generic vehicle sheets. Definitions with a dedicated
              // directional set, such as the supply truck, opt back into the motion renderer.
              const directionalSprite = unitDirectionalSprite;
              const isFootUnit = unitType === 'infantry' || (unitType === 'support' && !isSupportVehicle) || unitType === 'hero';
              const isVehicleUnit = isGroundVehicle;
              const footMovementDirection = directionNameForScreenVector(moveScreenVector);
              const readableFootMovementDirection = footMovementDirection === 'n'
                ? 'nw'
                : footMovementDirection === 's'
                  ? 'se'
                  : footMovementDirection;
              const turnDirections = isVehicleUnit
                && turningThisUnit
                && directionalSprite
                && vehicleTurnFromOrientation !== null
                && vehicleTurnToOrientation !== null
                ? vehicleTurnBlend ?? vehicleTurnSheetBlend(
                    vehicleTurnFromOrientation,
                    vehicleTurnToOrientation,
                    directionalSprite,
                    vehicleTurnProgress,
                    vehicleTurnDirection
                  )
                : null;
              const spriteDirection = turnDirections?.from
                ?? (isVehicleUnit && directionalSprite === 'm113_apc'
                  ? vehicleSheetDirectionNameForOrientation(animatedOrientation, directionalSprite)
                  : isVehicleUnit && movingThisUnit
                    ? vehicleSheetDirectionNameForScreenVector(moveScreenVector, directionalSprite ?? '')
                    : isVehicleUnit
                      ? vehicleSheetDirectionNameForOrientation(animatedOrientation, directionalSprite ?? '')
                      : movementTransitionActive
                        ? readableFootMovementDirection
                        : directionNameForOrientation(animatedOrientation));
              const usesDirectionalMotion = Boolean(directionalSprite && (isFootUnit || isVehicleUnit));
              const sheetState = !initialTurnThisUnit && (movementTransitionActive || turningThisUnit) && usesDirectionalMotion
                ? 'walk'
                : 'idle';
              const textureSheetState = directionalSprite === 'apc_directional' ? 'idle' : sheetState;
              const animatesVehicleFrames = isVehicleUnit && directionalSprite !== 'apc_directional';
              const sheetFrame = textureSheetState === 'walk' && (!isVehicleUnit || animatesVehicleFrames)
                ? Math.floor((((locomotionPhase % 1) + 1) % 1) * 4)
                : 0;
              let texture: Texture | null = null;
              let settlingTexture: Texture | null = null;
              let incomingTurnTexture: Texture | null = null;

              if (directionalSprite) {
                desiredH = unitVisualHeight(tileSize, unitType, defId, directionalSprite);
                anchorY = DIRECTIONAL_UNIT_ANCHOR_Y[directionalSprite] ?? 0.9;
                canMirrorForFacing = false;
                const walkSheetPath = directionalUnitSheetPath(directionalSprite, 'walk');
                if (!unitTextureCache.has(walkSheetPath)) {
                  unitTextureCache.set(walkSheetPath, crispTexture(Texture.from(walkSheetPath)));
                }
                const standaloneIdlePath = directionalSprite === 'light_infantry'
                  ? lightInfantryIdlePath(spriteDirection)
                  : null;
                texture = standaloneIdlePath && textureSheetState === 'idle'
                  ? (unitTextureCache.get(standaloneIdlePath) ?? crispTexture(Texture.from(standaloneIdlePath)))
                  : unitSheetTexture(unitTextureCache, directionalSprite, textureSheetState, spriteDirection, sheetFrame);
                if (turnDirections && turnDirections.to !== turnDirections.from) {
                  incomingTurnTexture = unitSheetTexture(
                    unitTextureCache,
                    directionalSprite,
                    textureSheetState,
                    turnDirections.to,
                    sheetFrame
                  );
                }
                if (movementTransitionActive && !movingThisUnit && !turningThisUnit) {
                  settlingTexture = standaloneIdlePath
                    ? (unitTextureCache.get(standaloneIdlePath) ?? crispTexture(Texture.from(standaloneIdlePath)))
                    : unitSheetTexture(unitTextureCache, directionalSprite, 'idle', spriteDirection, 0);
                }
              } else if (unitType === 'vehicle') {
                desiredH = unitVisualHeight(tileSize, unitType, defId);
                anchorY = 0.95;
                if (defId.includes('apc') || defId.includes('ifv') || defId.includes('m113')) {
                  texturePath = '/assets/generated/apc_m113.png';
                } else if (defId.includes('tank') || defId.includes('abrams') || defId.includes('m1')) {
                  texturePath = '/assets/generated/tank_m1_abrams.png';
                } else if (defId.includes('artillery') || defId.includes('mlrs') || defId.includes('howitzer')) {
                  texturePath = '/assets/generated/artillery_mlrs.png';
                } else if (defId.includes('heli') || defId.includes('apache') || defId.includes('chopper')) {
                  texturePath = '/assets/generated/helicopter_apache.png';
                } else {
                  texturePath = isFriendly ? '/assets/generated/tank_m1_abrams.png' : '/assets/generated/apc_m113.png';
	                }
	              } else if (unitType === 'infantry') {
	                desiredH = unitVisualHeight(tileSize, unitType, defId);
	                if (isFriendly) {
	                  if (defId.includes('sniper') || defId.includes('scout')) {
	                    texturePath = '/assets/generated/sniper_team.png';
                  } else if (defId.includes('medic') || defId.includes('doctor')) {
                    texturePath = '/assets/generated/medic_unit.png';
                  } else {
	                    texturePath = '/assets/generated/infantry_squad.png';
	                  }
	                } else {
	                  if (defId.includes('ghoul') || defId.includes('zombie') || defId.includes('undead')) {
	                    texturePath = '/assets/generated/ghoul_pack.png';
	                  } else if (defId.includes('skeleton') || defId.includes('bone')) {
	                    texturePath = '/assets/generated/skeleton_warrior.png';
	                  } else if (defId.includes('golem')) {
	                    texturePath = '/assets/generated/bone_golem.png';
	                  } else if (defId.includes('ogre') || defId.includes('brute') || defId.includes('troll')) {
	                    texturePath = '/assets/generated/ogre_brute.png';
	                  } else if (defId.includes('orc')) {
	                    texturePath = '/assets/generated/skeleton_warrior.png';
                  } else {
                    texturePath = '/assets/generated/skeleton_warrior.png';
	                  }
	                }
	              } else if (unitType === 'support') {
	                desiredH = unitVisualHeight(tileSize, unitType, defId);
	                if (isFriendly) {
	                  if (defId.includes('truck')) {
	                    anchorY = 0.95;
	                    texturePath = '/assets/generated/apc_m113.png';
	                  } else {
                    texturePath = defId.includes('medic') ? '/assets/generated/medic_unit.png' : '/assets/generated/infantry_squad.png';
                  }
                } else {
                  texturePath = defId.includes('warlock') || defId.includes('necromancer') || defId.includes('lich')
                    ? '/assets/generated/necromancer.png'
	                    : '/assets/generated/skeleton_warrior.png';
	                }
	              } else if (unitType === 'artillery') {
	                desiredH = unitVisualHeight(tileSize, unitType, defId);
	                texturePath = isFriendly ? '/assets/generated/artillery_mlrs.png' : '/assets/generated/watchtower.png';
	              } else if (unitType === 'air') {
	                desiredH = unitVisualHeight(tileSize, unitType, defId);
	                anchorY = 0.85;
	                texturePath = isFriendly
	                  ? '/assets/generated/helicopter_apache.png'
	                  : '/assets/generated/black_angel.png';
	              } else if (unitType === 'hero') {
	                desiredH = unitVisualHeight(tileSize, unitType, defId);
	                if (isFriendly) {
	                  texturePath = '/assets/generated/infantry_squad.png';
                } else {
                  if (defId.includes('knight') || defId.includes('death')) {
                    texturePath = '/assets/generated/death_knight.png';
                  } else {
                    texturePath = '/assets/generated/necromancer.png';
                  }
                }
              }

              // Per-unit unique sprite (generated art) overrides the type-branch fallback above.
              if (!directionalSprite && rasterOverridePath) {
                texturePath = rasterOverridePath;
              }

              if (!texture) {
                texture = unitTextureCache.get(texturePath) ?? null;
                if (!texture) {
                  texture = crispTexture(Texture.from(texturePath));
                  unitTextureCache.set(texturePath, texture);
                }
              }
              if (!directionalSprite) {
                anchorY = RASTER_UNIT_ANCHOR_Y[texturePath] ?? anchorY;
              }
              const sourceHeight = directionalSprite ? (DIRECTIONAL_UNIT_SOURCE_HEIGHTS[directionalSprite] ?? 128) : (RASTER_UNIT_VISIBLE_HEIGHTS[texturePath] ?? 1024);
              const baseScale = desiredH / sourceHeight;
              const groundOffsetY = directionalSprite
                ? directionalSpriteGroundOffset(directionalSprite, textureSheetState, spriteDirection, baseScale) + (DIRECTIONAL_UNIT_GROUND_BIAS[directionalSprite] ?? 0)
                : 0;
              const incomingTurnGroundOffsetY = directionalSprite && turnDirections
                ? directionalSpriteGroundOffset(directionalSprite, textureSheetState, turnDirections.to, baseScale) + (DIRECTIONAL_UNIT_GROUND_BIAS[directionalSprite] ?? 0)
                : groundOffsetY;
              const turnCrossfade = incomingTurnTexture
                ? vehicleTurnCrossfade(turnDirections?.progress ?? vehicleTurnProgress)
                : { outgoingAlpha: 1, incomingAlpha: 0 };
              const outgoingTurnRotation = incomingTurnTexture
                ? vehicleTurnRotation(turnDirections?.progress ?? vehicleTurnProgress, vehicleTurnDirection, false)
                : 0;
              const incomingTurnRotation = incomingTurnTexture
                ? vehicleTurnRotation(turnDirections?.progress ?? vehicleTurnProgress, vehicleTurnDirection, true)
                : 0;
              const turnScaleX = incomingTurnTexture
                ? vehicleTurnScaleX(turnDirections?.progress ?? vehicleTurnProgress)
                : 1;
              const turnScaleY = incomingTurnTexture
                ? vehicleTurnScaleY(turnDirections?.progress ?? vehicleTurnProgress)
                : 1;
              const vehiclePose = isVehicleUnit && canMirrorForFacing ? rasterVehiclePose(moveScreenVector) : null;
              const facingLeft = vehiclePose ? vehiclePose.mirrored : canMirrorForFacing && animatedOrientation >= 3 && animatedOrientation <= 5;
              // Vehicles carry weight: a road shake + suspension dip while moving (driven by fastWave,
              // which is only non-zero in motion — so idle vehicles sit still rather than statically skewed).
              const vehicleTrackJitter = isVehicleUnit && movingThisUnit ? 0.42 * vehicleMotionIntensity : 0;
              const vehicleRumbleY = isVehicleUnit ? Math.abs(fastWave) * 0.38 * vehicleMotionIntensity : 0;
              // Suppressed/routed posture: a small downward duck, a foot-unit shudder, and (when routed)
              // a lean away from the threat — so a pinned squad reads at a glance without a label.
              const suppressed = unit.stance === 'suppressed';
              const routed = unit.stance === 'routed';
              const cowed = suppressed || routed;
              const cowerShudder = cowed && isFootUnit ? Math.sin(now / 90) * 1.1 : 0;
              const spriteBobY = (isFootUnit ? footGroundMotion.spriteBobY : unitType === 'air' ? stepWave * 1.4 : -vehicleRumbleY);
              const spriteSwayX = (isFootUnit ? footGroundMotion.spriteSwayX : isVehicleUnit ? moveScreenVector.x * vehicleTrackJitter : 0) + hitOffsetX + shotOffsetX + cowerShudder;
              const spriteCombatY = hitOffsetY + shotOffsetY + (cowed && isFootUnit ? Math.sin(now / 60) * 0.6 : 0);
              const locomotionRotation = isFootUnit && movingThisUnit
                ? -moveScreenVector.x * stepWave * 0.038
                : isVehicleUnit && movingThisUnit ? fastWave * 0.004 * vehicleMotionIntensity : 0;
              const spriteRotation = (vehiclePose ? vehiclePose.rotation : 0) + locomotionRotation + (routed ? -Math.sign(moveScreenVector.x || 1) * 0.12 : 0);
              const outgoingSpriteRotation = spriteRotation + outgoingTurnRotation;
              const incomingSpriteRotation = spriteRotation + incomingTurnRotation;
              // Volume-preserving impact squash: the struck unit compresses vertically / bulges wide at
              // the moment of contact and springs back as the hit pulse decays. Vehicles jello half as much.
              const hitSquash = incomingHit ? Math.sin(Math.min(1, hitElapsed / 180) * Math.PI) * hitPulse : 0;
              const squashAmt = (unitType === 'vehicle' || unitType === 'artillery') ? 0.5 : 1;
              const squashX = (isFootUnit ? 1 + stepWave * 0.024 : 1) * (cowed ? 1.04 : 1) * (1 + hitSquash * 0.16 * squashAmt);
              const squashY = (isFootUnit ? 1 - stepWave * 0.02 : 1) * (cowed ? 0.9 : 1) * (1 - hitSquash * 0.20 * squashAmt);
              const scaleX = (facingLeft ? -baseScale : baseScale) * squashX * turnScaleX;
              const scaleY = baseScale * squashY * turnScaleY;
              // The live sprite holds a short hit reaction before the authored corpse or wreck takes over.
              // Infantry topple, undead/demons lift, and vehicles hand off to the wreck marker. Reduced
              // motion keeps the hold and cut without the transform.
              const deathMs = dyingShown ? killingReactionElapsed : 0;
              const dProg = clamp01(deathMs / DEATH_REACTION_HOLD_MS);
              const dEase = prefersReducedMotion ? 0 : easeOutCubic(dProg);
              const isUndeadDemon = isGhoulPack
                || definitionId.includes('demon') || definitionId.includes('imp') || definitionId.includes('specter')
                || definitionId.includes('wraith') || definitionId.includes('angel') || definitionId.includes('drake')
                || definitionId.includes('fiend') || definitionId.includes('warlock') || definitionId.includes('lich')
                || definitionId.includes('skeleton') || definitionId.includes('harpy') || definitionId.includes('salamander');
              const deathReacting = dyingShown && deathMs >= 0;
              const dyingFoot = deathReacting && isFootUnit && !isUndeadDemon;
              const dyingSpook = deathReacting && isUndeadDemon;
              // infantry: topple away from the shot, sink, vertical-squash
              const toppleSign = -Math.sign(incomingDir.x || 1);
              const deathRotation = dyingFoot ? toppleSign * dEase * 0.85 : 0;
              const deathSinkY = dyingFoot ? dEase * tileSize * 0.18 : (dyingSpook ? -dEase * tileSize * 0.22 : 0);
              const deathScaleY = dyingFoot ? (1 - dEase * 0.32) : 1;
              const deathScaleX = dyingSpook ? (1 - dEase * 0.25) : 1;
              const deathAlphaMul = deathReacting ? deathReactionAlpha(deathMs) : 1;
              const deathTint = !deathReacting ? null
                : dyingSpook ? mixColor(0x6b5a52, definitionId.includes('skeleton') || isGhoulPack ? 0x6f7d6a : 0x9a3326, dEase)
                : dyingFoot ? mixColor(0x6b5a52, 0x4a3a34, dEase)
                : 0x6b5a52;
              const spriteTint = directionalSprite === 'm113_apc'
                ? 0xf1e6b8
                : directionalSprite === 'apc_directional'
                  ? 0xe3dfc1
                : isFriendly
                  ? 0xe9e6d7
                  : isUndeadDemon
                    ? 0xdacbb6
                    : 0xe3d8c7;
              const spriteBaseY = directionalSprite ? 0 : tileSize * (isVehicleUnit ? 0.082 : 0.05);
              unitSpriteTopY = spriteBaseY + groundOffsetY - anchorY * desiredH;
              unitVisibleTopY = unitSpriteTopY + spriteContentTopFrac(texture) * desiredH;
              const silhouetteAlpha = readableInFog
                ? (isGroundVehicle ? 0.5 : 0.62)
                : isVisible && isGroundVehicle
                  ? (directionalSprite === 'm113_apc' ? 0.38 : 0.24)
                : isVisible && isFootUnit
                  ? 0.32
                  : 0;
              const silhouetteTint = 0x050605;
              const silhouetteScale = readableInFog ? 1.07 : isGroundVehicle ? 1.045 : 1.025;
              const unitSpriteAlpha = (isFriendly ? 1 : isVisible ? 1 : 0.72) * deathAlphaMul;
              const unitSpriteTint = deathTint !== null ? deathTint : suppressed ? 0xb9b2a4 : routed ? 0xc7a39c : spriteTint;
              return (
                <>
                  {silhouetteAlpha > 0 ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * silhouetteScale, y: scaleY * (readableInFog ? 1.05 : 1.02) }}
                      alpha={silhouetteAlpha * turnCrossfade.outgoingAlpha}
                      tint={silhouetteTint}
                      x={spriteSwayX + (facingLeft ? -0.9 : 0.9)}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY + (readableInFog ? 1.4 : 1.1)}
                      rotation={outgoingSpriteRotation}
                      zIndex={0.8}
                    />
                  ) : null}
                  {silhouetteAlpha > 0 && incomingTurnTexture ? (
                    <Sprite
                      texture={incomingTurnTexture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * silhouetteScale, y: scaleY * (readableInFog ? 1.05 : 1.02) }}
                      alpha={silhouetteAlpha * turnCrossfade.incomingAlpha}
                      tint={silhouetteTint}
                      x={spriteSwayX + (facingLeft ? -0.9 : 0.9)}
                      y={spriteBaseY + incomingTurnGroundOffsetY + spriteBobY + spriteCombatY + (readableInFog ? 1.4 : 1.1)}
                      rotation={incomingSpriteRotation}
                      zIndex={0.81}
                    />
                  ) : null}
                  {isFootUnit && isVisible ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.01, y: scaleY * 1.01 }}
                      alpha={0.11}
                      tint={0xe5dbc4}
                      x={spriteSwayX + (facingLeft ? 0.45 : -0.45)}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY - 0.9}
                      rotation={outgoingSpriteRotation}
                      zIndex={0.9}
                    />
                  ) : null}
                  <Sprite
                    texture={texture}
                    anchor={{ x: 0.5, y: anchorY }}
                    scale={{ x: scaleX * deathScaleX, y: scaleY * deathScaleY }}
                    alpha={unitSpriteAlpha * turnCrossfade.outgoingAlpha}
                    tint={unitSpriteTint}
                    x={spriteSwayX}
                    y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY + deathSinkY}
                    rotation={outgoingSpriteRotation + deathRotation}
                    zIndex={1}
                  />
                  {incomingTurnTexture ? (
                    <Sprite
                      texture={incomingTurnTexture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * deathScaleX, y: scaleY * deathScaleY }}
                      alpha={unitSpriteAlpha * turnCrossfade.incomingAlpha}
                      tint={unitSpriteTint}
                      x={spriteSwayX}
                      y={spriteBaseY + incomingTurnGroundOffsetY + spriteBobY + spriteCombatY + deathSinkY}
                      rotation={incomingSpriteRotation + deathRotation}
                      zIndex={1.01}
                    />
                  ) : null}
                  {isVehicleUnit
                    && (movingThisUnit || turningThisUnit)
                    && runningGearKind ? (
                    <Graphics
                      zIndex={1.04}
                      draw={(g) => {
                        g.clear();
                        const forwardX = moveScreenVector.x;
                        const forwardY = moveScreenVector.y;
                        const sideX = -forwardY;
                        const sideY = forwardX;
                        if (runningGearKind === 'tracked') {
                          const trackLength = tileSize * (directionalSprite === 'tank_directional' ? 0.155 : 0.14);
                          const trackGap = tileSize * 0.06;
                          const trackY = groundOffsetY - tileSize * (directionalSprite === 'tank_directional' ? 0.068 : 0.078);
                          for (let sideIndex = -1; sideIndex <= 1; sideIndex += 2) {
                            const offsetX = sideX * trackGap * sideIndex;
                            const offsetY = sideY * trackGap * sideIndex * 0.34;
                            for (let treadIndex = 0; treadIndex < 7; treadIndex += 1) {
                              const amount = ((treadIndex + runningGearPhase) % 7) / 6;
                              const along = -trackLength + amount * trackLength * 2;
                              const treadX = offsetX + forwardX * along;
                              const treadY = trackY + offsetY + forwardY * along * 0.34;
                              const treadHalf = Math.max(1.15, tileSize * 0.021);
                              g.lineStyle(
                                1.05,
                                treadIndex % 2 === 0
                                  ? (isFriendly ? 0xa8a17c : 0x9a755f)
                                  : (isFriendly ? 0x817f63 : 0x765b4f),
                                (0.42 + vehicleMotionIntensity * 0.28) * vehicleMotionIntensity
                              );
                              g.moveTo(treadX - sideX * treadHalf, treadY - sideY * treadHalf * 0.38);
                              g.lineTo(treadX + sideX * treadHalf, treadY + sideY * treadHalf * 0.38);
                            }
                          }
                        } else {
                          const wheelFootprintRx = tileSize * (unitType === 'artillery' ? 0.3 : 0.31);
                          const wheelFootprintRy = tileSize * (unitType === 'artillery' ? 0.075 : 0.082);
                          const contactY = tileSize * (unitType === 'artillery' ? 0.064 : 0.039);
                          const wheelGap = wheelFootprintRy * 0.78;
                          const wheelAngle = runningGearPhase * Math.PI * 2;
                          for (const axlePosition of WHEELED_AXLE_POSITIONS) {
                            for (let sideIndex = -1; sideIndex <= 1; sideIndex += 2) {
                              const wheelX = forwardX * wheelFootprintRx * axlePosition + sideX * wheelGap * sideIndex;
                              const wheelY = contactY + forwardY * wheelFootprintRx * axlePosition * 0.2 + sideY * wheelGap * sideIndex;
                              const radiusX = wheelFootprintRx * 0.065;
                              const radiusY = Math.max(0.7, wheelFootprintRy * 0.13);
                              const spokeAngle = wheelAngle + axlePosition * Math.PI;
                              g.lineStyle(
                                1.05,
                                0xd0c294,
                                (0.54 + vehicleMotionIntensity * 0.34) * vehicleMotionIntensity
                              );
                              g.moveTo(
                                wheelX - Math.cos(spokeAngle) * radiusX,
                                wheelY - Math.sin(spokeAngle) * radiusY
                              );
                              g.lineTo(
                                wheelX + Math.cos(spokeAngle) * radiusX,
                                wheelY + Math.sin(spokeAngle) * radiusY
                              );
                              g.beginFill(0x292a22, 0.76 * vehicleMotionIntensity);
                              g.drawCircle(wheelX, wheelY, 0.7);
                              g.endFill();
                            }
                          }
                        }
                      }}
                    />
                  ) : null}
                  {settlingTexture ? (
                    <Sprite
                      texture={settlingTexture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * deathScaleX, y: scaleY * deathScaleY }}
                      alpha={deathAlphaMul}
                      tint={spriteTint}
                      x={spriteSwayX}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY + deathSinkY}
                      rotation={outgoingSpriteRotation + deathRotation}
                      zIndex={readableInFog ? 1.12 : 0.98}
                    />
                  ) : null}
                  {outgoingShot ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.018, y: scaleY * 1.018 }}
                      alpha={0.36 * shotPulse}
                      tint={0xffd46d}
                      x={spriteSwayX}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY}
                      rotation={outgoingSpriteRotation}
                      zIndex={1.18}
                    />
                  ) : null}
                  {incomingHit && isVehicleUnit ? (
                    <Graphics
                      zIndex={1.24}
                      draw={(g) => {
                        g.clear();
                        const alpha = Math.max(0, Math.min(1, hitPulse));
                        if (alpha <= 0) return;
                        const impactX = -incomingDir.x * tileSize * 0.16;
                        const impactY = spriteBaseY + groundOffsetY + spriteCombatY - tileSize * 0.11 - incomingDir.y * tileSize * 0.05;
                        const spark = tileSize * (0.045 + alpha * 0.035);
                        g.lineStyle(Math.max(1, tileSize * 0.018), incomingHit.type === 'magic' ? 0xc58cff : 0xffe3a1, 0.72 * alpha);
                        g.moveTo(impactX - spark, impactY);
                        g.lineTo(impactX + spark, impactY);
                        g.moveTo(impactX, impactY - spark * 0.65);
                        g.lineTo(impactX, impactY + spark * 0.65);
                        g.lineStyle(Math.max(1, tileSize * 0.012), 0xf2d8a7, 0.48 * alpha);
                        g.drawCircle(impactX, impactY, spark * 0.34);
                      }}
                    />
                  ) : incomingHit ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.01, y: scaleY * 1.01 }}
                      alpha={Math.min(dyingShown ? 1 : 0.95, 0.38 * hitPulse + (dyingShown ? 0.9 : 0.85) * impactFlash)}
                      tint={incomingHit.type === 'magic' ? 0xc58cff : impactFlash > 0.6 ? 0xf2d8a7 : 0xffe3a1}
                      x={spriteSwayX}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY}
                      rotation={outgoingSpriteRotation}
                      zIndex={1.2}
                    />
                  ) : null}
                </>
              );
            })()}
            {false && (
              <Graphics
                zIndex={1}
                draw={(g) => {
                  g.clear();

                  // debug: unit origin marker
                  if (DEBUG_ALIGN) {
                    g.lineStyle(0);
                    g.beginFill(0xff0000, 0.9);
                    g.drawCircle(0, 0, 1.6);
                    g.endFill();
                  }

                  // pseudo-3D extruded unit (AoE2-like)
                  g.lineStyle(1, 0x000000, 0.55);
                  const H = capHeight;

                  const sCap = (tileSize / 2) * k; const hwCap = (hexWidth / 2) * k;
                  const cap = ISO_MODE && geom
                    ? geom.inset(k)
                    : [
                        { x: 0, y: -sCap },
                        { x: hwCap, y: -sCap / 2 },
                        { x: hwCap, y:  sCap / 2 },
                        { x: 0, y:  sCap },
                        { x: -hwCap, y:  sCap / 2 },
                        { x: -hwCap, y: -sCap / 2 }
                      ];

                  // side faces (only for ground units)
                  if (unitType !== 'air') {
                    if (ISO_MODE) {
                      // right (E) face - darker
                      g.beginFill(0x000000, 0.35);
                      g.moveTo(cap[1].x, cap[1].y);
                      g.lineTo(cap[2].x, cap[2].y);
                      g.lineTo(cap[2].x, cap[2].y + H);
                      g.lineTo(cap[1].x, cap[1].y + H);
                      g.closePath();
                      g.endFill();

                      // bottom (S) face - mid
                      g.beginFill(0x000000, 0.22);
                      g.moveTo(cap[2].x, cap[2].y);
                      g.lineTo(cap[3].x, cap[3].y);
                      g.lineTo(cap[3].x, cap[3].y + H);
                      g.lineTo(cap[2].x, cap[2].y + H);
                      g.closePath();
                      g.endFill();
                    } else {
                      // right (SE) face - darker
                      g.beginFill(0x000000, 0.35);
                      g.moveTo(cap[2].x, cap[2].y);
                      g.lineTo(cap[3].x, cap[3].y);
                      g.lineTo(cap[3].x, cap[3].y + H);
                      g.lineTo(cap[2].x, cap[2].y + H);
                      g.closePath();
                      g.endFill();

                      // left (SW) face - mid
                      g.beginFill(0x000000, 0.22);
                      g.moveTo(cap[3].x, cap[3].y);
                      g.lineTo(cap[4].x, cap[4].y);
                      g.lineTo(cap[4].x, cap[4].y + H);
                      g.lineTo(cap[3].x, cap[3].y + H);
                      g.closePath();
                      g.endFill();
                    }
                  }

                  // top face (team color)
                  g.beginFill(color, 1);
                  drawPoly(g as PixiGraphics, cap);
                  g.endFill();

                  // subtle rim highlights
                  g.lineStyle(1, 0xffffff, 0.12);
                  g.moveTo(cap[0].x, cap[0].y); g.lineTo(cap[1].x, cap[1].y); g.lineTo(cap[2].x, cap[2].y);
                  g.lineStyle(1, 0x000000, 0.38);
                  if (ISO_MODE) {
                    g.moveTo(cap[2].x, cap[2].y); g.lineTo(cap[3].x, cap[3].y);
                  } else {
                    g.moveTo(cap[3].x, cap[3].y); g.lineTo(cap[4].x, cap[4].y);
                  }
                }}
              />
            )}
            <Graphics
              zIndex={2}
              draw={(g) => {
                g.clear();
                if (dyingShown) return;

                // stance ring — pulse it so a pinned/routed unit draws the eye
                const stance = unit.stance;
                if (unit.sensorDeployed) {
                  const sensorPulse = prefersReducedMotion ? 0.7 : 0.58 + Math.sin(now / 360) * 0.16;
                  g.lineStyle(1.4, 0x72d9c9, sensorPulse);
                  g.drawEllipse(0, tileSize * 0.02, tileSize * 0.4, tileSize * 0.17);
                  g.lineStyle(1, 0xc8fff3, sensorPulse * 0.72);
                  g.drawCircle(0, tileSize * 0.02, tileSize * 0.2);
                }
                if (stance === 'suppressed' || stance === 'routed') {
                  const ringA = 0.55 + Math.sin(now / 200) * 0.35;
                  g.lineStyle(2, stance === 'routed' ? 0xff2d55 : 0xffc107, ringA);
                  g.drawCircle(0, 0, tileSize * 0.29);
                }
                const ent = unit.entrench ?? 0;
                if (ent > 0) {
                  g.lineStyle(0);
                  g.beginFill(isFriendly ? 0x8bb6c8 : 0xb58a63, 0.74);
                  const pipW = 4; const gap = 2; const totalW = ent * pipW + (ent - 1) * gap; let startX = -totalW / 2;
                  for (let i = 0; i < ent; i++) { g.drawRect(startX, -tileSize * 0.43, pipW, 2); startX += pipW + gap; }
                  g.endFill();
                }
                const maxHp = unit.stats.maxHealth ?? 100;
                const hpRatio = Math.max(0, Math.min(1, unit.currentHealth / maxHp));
                const mrRatio = Math.max(0, Math.min(1, unit.currentMorale / 100));
                const apRatio = Math.max(0, Math.min(1, unit.actionPoints / (unit.maxActionPoints ?? 10)));
                const recentlyActive = Boolean(outgoingShot || incomingHit || recentAttackSource || recentHitTarget);
                const shouldDrawStatus = isFriendly // always mark our own units so they're locatable on busy terrain
                  || isSelected
                  || isSelectedCarrier
                  || isTarget
                  || recentlyActive
                  || hpRatio < 0.9
                  || ((isFriendly || isSelected || isTarget) && apRatio < 0.985)
                  || mrRatio < 0.8
                  || stance === 'suppressed'
                  || stance === 'routed';
                if (!shouldDrawStatus) return;
                const compactDeployStatus = deployMode && isFriendly && !isSelected && !isSelectedCarrier;
                const movingVehicleUiDamping = movingThisUnit && isGroundVehicle ? 0.68 : 1;
                const detailedBar = (isSelected || isTarget) && !compactDeployStatus && !isGroundVehicle;
                const bw = detailedBar
                  ? (unitType === 'infantry' || unitType === 'hero' || unitType === 'support' ? 18 : isGroundVehicle ? 20 : 23)
                  : (unitType === 'infantry' || unitType === 'hero' || unitType === 'support' ? 12 : isGroundVehicle ? 13 : 16);
                // Anchor the status bar a fixed clearance above each unit's *visible* head, which
                // spriteContentTopFrac derives per texture — so the bar hugs every unit type the
                // same way regardless of how much transparent padding its sheet carries on top.
                const topY = Math.min(-tileSize * 0.13, unitVisibleTopY - tileSize * 0.06);
                const vehicleStatusAlpha = isGroundVehicle ? 0.66 : 1;
                const passiveStatusAlpha = recentlyActive ? 0.92 : 0.82;
                const backplateAlpha = (isSelected ? 0.88 : isTarget ? 0.82 : isFriendly ? 0.66 : 0.68) * movingVehicleUiDamping * vehicleStatusAlpha * passiveStatusAlpha;
                const barAlpha = (isSelected ? 0.98 : isTarget ? 0.94 : isFriendly ? 0.9 : 0.92) * movingVehicleUiDamping * vehicleStatusAlpha * passiveStatusAlpha;
                const backplateH = detailedBar ? 6 : 4;
                if (hpRatio <= 0.3) {
                  // Low-health warning: a compact amber "!" just above the bar. It's anchored to the
                  // bar top (not a fixed tile offset) so it tracks the unit, and drawn as a real stem +
                  // gap + dot — the previous version overlapped into a solid blob. The red HP bar still
                  // carries the exact value.
                  const criticalPulse = 0.76 + Math.sin(now / 120) * 0.2;
                  const exTop = topY - backplateH - 10;
                  g.lineStyle(0.5, 0x2a1a06, 0.9);
                  g.beginFill(0xffc24a, criticalPulse * 0.95);
                  g.drawRect(-1, exTop, 2, 5.5);
                  g.drawRect(-1, exTop + 7, 2, 2);
                  g.endFill();
                  g.lineStyle(0);
                }
                g.lineStyle(1, 0x050708, 0.65);
                g.beginFill(0x101417, backplateAlpha);
                g.drawRoundedRect(-bw / 2 - 1, topY - backplateH, bw + 2, backplateH, 1);
                g.endFill();
                g.beginFill(factionAccent, isSelected || isTarget ? 0.88 : isFriendly ? 0.72 : 0.86);
                g.drawRect(isFriendly ? -bw / 2 - 3 : bw / 2 + 1, topY - backplateH, isFriendly ? 2 : 3, backplateH);
                g.endFill();

                if (!isFriendly) {
                  g.lineStyle(1, factionAccent, isTarget ? 0.58 : 0.44);
                  g.drawRoundedRect(-bw / 2 - 1, topY - backplateH, bw + 2, backplateH, 1);
                }

                const flagY = topY - backplateH - (isFriendly ? 5 : 7);
                if (isFriendly) {
                  const markerW = isSelected ? (isGroundVehicle ? 4.6 : 7) : 5;
                  const markerDrop = isSelected ? (isGroundVehicle ? 3.8 : 7) : 5;
                  const sel = isSelected || isSelectedCarrier;
                  const baseA = (sel ? (isGroundVehicle ? 0.6 : 0.96) : 0.74) * movingVehicleUiDamping;
                  const tipY = flagY + 5;                 // bottom point (aimed at the unit)
                  const topY = flagY + 5 - markerDrop;     // top base
                  // soft drop shadow lifts the chevron off the status plate
                  g.lineStyle(0);
                  g.beginFill(0x05141a, 0.26 * movingVehicleUiDamping);
                  g.moveTo(0, tipY + 1.1); g.lineTo(-markerW - 0.6, topY + 1.1); g.lineTo(markerW + 0.6, topY + 1.1); g.closePath();
                  g.endFill();
                  // body: darker base then a brighter top wedge → top-lit gradient instead of flat neon
                  g.beginFill(shade(factionAccent, sel ? 0.72 : 0.6), baseA);
                  g.moveTo(0, tipY); g.lineTo(-markerW, topY); g.lineTo(markerW, topY); g.closePath();
                  g.endFill();
                  g.beginFill(shade(factionAccent, sel ? 1.18 : 1.0), baseA * 0.9);
                  g.moveTo(0, tipY - markerDrop * 0.42); g.lineTo(-markerW * 0.56, topY); g.lineTo(markerW * 0.56, topY); g.closePath();
                  g.endFill();
                  // dark outline + a bright top rim for a beveled edge
                  g.lineStyle((sel ? 1.1 : 0.8) * movingVehicleUiDamping, 0x07232c, (sel ? 0.7 : 0.5) * movingVehicleUiDamping);
                  g.moveTo(0, tipY); g.lineTo(-markerW, topY); g.lineTo(markerW, topY); g.closePath();
                  g.lineStyle((sel ? 1 : 0.7) * movingVehicleUiDamping, shade(factionAccent, 1.5), (sel ? 0.78 : 0.5) * movingVehicleUiDamping);
                  g.moveTo(-markerW, topY); g.lineTo(markerW, topY);
                } else if (isTarget) {
                  g.lineStyle(0.9, 0x1f0b09, 0.68);
                  g.beginFill(factionAccent, 0.72);
                  g.moveTo(0, flagY - 1);
                  g.lineTo(4, flagY + 4);
                  g.lineTo(0, flagY + 8);
                  g.lineTo(-4, flagY + 4);
                  g.closePath();
                  g.endFill();
                } else if (!isFriendly) {
                  g.lineStyle(0.8, 0x1f0b09, 0.34);
                  g.beginFill(0xad5145, 0.26);
                  g.moveTo(0, flagY + 1);
                  g.lineTo(3.6, flagY + 4.6);
                  g.lineTo(0, flagY + 8.2);
                  g.lineTo(-3.6, flagY + 4.6);
                  g.closePath();
                  g.endFill();
                }

                g.lineStyle(0);
                const hpBarH = detailedBar ? 2 : 3;
                const hpBarTop = topY - (detailedBar ? 6 : 4);
                g.beginFill(0x1a1d1f, 0.85 * barAlpha); g.drawRect(-bw / 2, hpBarTop, bw, hpBarH); g.endFill();
                const hpColor = hpRatio > 0.55 ? 0x7ec850 : hpRatio > 0.25 ? 0xe6b13e : 0xe2503f;
                const hpFillAlpha = hpRatio <= 0.3
                  ? 0.98 * barAlpha * (0.6 + Math.sin(now / 120) * 0.4) // pulse the bar itself when critical
                  : 0.98 * barAlpha;
                g.beginFill(hpColor, Math.max(0, hpFillAlpha)); g.drawRect(-bw / 2, hpBarTop, bw * hpRatio, hpBarH); g.endFill();

                if (detailedBar) {
                  g.beginFill(0x141414, 0.7 * barAlpha); g.drawRect(-bw / 2, topY - 3, bw, 1.4); g.endFill();
                  const mrColor = mrRatio > 0.55 ? 0xe6d472 : mrRatio > 0.25 ? 0xc2a85e : 0x9a7a5c;
                  g.beginFill(mrColor, 0.95 * barAlpha); g.drawRect(-bw / 2, topY - 3, bw * mrRatio, 1.4); g.endFill();

                  g.beginFill(0x141414, 0.7 * barAlpha); g.drawRect(-bw / 2, topY - 1.4, bw, 1.4); g.endFill();
                  g.beginFill(isFriendly ? 0x6fb6e6 : 0xd06250, 0.95 * barAlpha); g.drawRect(-bw / 2, topY - 1.4, bw * apRatio, 1.4); g.endFill();
                }
              }}
            />
            <Graphics
              zIndex={3}
              draw={(g) => {
                g.clear();
                if (dyingShown) return;
                const accent = isFriendly ? 0x76b7d7 : 0xad5145;
                const outline = isFriendly ? 0x071821 : 0x1f0b09;
                g.lineStyle(1.5, outline, 0.9);
                if (isTarget) {
                  const flagY = unitType === 'vehicle' || unitType === 'artillery' ? -tileSize * 0.4 : -tileSize * 0.38;
                  g.lineStyle(1.2, accent, 0.72);
                  g.moveTo(-5, flagY + 8); g.lineTo(-2, flagY + 5);
                  g.moveTo(5, flagY + 8); g.lineTo(2, flagY + 5);
                  g.moveTo(-5, flagY + 8); g.lineTo(-1, flagY + 8);
                  g.moveTo(5, flagY + 8); g.lineTo(1, flagY + 8);
                }
              }}
            />
          </Container>
        );
      })
    );
  }, [
    battleState.sides,
    activeMovementFrame,
    map.height,
    map.tiles,
    map.width,
    selectedUnitId,
    targetUnitId,
    attackEffects,
    DEBUG_ALIGN,
    deployMode,
    onSelectTile,
    onSelectUnit,
    onUnitHover,
    prefersReducedMotion,
    viewerFaction,
    visibleTiles,
    topGeomFor,
    unitTextureCache,
    movingUnit,
    now
  ]);

  // Attack effects rendering (muzzle flash, projectile trail, hit marker)
  const attackEffectSprites = useMemo(() => {
    if (!attackEffects || attackEffects.length === 0) return [];

    return attackEffects.map((effect) => {
      const elapsed = now - effect.startTime;
      const timing = combatEffectTiming(effect.type, effect.arc);
      const sourceVisible = effect.sourceVisible ?? true;
      const targetVisible = effect.targetVisible ?? true;
      if (elapsed < 0) return null;
      if (elapsed > timing.totalMs) return null;
      if (!sourceVisible && !targetVisible) return null;

      const fromPos = toScreen({ q: effect.fromQ, r: effect.fromR });
      const toPos = toScreen({ q: effect.toQ, r: effect.toR });

      // Get elevations
      const fromIdx = effect.fromR * map.width + effect.fromQ;
      const toIdx = effect.toR * map.width + effect.toQ;
      const fromGeom = ISO_MODE ? topGeomFor(effect.fromQ, effect.fromR) : null;
      const toGeom = ISO_MODE ? topGeomFor(effect.toQ, effect.toR) : null;
      const fromElev = fromGeom ? fromGeom.avgHeight : (map.tiles[fromIdx]?.elevation ?? 0);
      const toElev = toGeom ? toGeom.avgHeight : (map.tiles[toIdx]?.elevation ?? 0);

      const fromX = fromPos.x;
      const fromY = fromPos.y - fromElev * ELEV_Y_OFFSET;
      const toX = toPos.x;
      const toY = toPos.y - toElev * ELEV_Y_OFFSET;
      const shotDx = toX - fromX;
      const shotDy = toY - fromY;
      const shotLength = Math.max(1, Math.hypot(shotDx, shotDy));
      const shotUx = shotDx / shotLength;
      const shotUy = shotDy / shotLength;
      let targetUnit: UnitInstance | undefined;
      for (const side of Object.values(battleState.sides)) {
        const candidate = side.units.get(effect.targetId);
        targetUnit = candidate && !candidate.embarkedOn ? candidate : undefined;
        if (targetUnit) break;
      }
      const targetDefinitionId = String(targetUnit?.definitionId ?? '').toLowerCase();
      const targetUnitType = String(targetUnit?.unitType ?? '');
      const targetMaterial = targetUnitType === 'vehicle' || targetUnitType === 'artillery'
        ? 'armor'
        : targetDefinitionId.includes('skeleton') || targetDefinitionId.includes('ghoul') || targetDefinitionId.includes('undead') || targetDefinitionId.includes('orc')
          ? 'undead'
          : 'organic';

      const travel = Math.min(elapsed / timing.projectileMs, 1);
      const projX = fromX + (toX - fromX) * travel;
      const projY = fromY + (toY - fromY) * travel;

      // Infantry small-arms read as a short automatic burst rather than one round:
      // several staggered tracers + a flickering muzzle flash. A sniper/rail shot is ONE round.
      const isBurst = effect.type === 'gunshot' || effect.type === 'sniper';
      const firearmProfile = isBurst
        ? firearmVisualProfile(effect.type === 'sniper' ? 'sniper' : 'gunshot')
        : null;
      const BURST_ROUNDS = timing.burstRounds;
      const BURST_GAP = timing.burstGapMs;
      const BURST_FLIGHT = timing.burstFlightMs;
      let gunFlicker = 0;
      for (let k = 0; k < BURST_ROUNDS; k++) {
        const a = elapsed - k * BURST_GAP;
        if (a >= 0 && a <= firearmProfile!.muzzleFlashMs) {
          gunFlicker = Math.max(gunFlicker, 1 - a / firearmProfile!.muzzleFlashMs);
        }
      }

      const zIndex = 20000 + Math.round(Math.max(fromY, toY));

      return (
        <Container key={effect.id} zIndex={zIndex}>
          {sourceVisible && !isBurst && effect.type !== 'arrow' && effect.type !== 'fire' && elapsed < 620 && (
            <Graphics
              draw={(g) => {
                g.clear();
                const groundAlpha = 1 - elapsed / 620;
                const dx = toX - fromX;
                const dy = toY - fromY;
                const len = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / len;
                const uy = dy / len;
                const px = -uy;
                const py = ux;
                const start = effect.type === 'melee' ? 0.18 : 0.12;
                const end = effect.type === 'melee' ? 0.82 : 0.72;
                const sx = fromX + dx * start;
                const sy = fromY + dy * start + tileSize * 0.04;
                const ex = fromX + dx * end;
                const ey = fromY + dy * end + tileSize * 0.04;
                g.lineStyle(effect.type === 'melee' ? 5.2 : 2.8, 0x0a0805, 0.44 * groundAlpha);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
                g.lineStyle(effect.type === 'melee' ? 2.6 : 1.35, effect.type === 'magic' ? 0x8d5aa8 : 0xaa8b5a, 0.58 * groundAlpha);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
                if (effect.type === 'melee') {
                  g.beginFill(0x564331, 0.28 * groundAlpha);
                  g.drawEllipse(fromX - ux * tileSize * 0.06 + px * tileSize * 0.05, fromY + tileSize * 0.1 - uy * tileSize * 0.02 + py * tileSize * 0.05, tileSize * 0.14, tileSize * 0.045);
                  g.drawEllipse(toX - ux * tileSize * 0.1 - px * tileSize * 0.04, toY + tileSize * 0.09 - uy * tileSize * 0.03 - py * tileSize * 0.04, tileSize * 0.12, tileSize * 0.04);
                  g.endFill();
                }
              }}
            />
          )}

          {sourceVisible && effect.type !== 'melee' && effect.type !== 'arrow' && elapsed < 320 && (
            <Graphics
              x={fromX + shotUx * tileSize * 0.2}
              y={fromY - tileSize * 0.15 + shotUy * tileSize * 0.08}
              draw={(g) => {
                g.clear();
                // Firearms flicker the muzzle flash per burst round; others: single fading flash. Bows
                // (arrow) draw no muzzle at all — handled by excluding them above.
                const fade = isBurst
                  ? gunFlicker
                  : effect.type === 'explosion'
                    ? (elapsed <= 110 ? 1 : Math.max(0, 1 - (elapsed - 110) / 210))
                    : 1 - elapsed / 320;
                if (fade <= 0) return;
                const flashScale = isBurst ? 0.12 : effect.type === 'magic' ? 0.22 : effect.type === 'explosion' ? 0.08 : 0.52;
                const flashReach = isBurst ? 0.42 : effect.type === 'explosion' ? 0.5 : 0.5;
                const flashTail = isBurst ? 0.25 : effect.type === 'explosion' ? 0.28 : 0.38;
                const flashWidth = isBurst ? 0.055 : effect.type === 'explosion' ? 0.08 : 0.1;
                const flashSize = tileSize * flashScale * fade;
                const dx = toX - fromX;
                const dy = toY - fromY;
                const len = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / len;
                const uy = dy / len;
                const px = -uy;
                const py = ux;
                g.lineStyle(isBurst ? 3.2 : effect.type === 'explosion' ? 3 : 3.8, 0x120b05, 0.9 * fade);
                g.moveTo(-ux * tileSize * 0.14, -uy * tileSize * 0.14);
                g.lineTo(ux * tileSize * (isBurst ? 0.28 : 0.32), uy * tileSize * (isBurst ? 0.28 : 0.32));
                g.beginFill(effect.type === 'magic' ? 0xc779ff : 0xffe1a1, (isBurst ? 0.68 : 0.78) * fade);
                g.moveTo(ux * tileSize * 0.1, uy * tileSize * 0.1);
                g.lineTo(ux * tileSize * flashReach + px * tileSize * flashWidth, uy * tileSize * flashReach + py * tileSize * flashWidth);
                g.lineTo(ux * tileSize * flashTail - px * tileSize * flashWidth, uy * tileSize * flashTail - py * tileSize * flashWidth);
                g.closePath();
                g.endFill();
                g.lineStyle(0);
                g.beginFill(effect.type === 'magic' ? 0xc779ff : effect.type === 'explosion' ? 0xff8a24 : 0xffcf6a, 0.42 * fade);
                g.drawCircle(0, 0, flashSize * (isBurst ? 1.15 : effect.type === 'explosion' ? 1.5 : 1.9));
                g.endFill();
                g.beginFill(effect.type === 'magic' ? 0xaa44ff : effect.type === 'explosion' ? 0xffb13b : 0xffd57a, 0.95 * fade);
                g.drawCircle(0, 0, flashSize * (isBurst ? 0.72 : 1));
                g.endFill();
                g.beginFill(0xffedbd, 0.86 * fade);
                g.drawCircle(0, 0, flashSize * (isBurst ? 0.3 : effect.type === 'explosion' ? 0.34 : 0.46));
                g.endFill();
              }}
            />
          )}

          {sourceVisible && (isBurst ? elapsed < timing.projectileMs : travel < 1) && (
            <Graphics
              draw={(g) => {
                g.clear();
                if (isBurst) {
                  // Automatic burst (or a single sniper round): staggered tracer(s) in flight.
                  const dxb = toX - fromX;
                  const dyb = toY - fromY;
                  const lenb = Math.max(1, Math.hypot(dxb, dyb));
                  const pxb = -dyb / lenb;
                  const pyb = dxb / lenb;
                  for (let k = 0; k < BURST_ROUNDS; k++) {
                    const t = (elapsed - k * BURST_GAP) / BURST_FLIGHT;
                    if (t <= 0 || t >= 1) continue;
                    const jit = (((k * 37) % 7) - 3) * 0.7; // small per-round spread
                    const tail = Math.max(0, t - firearmProfile!.tailFraction);
                    const hx = fromX + dxb * t + pxb * jit;
                    const hy = fromY + dyb * t - tileSize * 0.15 + pyb * jit;
                    const lx = fromX + dxb * tail + pxb * jit;
                    const ly = fromY + dyb * tail - tileSize * 0.15 + pyb * jit;
                    g.lineStyle(firearmProfile!.sheathWidth, 0x080603, 0.82); g.moveTo(lx, ly); g.lineTo(hx, hy);
                    g.lineStyle(firearmProfile!.coreWidth, 0xc18739, 0.96); g.moveTo(lx, ly); g.lineTo(hx, hy);
                    g.lineStyle(firearmProfile!.highlightWidth, 0xffedc4, 1); g.moveTo(lx, ly); g.lineTo(hx, hy);
                    g.beginFill(0xe0a542, 0.82);
                    g.drawCircle(hx, hy, firearmProfile!.headRadius);
                    g.endFill();
                    g.beginFill(0xfff0ce, 0.98);
                    g.drawCircle(hx, hy, firearmProfile!.headRadius * 0.38);
                    g.endFill();
                  }
                  return;
                }
                // Indirect fire lobs the shell along a high parabola (peak at mid-flight); direct fire
                // stays roughly flat. arcAt() returns the extra upward lift for a given flight fraction.
                const arcHeight = effect.arc ? tileSize * (1.6 + Math.hypot(toX - fromX, toY - fromY) / (tileSize * 9)) : 0;
                const arcAt = (frac: number) => arcHeight * Math.sin(Math.max(0, Math.min(1, frac)) * Math.PI);
                const trailStart = Math.max(0, travel - (effect.arc ? ARTILLERY_TRAIL_FRACTION : 0.24));
                const sx = fromX + (toX - fromX) * trailStart;
                const sy = fromY + (toY - fromY) * trailStart - tileSize * 0.15 - arcAt(trailStart);
                const tx = projX;
                const ty = projY - tileSize * 0.15 - arcAt(travel);
                if (effect.arc) {
                  const trailSegments = 8;
                  g.lineStyle(5, 0x11100d, 0.62);
                  for (let s = 0; s <= trailSegments; s++) {
                    const f = trailStart + (travel - trailStart) * (s / trailSegments);
                    const x = fromX + (toX - fromX) * f;
                    const y = fromY + (toY - fromY) * f - tileSize * 0.15 - arcAt(f);
                    if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
                  }
                  g.lineStyle(2.2, 0xb6b19f, 0.72);
                  for (let s = 0; s <= trailSegments; s++) {
                    const f = trailStart + (travel - trailStart) * (s / trailSegments);
                    const x = fromX + (toX - fromX) * f;
                    const y = fromY + (toY - fromY) * f - tileSize * 0.15 - arcAt(f);
                    if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
                  }
                  for (let puffIndex = 1; puffIndex <= 5; puffIndex++) {
                    const f = travel - ARTILLERY_TRAIL_FRACTION * puffIndex / 6;
                    if (f <= 0) continue;
                    const puffAge = puffIndex / 6;
                    const jitter = Math.sin(effect.startTime * 0.001 + puffIndex * 2.17);
                    const smokeX = fromX + (toX - fromX) * f + jitter * tileSize * 0.018 * puffAge;
                    const smokeY = fromY + (toY - fromY) * f - tileSize * 0.15 - arcAt(f);
                    const smokeRadius = tileSize * (0.025 + puffAge * 0.035);
                    g.beginFill(0x12110e, 0.34 * (1 - puffAge * 0.55));
                    g.drawEllipse(smokeX, smokeY, smokeRadius * 1.25, smokeRadius);
                    g.endFill();
                    g.beginFill(0x9b9a91, 0.5 * (1 - puffAge * 0.62));
                    g.drawEllipse(smokeX, smokeY, smokeRadius, smokeRadius * 0.74);
                    g.endFill();
                  }
                  const tangentX = toX - fromX;
                  const tangentY = toY - fromY - arcHeight * Math.PI * Math.cos(travel * Math.PI);
                  const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
                  const shellUx = tangentX / tangentLength;
                  const shellUy = tangentY / tangentLength;
                  const shellPx = -shellUy;
                  const shellPy = shellUx;
                  const shellHalfLength = 5.8;
                  const shellHalfWidth = 3.1;
                  g.lineStyle(1.4, 0x090806, 0.96);
                  g.beginFill(0x3b3429, 1);
                  g.moveTo(tx + shellUx * shellHalfLength, ty + shellUy * shellHalfLength);
                  g.lineTo(tx + shellPx * shellHalfWidth, ty + shellPy * shellHalfWidth);
                  g.lineTo(tx - shellUx * shellHalfLength, ty - shellUy * shellHalfLength);
                  g.lineTo(tx - shellPx * shellHalfWidth, ty - shellPy * shellHalfWidth);
                  g.closePath();
                  g.endFill();
                  g.lineStyle();
                  g.beginFill(0xe6be63, 0.96);
                  g.drawEllipse(tx + shellUx * 1.2, ty + shellUy * 1.2, 2.1, 1.4);
                  g.endFill();
                } else {
                g.lineStyle(effect.type === 'explosion' ? 5.2 : 3.5, 0x15110a, 0.88);
                g.moveTo(sx, sy); g.lineTo(tx, ty);
                if (effect.type === 'explosion') {
                  g.lineStyle(2.8, 0xb96828, 0.72);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.lineStyle(1.3, 0xe4c18a, 0.96);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.beginFill(0x452b1c, 0.66);
                  g.drawCircle(tx, ty, 5.2);
                  g.endFill();
                  g.beginFill(0xb96c2a, 0.94);
                  g.drawCircle(tx, ty, 3.1);
                  g.endFill();
                  g.beginFill(0xf0d19b, 0.96);
                  g.drawCircle(tx, ty, 1.25);
                  g.endFill();
                } else if (effect.type === 'magic') {
                  g.lineStyle(6, 0x9c55d8, 0.3);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.lineStyle(2.6, 0xd8a0ff, 0.98);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.beginFill(0xaa44ff, 0.42);
                  g.drawCircle(tx, ty, 7);
                  g.endFill();
                  g.beginFill(0xe9c7ff, 0.98);
                  g.drawCircle(tx, ty, 3.6);
                  g.endFill();
                } else if (effect.type === 'arrow') {
                  // A single arrow: a short brown shaft with a dark head and a hint of fletching — no tracer glow.
                  const dxa = tx - sx, dya = ty - sy;
                  const la = Math.max(1, Math.hypot(dxa, dya));
                  const ua = dxa / la, va = dya / la;
                  const shaftLen = Math.min(la, tileSize * 0.34);
                  const bx = tx - ua * shaftLen, by = ty - va * shaftLen;
                  g.lineStyle(2.2, 0x5a4326, 0.95); g.moveTo(bx, by); g.lineTo(tx, ty); // shaft
                  g.lineStyle(2.6, 0x1c140b, 0.95); // arrowhead
                  g.moveTo(tx, ty); g.lineTo(tx - ua * 4 + va * 3, ty - va * 4 - ua * 3);
                  g.moveTo(tx, ty); g.lineTo(tx - ua * 4 - va * 3, ty - va * 4 + ua * 3);
                  g.lineStyle(1.6, 0xcdbb90, 0.9); // fletching
                  g.moveTo(bx, by); g.lineTo(bx - ua * 3 + va * 2.4, by - va * 3 - ua * 2.4);
                  g.moveTo(bx, by); g.lineTo(bx - ua * 3 - va * 2.4, by - va * 3 + ua * 2.4);
                } else if (effect.type === 'fire') {
                  // A short flame stream billowing from the nozzle toward the target — flickering orange blobs.
                  const dxf = toX - fromX, dyf = toY - fromY;
                  const reach = Math.min(1, travel * 1.4);
                  const puffs = 7;
                  for (let k = 0; k < puffs; k++) {
                    const f = (k / (puffs - 1)) * reach;
                    const px = fromX + dxf * f;
                    const py = fromY + dyf * f - tileSize * 0.15;
                    const jig = Math.sin(now / 40 + k * 1.7) * tileSize * 0.03;
                    const rad = tileSize * (0.05 + f * 0.14) * (0.8 + 0.2 * Math.sin(now / 30 + k));
                    g.beginFill(0x3a1c08, 0.35); g.drawCircle(px + jig, py - rad * 0.3, rad * 1.15); g.endFill();
                    g.beginFill(0xff7a1e, 0.6); g.drawCircle(px + jig, py, rad); g.endFill();
                    g.beginFill(0xffd24a, 0.75); g.drawCircle(px + jig, py, rad * 0.55); g.endFill();
                  }
                } else {
                  const slashProgress = Math.min(Math.max((elapsed - 80) / 260, 0), 1);
                  const cx = fromX + (toX - fromX) * 0.62;
                  const cy = fromY + (toY - fromY) * 0.62 - tileSize * 0.22;
                  const radius = tileSize * (0.22 + slashProgress * 0.12);
                  g.lineStyle(3.4, 0x140908, 0.82 * (1 - slashProgress * 0.5));
                  g.arc(cx, cy, radius, -0.8, 0.85);
                  g.lineStyle(1.7, 0xd8c79c, 0.92 * (1 - slashProgress * 0.45));
                  g.arc(cx, cy, radius * 0.92, -0.8, 0.85);
                }
                }
              }}
            />
          )}

          {sourceVisible && travel >= 1 && elapsed < timing.projectileMs + 120 && effect.type === 'magic' && (
            <Graphics
              draw={(g) => {
                g.clear();
                const fade = 1 - Math.max(0, elapsed - timing.projectileMs) / 120;
                const dx = toX - fromX;
                const dy = toY - fromY;
                const sx = fromX + dx * 0.18;
                const sy = fromY + dy * 0.18 - tileSize * 0.15;
                const ex = fromX + dx * 0.88;
                const ey = fromY + dy * 0.88 - tileSize * 0.15;
                const glow = 0xb676ff;
                g.lineStyle(6.2, 0x120d08, 0.56 * fade);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
                g.lineStyle(3, glow, 0.68 * fade);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
              }}
            />
          )}

          {targetVisible && elapsed >= timing.impactAtMs
            && elapsed < timing.impactAtMs + combatImpactWindowMs(effect.type, effect.killed, timing.impactMs) && (
            <Graphics
              x={toX}
              y={toY - tileSize * 0.2}
              draw={(g) => {
                g.clear();
                const hitProgress = Math.min((elapsed - timing.impactAtMs) / timing.impactMs, 1);
                const hitSize = effect.type === 'melee'
                  ? tileSize * (0.22 + hitProgress * 0.16)
                  : tileSize * (0.32 + hitProgress * 0.26);
                const hitAlpha = Math.pow(1 - hitProgress, 0.72);
                const dx = toX - fromX;
                const dy = toY - fromY;
                const len = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / len;
                const uy = dy / len;
                const px = -uy;
                const py = ux;

                if (effect.hit === false) {
                  const missX = px * tileSize * 0.16 - ux * tileSize * 0.06;
                  const missY = tileSize * 0.08 + py * tileSize * 0.08 - uy * tileSize * 0.04;
                  const dust = targetMaterial === 'armor' ? 0x44433b : targetMaterial === 'undead' ? 0x686756 : 0x554735;
                  const spark = effect.type === 'magic' ? 0xa26ac7 : 0xcda06b;
                  g.beginFill(dust, hitAlpha * 0.46);
                  g.drawEllipse(missX, missY, hitSize * 0.56, hitSize * 0.18);
                  g.endFill();
                  g.beginFill(0x1b160f, hitAlpha * 0.26);
                  g.drawEllipse(missX - ux * hitSize * 0.18, missY + tileSize * 0.015, hitSize * 0.32, hitSize * 0.1);
                  g.endFill();
                  g.lineStyle(1.9, 0x15100b, hitAlpha * 0.78);
                  g.moveTo(missX - px * hitSize * 0.24, missY - py * hitSize * 0.24);
                  g.lineTo(missX + px * hitSize * 0.24, missY + py * hitSize * 0.24);
                  g.lineStyle(1.15, spark, hitAlpha * 0.82);
                  g.moveTo(missX - px * hitSize * 0.18, missY - py * hitSize * 0.18);
                  g.lineTo(missX + px * hitSize * 0.18, missY + py * hitSize * 0.18);
                  for (let i = 0; i < 3; i++) {
                    const spread = (i - 1) * 0.22;
                    g.beginFill(spark, hitAlpha * 0.55);
                    g.drawCircle(missX + px * hitSize * spread - ux * hitSize * 0.1, missY + py * hitSize * spread - uy * hitSize * 0.1, Math.max(1.2, 2.1 * hitAlpha));
                    g.endFill();
                  }
                  return;
                }

                if (effect.type === 'explosion') {
                  const primary = targetMaterial === 'armor' ? 0xc87934 : targetMaterial === 'undead' ? 0xa7a593 : 0x9d6849;
                  const dust = targetMaterial === 'armor' ? 0x4b4b42 : targetMaterial === 'undead' ? 0x6f7164 : 0x5b4b36;
                  const impactElapsed = elapsed - timing.impactAtMs;
                  const flashLife = Math.max(0, 1 - impactElapsed / 180);
                  const fireLife = Math.max(0, 1 - impactElapsed / 520);
                  const dustLife = Math.max(0, 1 - impactElapsed / 980);
                  const blastExpansion = easeOutCubic(clamp01(impactElapsed / 460));
                  const blastRadius = tileSize * (0.18 + blastExpansion * 0.34);
                  const plumeLobes = [
                    [-0.34, -0.18, 0.72],
                    [0.1, -0.5, 0.82],
                    [0.42, -0.16, 0.56],
                    [-0.5, 0.08, 0.48],
                    [0.18, 0.16, 0.62],
                    [-0.12, -0.82, 0.44],
                    [0.52, 0.22, 0.36],
                    [-0.58, -0.42, 0.32],
                  ] as const;
                  for (let i = 0; i < 7; i += 1) {
                    const angle = -2.8 + i * 0.79;
                    const distance = blastRadius * (0.28 + (i % 3) * 0.18);
                    const dustX = Math.cos(angle) * distance;
                    const dustY = Math.sin(angle) * distance * 0.38 + tileSize * 0.09;
                    const dustScale = 0.2 + (i % 4) * 0.055;
                    g.beginFill(i % 2 === 0 ? dust : 0x302b22, dustLife * (0.26 + (i % 3) * 0.08));
                    g.drawEllipse(dustX, dustY, blastRadius * dustScale, blastRadius * dustScale * 0.34);
                    g.endFill();
                  }
                  for (let i = 0; i < plumeLobes.length; i += 1) {
                    const [offsetX, offsetY, lobeScale] = plumeLobes[i];
                    const flicker = prefersReducedMotion ? 1 : 0.96 + Math.sin(now / 70 + i * 1.9) * 0.04;
                    const rise = Math.sin(Math.min(1, impactElapsed / 900) * Math.PI) * tileSize * (0.08 + (i % 3) * 0.025);
                    const lobeX = offsetX * blastRadius;
                    const lobeY = offsetY * blastRadius - tileSize * 0.03 - rise;
                    const lobeRadius = blastRadius * lobeScale * flicker;
                    g.beginFill(i % 3 === 0 ? 0x25231f : 0x3d3b34, dustLife * (0.48 + (i % 2) * 0.12));
                    g.drawEllipse(lobeX, lobeY, lobeRadius, lobeRadius * (0.7 + (i % 2) * 0.12));
                    g.endFill();
                    if (fireLife > 0.05 && i < 5) {
                      g.beginFill(i % 2 === 0 ? 0xbd5d25 : primary, fireLife * (0.5 + (i % 3) * 0.08));
                      g.drawEllipse(lobeX, lobeY + lobeRadius * 0.06, lobeRadius * 0.56, lobeRadius * 0.46);
                      g.endFill();
                    }
                  }
                  if (flashLife > 0) {
                    for (let rayIndex = 0; rayIndex < 5; rayIndex += 1) {
                      const angle = -2.45 + rayIndex * 1.16;
                      const inner = tileSize * 0.05;
                      const outer = tileSize * (0.18 + (rayIndex % 2) * 0.08) * flashLife;
                      g.lineStyle(3, 0x27140c, flashLife * 0.7);
                      g.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                      g.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                      g.lineStyle(1.25, 0xe0a15e, flashLife * 0.88);
                      g.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                      g.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                    }
                    g.beginFill(0xe5bd7d, flashLife * 0.82);
                    g.drawEllipse(-ux * tileSize * 0.035, -uy * tileSize * 0.025, tileSize * 0.09, tileSize * 0.065);
                    g.endFill();
                  }
                  if (effect.killed) {
                    const destructionProgress = clamp01(Math.max(0, impactElapsed - 100) / 720);
                    const destructionLife = Math.max(0, 1 - Math.max(0, impactElapsed - 180) / 980);
                    const emberColor = targetMaterial === 'armor' ? 0xff8a24 : 0xd96531;
                    for (let i = 0; i < 11; i++) {
                      const angle = -2.75 + i * 0.53;
                      const distance = tileSize * destructionProgress * (0.28 + (i % 4) * 0.08);
                      const fragmentX = Math.cos(angle) * distance;
                      const fragmentY = Math.sin(angle) * distance * 0.62
                        - tileSize * 0.34 * Math.sin(destructionProgress * Math.PI);
                      const emberFragment = i % 3 === 0;
                      const alongX = Math.cos(angle + i * 0.17);
                      const alongY = Math.sin(angle + i * 0.17);
                      const acrossX = -alongY;
                      const acrossY = alongX;
                      const shardLength = emberFragment ? 2.2 : 3.2 + (i % 2) * 0.8;
                      const shardWidth = emberFragment ? 1.2 : 1.4 + (i % 3) * 0.35;
                      g.beginFill(emberFragment ? emberColor : 0x39342c, destructionLife * (emberFragment ? 0.88 : 0.72));
                      if (emberFragment) {
                        g.drawEllipse(fragmentX, fragmentY, shardLength * 0.72, shardWidth * 0.72);
                      } else {
                        g.drawPolygon([
                          fragmentX - alongX * shardLength * 0.58 - acrossX * shardWidth * 0.2,
                          fragmentY - alongY * shardLength * 0.58 - acrossY * shardWidth * 0.2,
                          fragmentX - alongX * shardLength * 0.08 + acrossX * shardWidth * 0.65,
                          fragmentY - alongY * shardLength * 0.08 + acrossY * shardWidth * 0.65,
                          fragmentX + alongX * shardLength * 0.62 + acrossX * shardWidth * 0.12,
                          fragmentY + alongY * shardLength * 0.62 + acrossY * shardWidth * 0.12,
                          fragmentX + alongX * shardLength * 0.04 - acrossX * shardWidth * 0.52,
                          fragmentY + alongY * shardLength * 0.04 - acrossY * shardWidth * 0.52
                        ]);
                      }
                      g.endFill();
                    }
                    if (destructionLife > 0) {
                      for (const [flameX, flameY, flameScale, phase] of [
                        [-0.11, -0.08, 0.13, 0],
                        [0.04, -0.14, 0.17, 1.9],
                        [0.15, -0.06, 0.1, 3.6]
                      ] as const) {
                        const flamePulse = prefersReducedMotion ? 0.86 : 0.82 + Math.sin(now / 88 + phase) * 0.12;
                        const flameCenterX = flameX * tileSize;
                        const flameBaseY = flameY * tileSize;
                        const flameWidth = flameScale * tileSize;
                        const flameHeight = flameScale * tileSize * 1.7 * flamePulse;
                        const flameSway = Math.sin(now / 115 + phase) * flameWidth * 0.16;
                        g.beginFill(0x32140c, destructionLife * 0.68);
                        g.moveTo(flameCenterX - flameWidth * 0.55, flameBaseY + flameHeight * 0.35);
                        g.lineTo(flameCenterX - flameWidth * 0.24, flameBaseY - flameHeight * 0.08);
                        g.lineTo(flameCenterX + flameSway, flameBaseY - flameHeight * 0.72);
                        g.lineTo(flameCenterX + flameWidth * 0.2, flameBaseY - flameHeight * 0.14);
                        g.lineTo(flameCenterX + flameWidth * 0.52, flameBaseY + flameHeight * 0.38);
                        g.closePath();
                        g.endFill();
                        g.beginFill(emberColor, destructionLife * 0.76);
                        g.moveTo(flameCenterX - flameWidth * 0.24, flameBaseY + flameHeight * 0.3);
                        g.lineTo(flameCenterX + flameSway * 0.5, flameBaseY - flameHeight * 0.42);
                        g.lineTo(flameCenterX + flameWidth * 0.22, flameBaseY + flameHeight * 0.31);
                        g.closePath();
                        g.endFill();
                      }
                    }
                  }
                  const debrisTint = targetMaterial === 'armor' ? 0x6f6a60 : targetMaterial === 'undead' ? 0x6f7164 : 0x5b4b36;
                  for (let i = 0; i < 7; i++) {
                    const angle = -1.05 + i * 0.35;
                    const debrisX = Math.cos(angle) * hitSize * 1.7 * hitProgress;
                    const debrisY = Math.sin(angle) * hitSize * 1.5 * hitProgress - hitSize * 1.25 * hitProgress + hitSize * 2.4 * hitProgress * hitProgress;
                    g.beginFill(debrisTint, hitAlpha * 0.86);
                    g.drawCircle(debrisX, debrisY, Math.max(1.1, 2.6 * hitAlpha));
                    g.endFill();
                  }
                } else if (effect.type === 'melee') {
                  const primary = targetMaterial === 'undead' ? 0xd8d6c2 : 0xd09a67;
                  const edgeX = -ux * tileSize * 0.12;
                  const edgeY = -uy * tileSize * 0.1;
                  g.beginFill(targetMaterial === 'undead' ? 0x6f7164 : 0x5b4b36, hitAlpha * 0.36);
                  g.drawEllipse(0, tileSize * 0.08, hitSize * 0.92, hitSize * 0.3);
                  g.endFill();
                  g.lineStyle(4, 0x1a0b04, hitAlpha * 0.9);
                  g.arc(edgeX, edgeY, hitSize * (0.72 + hitProgress * 0.35), -1.1, 0.75);
                  g.lineStyle(2, primary, hitAlpha);
                  g.arc(edgeX, edgeY, hitSize * (0.64 + hitProgress * 0.3), -1.1, 0.75);
                  for (let i = 0; i < 5; i++) {
                    const angle = -0.8 + i * 0.4;
                    g.beginFill(primary, hitAlpha * 0.72);
                    g.drawCircle(Math.cos(angle) * hitSize * 0.65, Math.sin(angle) * hitSize * 0.4, Math.max(1.2, 2.8 * hitAlpha));
                    g.endFill();
                  }
                } else {
                  const dust = targetMaterial === 'armor' ? 0x3c3d36 : 0x514436;
                  const spark = targetMaterial === 'armor' ? 0xffe9a8 : 0xd6a26a;
                  const sparkBright = targetMaterial === 'armor' ? 0xe8c68f : 0xd5ad79;
                  const impactElapsed = elapsed - timing.impactAtMs;
                  const contactFlash = Math.max(0, 1 - impactElapsed / 120);
                  g.beginFill(0xf2d8a7, contactFlash * 0.88);
                  g.drawEllipse(0, 0, tileSize * (0.055 + contactFlash * 0.025), tileSize * (0.035 + contactFlash * 0.015));
                  g.endFill();
                  g.beginFill(dust, hitAlpha * 0.46);
                  g.drawEllipse(0, tileSize * 0.09, hitSize * 0.72, hitSize * 0.24);
                  g.endFill();
                  const incomingAngle = Math.atan2(uy, ux);
                  for (let i = 0; i < 4; i++) {
                    const spread = -0.72 + i * 0.48;
                    const angle = incomingAngle + spread;
                    const inner = hitSize * (0.08 + (i % 2) * 0.04);
                    const outer = hitSize * (0.3 + (i % 3) * 0.13 + hitProgress * 0.28);
                    const innerX = Math.cos(angle) * inner;
                    const innerY = Math.sin(angle) * inner;
                    const outerX = Math.cos(angle) * outer;
                    const outerY = Math.sin(angle) * outer + hitSize * 0.18 * hitProgress;
                    g.lineStyle(2.2, 0x1a0f07, hitAlpha * 0.78);
                    g.moveTo(innerX, innerY);
                    g.lineTo(outerX, outerY);
                    g.lineStyle(i % 2 === 0 ? 1.15 : 0.8, sparkBright, hitAlpha * (i % 2 === 0 ? 0.88 : 0.66));
                    g.moveTo(innerX, innerY);
                    g.lineTo(outerX, outerY);
                    g.beginFill(spark, hitAlpha * 0.72);
                    g.drawCircle(outerX, outerY, Math.max(0.7, 1.55 * hitAlpha));
                    g.endFill();
                  }
                  g.lineStyle(1.8, 0x23140b, hitAlpha * 0.84);
                  g.moveTo(-ux * hitSize * 0.32, -uy * hitSize * 0.32);
                  g.lineTo(ux * hitSize * 0.28, uy * hitSize * 0.28);
                  g.lineStyle(0.9, sparkBright, hitAlpha * 0.86);
                  g.moveTo(-ux * hitSize * 0.22, -uy * hitSize * 0.22);
                  g.lineTo(ux * hitSize * 0.2, uy * hitSize * 0.2);
                }
                if (isBurst && effect.hit) {
                  const debrisElapsed = elapsed - timing.impactAtMs;
                  const debrisProgress = clamp01(debrisElapsed / SMALL_ARMS_DEBRIS_LIFETIME_MS);
                  const debrisAlpha = Math.pow(1 - debrisProgress, 1.35);
                  const eventIndex = effect.timelineStartIndex ?? 0;
                  for (let particleIndex = 0; particleIndex < SMALL_ARMS_DEBRIS_COUNT; particleIndex += 1) {
                    const spread = smallArmsDebrisValue(eventIndex, particleIndex, 0) - 0.5;
                    const speed = 0.52 + smallArmsDebrisValue(eventIndex, particleIndex, 1) * 0.48;
                    const lateral = spread * tileSize * 0.32 * debrisProgress * speed;
                    const forward = tileSize * (0.05 + speed * 0.12) * debrisProgress;
                    const lift = tileSize * (0.06 + smallArmsDebrisValue(eventIndex, particleIndex, 2) * 0.1)
                      * Math.sin(debrisProgress * Math.PI);
                    const particleX = px * lateral + ux * forward;
                    const particleY = py * lateral * 0.42 + uy * forward - lift;
                    const radius = 0.75 + smallArmsDebrisValue(eventIndex, particleIndex, 3) * 1.1;
                    g.beginFill(targetMaterial === 'armor' ? 0xcda968 : 0x8a7250, debrisAlpha * 0.72);
                    g.drawEllipse(particleX, particleY, radius * 1.35, radius);
                    g.endFill();
                  }
                }
              }}
            />
          )}
          {targetVisible && elapsed >= timing.impactAtMs + 35
            && elapsed < timing.impactAtMs + (effect.killed ? 940 : 1120)
            && (() => {
            // Damage number with a punchy pop (overshoot scale), an ease-out leap upward, and a size/
            // colour ramp by magnitude — so a big hit reads as a big number, not a uniform tick.
            const dmg = effect.suppressive ? effect.moraleDamage ?? 0 : effect.damage ?? 0;
            const textElapsed = elapsed - timing.impactAtMs - 35;
            const textLife = effect.killed ? 905 : 1085;
            const pop = easeOutBack(textElapsed / 170);
            const rise = tileSize * 0.5 + 20 * easeOutCubic(textElapsed / 760);
            const readableImpact = effect.suppressive || Boolean(effect.hit);
            const fontSize = readableImpact ? Math.round(16 + Math.min(16, dmg * 0.7)) : 15;
            const big = dmg >= 18;
            const fill = effect.suppressive
              ? '#ffd36d'
              : !effect.hit ? '#d8d1bc' : big ? '#ff8a3c' : dmg >= 9 ? '#ffc24a' : '#f3d58a';
            return (
              // Counter-scaled so the combat text stays a fixed, crisp on-screen size
              // (net scale ≈ 1) instead of being blown up by the camera zoom.
              <Container
                x={toX}
                y={toY - rise}
                zIndex={zIndex + 2}
                scale={(1 / scale) * Math.max(0.2, pop)}
              >
                <Text
                  text={effect.suppressive ? t('combat.suppress', { morale: dmg }) : effect.hit ? `-${dmg}` : t('combat.miss')}
                  anchor={{ x: 0.5, y: 0.5 }}
                  resolution={2}
                  style={damageTextStyle(readableImpact, big, fontSize, fill)}
                  alpha={Math.max(0, 0.95 - textElapsed / textLife)}
                />
              </Container>
            );
          })()}
        </Container>
      );
    }).filter(Boolean) as JSX.Element[];
  }, [attackEffects, battleState.sides, now, map.width, map.tiles, prefersReducedMotion, topGeomFor, scale, t]);

  const propsSprites = useMemo(() => {
    const sceneryProps = (map.props ?? []).filter((prop) => prop.kind !== 'proc-building');
    if (sceneryProps.length === 0) return [];
    const idxAt = (q: number, r: number) => r * map.width + q;
    const defaultTexturePath = '/props/tree1.png';
    const getTexture = (path?: string) => {
      const key = path ?? defaultTexturePath;
      if (!propTextureCache.has(key)) {
        propTextureCache.set(key, crispTexture(Texture.from(key)));
      }
      return propTextureCache.get(key)!;
    };
    // Units standing on or just up-screen of a tree get hidden by its canopy; collect on-field units so
    // a covering tree can fade like buildings do (the player could otherwise only see a unit by selecting it).
    const visibleUnitCoords: Array<{ q: number; r: number }> = [];
    for (const side of Object.values(battleState.sides) as Array<{ units: Map<string, { id: string; coordinate: { q: number; r: number }; stance: string; embarkedOn?: string; faction: string }> }>) {
      for (const u of side.units.values()) {
        if (u.stance === 'destroyed' || u.embarkedOn) continue;
        if (u.faction === viewerFaction || visibleTiles.has(idxAt(u.coordinate.q, u.coordinate.r))) {
          visibleUnitCoords.push(movingUnit?.unitId === u.id && movementOcclusionCoordinate
            && canMovingUnitFadeCanopy(u.faction, viewerFaction, movementOcclusionCoordinate, map.width, visibleTiles)
            ? movementOcclusionCoordinate
            : u.coordinate);
        }
      }
    }

    return sceneryProps
      .map((prop) => {
        const tileIdx = idxAt(prop.coordinate.q, prop.coordinate.r);
        if (!exploredTiles.has(tileIdx)) {
          return null;
        }
        const isVisible = visibleTiles.has(tileIdx);
        const pos = toScreen(prop.coordinate);
        const geom = topGeomFor(prop.coordinate.q, prop.coordinate.r);
        const anchor = bilerpPoint(geom.P, prop.u ?? 0.5, prop.v ?? 0.5);
        const worldX = pos.x + anchor.x;
        const worldY = pos.y - geom.avgHeight * ELEV_Y_OFFSET + anchor.y + PROP_BASE_Y_OFFSET;
        const zIndex = Math.round(worldY);
        const scale = prop.scale ?? 1;
        const proceduralProp = !prop.texture && (prop.kind === 'rock' || prop.kind === 'bush');
        const texturePath = assetUrl(prop.texture ?? defaultTexturePath);
        const textureMissing = missingPropPaths.has(texturePath);
        const texture = textureMissing || proceduralProp ? null : getTexture(texturePath);
        // Halving decided by path, not texture.width — width reads 1 until the async load lands,
        // which painted hi-res props at 2x on their first frame.
        const bitmapScale = texture && isHiResPropTexture(texturePath) ? scale * 0.5 : scale;
        const bitmapScaleX = bitmapScale * (prop.flipX ? -1 : 1);
        const occludeAlpha = prop.kind === 'tree'
          ? visibleUnitCoords.reduce((alpha, coordinate) => {
              const unitPosition = toScreen(coordinate);
              const displayQ = Math.min(map.width - 1, Math.max(0, Math.round(coordinate.q)));
              const displayR = Math.min(map.height - 1, Math.max(0, Math.round(coordinate.r)));
              const unitGeom = topGeomFor(displayQ, displayR);
              const unitX = unitPosition.x;
              const unitY = unitPosition.y - unitGeom.avgHeight * ELEV_Y_OFFSET;
              const horizontalGap = Math.max(Math.abs(unitX - worldX) - tileSize * 0.62, 0);
              const verticalGap = Math.max(
                worldY - tileSize * 1.45 - unitY,
                unitY - (worldY + tileSize * 0.12),
                0
              );
              return Math.min(
                alpha,
                featheredOcclusionAlpha(Math.hypot(horizontalGap, verticalGap), tileSize * 0.5, 0.26)
              );
            }, 1)
          : 1;

        return (
          <Container key={prop.id} x={worldX} y={worldY} zIndex={zIndex} sortableChildren>
            <Graphics
              zIndex={-1}
              draw={(g) => {
                g.clear();
                const treeLike = prop.kind === 'tree';
                const shadowStrength = isVisible ? (treeLike ? 0.24 : 0.18) : 0;
                const shadowRx = tileSize * (treeLike ? 0.24 : 0.18);
                const shadowRy = tileSize * (treeLike ? 0.12 : 0.1);
                for (const layer of softShadowLayers(shadowStrength)) {
                  g.beginFill(0x000000, layer.alpha);
                  g.drawEllipse(0, PROP_SHADOW_Y, shadowRx * layer.scaleX, shadowRy * layer.scaleY);
                  g.endFill();
                }
                if (treeLike) {
                  const q = prop.coordinate.q;
                  const r = prop.coordinate.r;
                  for (let i = 0; i < 5; i++) {
                    const ox = (tileNoise(q, r, 310 + i) - 0.5) * tileSize * 0.34;
                    const oy = PROP_SHADOW_Y + (tileNoise(q, r, 330 + i) - 0.5) * tileSize * 0.12;
                    const rx = tileSize * (0.045 + tileNoise(q, r, 350 + i) * 0.035);
                    const ry = tileSize * (0.018 + tileNoise(q, r, 370 + i) * 0.018);
                    g.beginFill(i % 2 === 0 ? 0x1d2e18 : 0x332a1e, isVisible ? 0.18 : 0.08);
                    g.drawEllipse(ox, oy, rx, ry);
                    g.endFill();
                  }
                }
              }}
            />
            {proceduralProp ? (
              <Sprite
                texture={prop.kind === 'rock' ? propAtlasTextures.rock : propAtlasTextures.bush}
                anchor={{ x: 0.5, y: 0.78 }}
                alpha={isVisible ? 1 : 0.72}
                scale={scale * 0.58}
              />
            ) : textureMissing ? (
              <Text
                text={basename(texturePath)}
                anchor={0.5}
                y={-4}
                alpha={isVisible ? 1 : 0.8}
                style={missingLabelStyle}
              />
            ) : (
              <Sprite
                texture={texture!}
                anchor={{ x: 0.5, y: PROP_ANCHOR_Y }}
                scale={{ x: bitmapScaleX, y: bitmapScale }}
                alpha={(isVisible ? 1 : 0.75) * occludeAlpha}
              />
            )}
          </Container>
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [movementOcclusionCoordinate, map.props, map.width, map.height, exploredTiles, visibleTiles, battleState.sides, viewerFaction, propTextureCache, propAtlasTextures, topGeomFor, missingPropPaths, movingUnit?.unitId]);

  const procBuildings = useMemo(() => {
    const buildingProps = (map.props ?? []).filter(
      (p): p is MapProp & { kind: 'proc-building' } => p.kind === 'proc-building'
    );
    if (buildingProps.length === 0) return [];

    const W = map.width;
    const H = map.height;
    const idxAt = (q: number, r: number) => r * W + q;
    const inBounds = (q: number, r: number) => q >= 0 && r >= 0 && q < W && r < H;

    // Coordinates of units that are currently visible to the player. A building standing over one of
    // them is faded so the unit isn't completely hidden — the focus-fade above only fires for the
    // selected/target unit, so un-selected units behind a solid building were invisible.
    const visibleUnitCoords: Array<{ sx: number; sy: number; focused: boolean }> = [];
    for (const side of Object.values(battleState.sides)) {
      for (const u of side.units.values()) {
        if (u.stance === 'destroyed' || u.embarkedOn) continue;
        // Always reveal-through for the player's own units; for enemies only when actually visible.
        if (u.faction === viewerFaction || visibleTiles.has(idxAt(u.coordinate.q, u.coordinate.r))) {
          const displayCoordinate = movingUnit?.unitId === u.id && movementOcclusionCoordinate
            && canMovingUnitFadeCanopy(u.faction, viewerFaction, movementOcclusionCoordinate, map.width, visibleTiles)
            ? movementOcclusionCoordinate
            : u.coordinate;
          const displayQ = Math.min(W - 1, Math.max(0, Math.round(displayCoordinate.q)));
          const displayR = Math.min(H - 1, Math.max(0, Math.round(displayCoordinate.r)));
          const unitPosition = toScreen(displayCoordinate);
          const unitGeom = topGeomFor(displayQ, displayR);
          visibleUnitCoords.push({
            sx: unitPosition.x,
            sy: unitPosition.y - unitGeom.avgHeight * ELEV_Y_OFFSET,
            focused: u.id === selectedUnitId || u.id === targetUnitId || u.id === movingUnit?.unitId
          });
        }
      }
    }

    return buildingProps
      .map((b) => {
        const footprint: number[] = [];
        if (Array.isArray(b.tiles) && b.tiles.length > 0) {
          for (const t of b.tiles) {
            if (inBounds(t.q, t.r)) footprint.push(idxAt(t.q, t.r));
          }
        } else {
          const q0 = b.coordinate.q;
          const r0 = b.coordinate.r;
          const w = Math.max(1, b.w ?? 1);
          const h = Math.max(1, b.h ?? 1);
          for (let dq = 0; dq < w; dq++) {
            for (let dr = 0; dr < h; dr++) {
              const q = q0 + dq;
              const r = r0 + dr;
              if (inBounds(q, r)) footprint.push(idxAt(q, r));
            }
          }
        }

        const isExplored = footprint.some((i) => exploredTiles.has(i));
        if (!isExplored) return null;
        const q0 = b.coordinate.q;
        const r0 = b.coordinate.r;
        const w = Math.max(1, b.w ?? 1);
        const h = Math.max(1, b.h ?? 1);
        const isVisible = footprint.some((i) => visibleTiles.has(i));
        const bottomNW = worldCornerOfTile(q0, r0, 'NW', topGeomFor);
        const bottomNE = worldCornerOfTile(q0 + w - 1, r0, 'NE', topGeomFor);
        const bottomSE = worldCornerOfTile(q0 + w - 1, r0 + h - 1, 'SE', topGeomFor);
        const bottomSW = worldCornerOfTile(q0, r0 + h - 1, 'SW', topGeomFor);
        const basePoly = [bottomNW, bottomNE, bottomSE, bottomSW];

        const anchor = {
          x: (bottomSW.x + bottomSE.x) / 2 + (b.baseOffsetPx?.x ?? 0),
          y: (bottomSW.y + bottomSE.y) / 2 + (b.baseOffsetPx?.y ?? 0)
        };
        const zIndex =
          b.zPivot === 'centroid'
            ? Math.round((bottomNW.y + bottomNE.y + bottomSE.y + bottomSW.y) / 4)
            : Math.round(Math.max(bottomSW.y, bottomSE.y));

        // Painted iso building sprite instead of the flat procedural box. Explicit b.texture wins;
        // otherwise pick a stable painted asset per building (by id hash) with its base cropped off.
        // Pick a painted asset per building. Mix the id hash with the tile position so two buildings that
        // happen to hash alike still differ when they sit side by side (q±1 / r±1 shift the index) — this
        // is what stops the "same 2-3 sprites repeating next to each other" look in dense districts.
        const painted = b.texture
          ? { tex: b.texture, keepTop: 1, scaleAdj: 1 }
          : PAINTED_BUILDINGS[(hashStringToIndex(b.id, PAINTED_BUILDINGS.length) + q0 + r0 * 7) % PAINTED_BUILDINGS.length];
        // Footprint scale × the sprite's content-normalization factor, so every building reads at a
        // consistent on-tile size regardless of how much of its 1024² frame the art happens to fill.
        // Hard cap (0.12) as a safety net: BATTLES SAVED BEFORE the landmark-scale fix baked an old,
        // huge b.scale (0.2) into the map prop, so an old save would otherwise still render a giant
        // "microscope" building. The cap keeps even those within a sane on-tile size.
        const spriteScale = Math.min(0.12, (b.scale ?? 0.07 * Math.max(w, h, 1)) * (painted?.scaleAdj ?? 1));

        // Geometric occlusion: fade the building when a visible unit actually sits under its drawn sprite
        // rectangle. This works for ANY height/width (a tall, wide watchtower included) — the old q-r
        // row/column heuristic missed units one column to the side or 8+ rows up-screen behind a big tower.
        const spriteH = 1024 * (painted ? painted.keepTop : 1) * spriteScale; // painted assets are 1024² cropped by keepTop
        const spriteW = 1024 * spriteScale;
        const sprTop = anchor.y - 0.97 * spriteH; // sprite anchor is (0.5, 0.97)
        const sprLeft = anchor.x - 0.5 * spriteW;
        const sprRight = anchor.x + 0.5 * spriteW;
        const occMargin = ISO_TILE_W * 0.3;
        const buildingAlpha = visibleUnitCoords.reduce((alpha, unitCoord) => {
          const horizontalGap = Math.max(
            sprLeft - occMargin - unitCoord.sx,
            unitCoord.sx - (sprRight + occMargin),
            0
          );
          const verticalGap = Math.max(
            sprTop - occMargin - unitCoord.sy,
            unitCoord.sy - (anchor.y + 2),
            0
          );
          const distance = Math.hypot(horizontalGap, verticalGap);
          const unitAlpha = featheredOcclusionAlpha(
            distance,
            ISO_TILE_W * 0.42,
            unitCoord.focused ? 0.2 : 0.4
          );
          return Math.min(alpha, unitAlpha);
        }, 1);
        const visibilityPresentation = buildingVisibilityPresentation(isVisible, buildingAlpha);
        const fogAlpha = visibilityPresentation.containerAlpha;
        const fogShade = isVisible ? 0 : 0.06;

        if (painted) {
          const texture = getCroppedBuildingTexture(painted.tex, painted.keepTop);
          return (
            <Container key={b.id} x={anchor.x} y={anchor.y} zIndex={zIndex} sortableChildren alpha={fogAlpha}>
              <Graphics
                zIndex={-1}
                draw={(g) => {
                  g.clear();
                  const localBase = basePoly.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }));
                  const cxc = localBase.reduce((a, p) => a + p.x, 0) / localBase.length;
                  const cyc = localBase.reduce((a, p) => a + p.y, 0) / localBase.length;
                  const bw = Math.max(...localBase.map((p) => p.x)) - Math.min(...localBase.map((p) => p.x));
                  const bh = Math.max(...localBase.map((p) => p.y)) - Math.min(...localBase.map((p) => p.y));
                  // Soft ground shadow cast toward the lower-right (light comes from the upper-left), drawn
                  // as an offset ellipse rather than a centred copy of the square base — otherwise the hard
                  // footprint-shaped patch reads as a slab/platform and the building looks like it floats.
                  for (const layer of softShadowLayers(0.34 * visibilityPresentation.shadowStrength)) {
                    g.beginFill(0x070907, layer.alpha);
                    g.drawEllipse(
                      cxc + bw * 0.11,
                      cyc + bh * 0.13,
                      bw * 0.5 * layer.scaleX,
                      bh * 0.56 * layer.scaleY
                    );
                    g.endFill();
                  }
                }}
              />
              <Sprite
                texture={texture}
                anchor={{ x: 0.5, y: 0.97 }}
                scale={spriteScale}
                tint={visibilityPresentation.spriteTint}
                alpha={visibilityPresentation.spriteAlpha}
              />
            </Container>
          );
        }

        const levels = Math.max(1, b.levels ?? 2);
        const levelHeightPx = Math.max(8, b.levelHeightPx ?? Math.round(tileSize * 0.55));
        const heightPx = levels * levelHeightPx;
        const roofRisePx = Math.max(6, Math.round(levelHeightPx * 0.65));
        const topNW = { x: bottomNW.x, y: bottomNW.y - heightPx };
        const topNE = { x: bottomNE.x, y: bottomNE.y - heightPx };
        const topSE = { x: bottomSE.x, y: bottomSE.y - heightPx };
        const topSW = { x: bottomSW.x, y: bottomSW.y - heightPx };

        const facade = b.facade ?? {};
        const wallColor = facade.baseColor ?? b.wallColor ?? 0x6f5f4f;
        const facadeMaterial = facade.material ?? 'plaster';
        const trimColor = facade.trimColor ?? lightenColor(wallColor, 0.25);
        const accentColor = facade.accentColor ?? darkenColor(wallColor, 0.2);
	      const grimeStrength = clamp(Math.max(0.44, facade.grime ?? 0), 0, 1);

        const roofColor = b.roofColor ?? 0x5e6b73;
        const roofCfg =
          b.roof ?? ({
            kind: 'flat',
            pitch: 0.3,
            dir: 'E-W'
          } as NonNullable<MapProp['roof']>);
        const roofDetails = b.roofDetails ?? {};
        const roofTrimColor = roofDetails.trimColor ?? trimColor;
        const ridgeCap = roofDetails.ridgeCap ?? true;
        const roofVents = roofDetails.ventCount ?? 0;

        const windowSides =
          (b.windows?.sides && b.windows.sides.length > 0 ? b.windows.sides : null) ??
          ((w > 1 || h > 1) ? (['E', 'S'] as EdgeDir[]) : (['E'] as EdgeDir[]));
        const windowConfig: WindowLayoutConfig & { sides: EdgeDir[] } = {
          rows: Math.max(1, b.windows?.rows ?? Math.min(levels, 2)),
          cols: Math.max(1, b.windows?.cols ?? Math.max(1, Math.round(w * 1.8))),
          marginH: b.windows?.marginH ?? 12,
          marginV: b.windows?.marginV ?? 10,
          widthPx: b.windows?.widthPx ?? Math.max(16, Math.round(levelHeightPx * 0.45)),
          heightPx: b.windows?.heightPx ?? Math.max(18, Math.round(levelHeightPx * 0.6)),
          spacingH: b.windows?.spacingH ?? 8,
          spacingV: b.windows?.spacingV ?? 8,
          frameColor: b.windows?.frameColor ?? darkenColor(wallColor, 0.35),
          glassColor: b.windows?.glassColor ?? 0x6aa2cc,
          emissive: clamp(b.windows?.emissive ?? 0, 0, 1),
          sides: windowSides
        };

        const doorConfigs = (b.doors ?? []).filter(
          (door): door is NonNullable<MapProp['doors']>[number] => door.side === 'E' || door.side === 'S'
        );
        const faces: Array<{
          side: EdgeDir;
          topA: { x: number; y: number };
          topB: { x: number; y: number };
          bottomA: { x: number; y: number };
          bottomB: { x: number; y: number };
        }> = [
          { side: 'E', topA: topNE, topB: topSE, bottomA: bottomNE, bottomB: bottomSE },
          { side: 'S', topA: topSE, topB: topSW, bottomA: bottomSE, bottomB: bottomSW }
        ];
        const faceInfos: typeof faces = [];

        return (
          <Container key={b.id} x={anchor.x} y={anchor.y} zIndex={zIndex} sortableChildren alpha={fogAlpha}>
            <Graphics
              zIndex={-2}
              draw={(g) => {
                g.clear();
                const localBase = basePoly.map((p) => ({
                  x: p.x - anchor.x,
                  y: p.y - anchor.y
                }));
                const centroid = localBase.reduce(
                  (acc, p) => ({ x: acc.x + p.x / localBase.length, y: acc.y + p.y / localBase.length }),
                  { x: 0, y: 0 }
                );
                const skirt = localBase.map((p) => ({
                  x: centroid.x + (p.x - centroid.x) * 1.18,
                  y: centroid.y + (p.y - centroid.y) * 1.22 + 2
                }));
                g.beginFill(0x16130e, isVisible ? 0.28 : 0.14);
                drawPoly(g as PixiGraphics, skirt);
                g.endFill();
                g.beginFill(0x000000, isVisible ? 0.22 : 0.1);
                drawPoly(
                  g as PixiGraphics,
                  localBase
                );
                g.endFill();
                g.lineStyle(1, 0x655a42, isVisible ? 0.22 : 0.1);
                for (let i = 0; i < 9; i++) {
                  const t = i / 9;
                  const a = skirt[Math.floor(tileNoise(q0, r0, 1200 + i) * skirt.length)];
                  const bPoint = skirt[(Math.floor(tileNoise(q0, r0, 1200 + i) * skirt.length) + 1) % skirt.length];
                  const x = a.x + (bPoint.x - a.x) * t + (tileNoise(q0, r0, 1210 + i) - 0.5) * 8;
                  const y = a.y + (bPoint.y - a.y) * t + (tileNoise(q0, r0, 1220 + i) - 0.5) * 4;
                  g.moveTo(x - 2, y);
                  g.lineTo(x + 2, y + 1);
                }
                g.lineStyle();
                for (let i = 0; i < 16; i++) {
                  const edge = Math.floor(tileNoise(q0, r0, 1240 + i) * skirt.length);
                  const a = skirt[edge];
                  const bPoint = skirt[(edge + 1) % skirt.length];
                  const t = tileNoise(q0, r0, 1250 + i);
                  const x = a.x + (bPoint.x - a.x) * t + (tileNoise(q0, r0, 1260 + i) - 0.5) * 10;
                  const y = a.y + (bPoint.y - a.y) * t + (tileNoise(q0, r0, 1270 + i) - 0.5) * 5;
                  const size = tileNoise(q0, r0, 1280 + i) > 0.62 ? 3 : 2;
                  g.beginFill(tileNoise(q0, r0, 1290 + i) > 0.45 ? 0x625a4b : 0x29241c, isVisible ? 0.62 : 0.32);
                  g.drawRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
                  g.endFill();
                }
              }}
            />
            <Graphics
              draw={(g) => {
                g.clear();
                faces.forEach((face) => {
                  const { topA, topB, bottomA, bottomB } = face;
                  const shade = face.side === 'E' ? 0.18 + fogShade : 0.3 + fogShade;
                  const color = mixColor(wallColor, 0x000000, clamp(shade, 0, 0.65));
                  fillQuad(g as PixiGraphics, topA, topB, bottomB, bottomA, color, 1, anchor);
                  // Fake ambient occlusion: darken toward the base so the wall isn't a single flat tone.
                  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t
                  });
                  for (const aoBand of [{ f0: 0.42, f1: 0.7, a: 0.05 }, { f0: 0.7, f1: 0.88, a: 0.09 }, { f0: 0.88, f1: 1, a: 0.15 }]) {
                    fillQuad(
                      g as PixiGraphics,
                      lerp(topA, bottomA, aoBand.f0),
                      lerp(topB, bottomB, aoBand.f0),
                      lerp(topB, bottomB, aoBand.f1),
                      lerp(topA, bottomA, aoBand.f1),
                      0x000000,
                      aoBand.a,
                      anchor
                    );
                  }
                  lineSegment(g as PixiGraphics, topA, bottomA, darkenColor(wallColor, 0.35), 0.6, 1.3, anchor);
                  lineSegment(g as PixiGraphics, topB, bottomB, darkenColor(wallColor, 0.45), 0.7, 1.3, anchor);
                  drawFacadeMaterial(
                    g as PixiGraphics,
                    bottomA,
                    bottomB,
                    heightPx,
                    anchor,
                    wallColor,
                    facadeMaterial,
                    fogShade
                  );
                  drawFaceDamage(
                    g as PixiGraphics,
                    bottomA,
                    bottomB,
                    heightPx,
                    anchor,
                    wallColor,
                    0.45 + grimeStrength,
                    q0 * 97 + r0 * 131 + (face.side === 'E' ? 17 : 29)
                  );
                  drawFacadeEdgeWear(
                    g as PixiGraphics,
                    bottomA,
                    bottomB,
                    heightPx,
                    anchor,
                    wallColor,
                    q0 * 173 + r0 * 211 + (face.side === 'E' ? 43 : 61)
                  );
                  faceInfos.push(face);
                });
              }}
            />
            <Graphics
              draw={(g) => {
                g.clear();
                faceInfos.forEach((face) => {
                  if (windowConfig.sides.includes(face.side)) {
                    drawWindowsOnBottomEdge(g as PixiGraphics, face.bottomA, face.bottomB, heightPx, anchor, windowConfig, fogShade);
                  }
                  doorConfigs.forEach((doorRaw) => {
                    if (doorRaw.side !== face.side) return;
                    const door: DoorLayoutConfig = {
                      offset: doorRaw.offset,
                      widthPx: doorRaw.widthPx ?? Math.max(32, Math.round(levelHeightPx * 0.8)),
                      heightPx: doorRaw.heightPx ?? Math.round(levelHeightPx * 1.6),
                      color: doorRaw.color ?? accentColor,
                      kind: doorRaw.kind ?? 'roller'
                    };
                    drawDoorOnBottomEdge(g as PixiGraphics, face.bottomA, face.bottomB, heightPx, anchor, door);
                  });
                  if (grimeStrength > 0.001) {
                    drawGrimeBand(g as PixiGraphics, face.bottomA, face.bottomB, heightPx, anchor, grimeStrength);
                  }
                });
              }}
            />
            <Graphics
              zIndex={1}
              draw={(g) => {
                g.clear();
                const topPoly = [topNW, topNE, topSE, topSW];
                if (roofCfg.kind === 'flat') {
                  g.beginFill(mixColor(roofColor, 0x000000, 0.05 + fogShade), 1);
                  drawPoly(
                    g as PixiGraphics,
                    topPoly.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }))
                  );
                  g.endFill();
                } else if (roofCfg.kind === 'gabled') {
                  const pitch = clamp(roofCfg.pitch ?? 0.3, 0, 0.9);
                  const ridgeRise = Math.max(6, Math.round(roofRisePx * (0.75 + pitch)));
                  const dir = roofCfg.dir ?? 'E-W';
                  if (dir === 'E-W') {
                    const midW = { x: (topNW.x + topSW.x) / 2, y: (topNW.y + topSW.y) / 2 };
                    const midE = { x: (topNE.x + topSE.x) / 2, y: (topNE.y + topSE.y) / 2 };
                    const ridgeW = { x: midW.x, y: midW.y - ridgeRise };
                    const ridgeE = { x: midE.x, y: midE.y - ridgeRise };
                    fillQuad(
                      g as PixiGraphics,
                      { x: topNW.x, y: topNW.y },
                      { x: topNE.x, y: topNE.y },
                      ridgeE,
                      ridgeW,
                      mixColor(roofColor, 0x000000, 0.02 + fogShade),
                      1,
                      anchor
                    );
                    fillQuad(
                      g as PixiGraphics,
                      ridgeW,
                      ridgeE,
                      { x: topSE.x, y: topSE.y },
                      { x: topSW.x, y: topSW.y },
                      mixColor(roofColor, 0x000000, 0.12 + fogShade),
                      1,
                      anchor
                    );
                    if (ridgeCap) {
                      drawFasciaLine(g as PixiGraphics, ridgeW, ridgeE, anchor, darkenColor(roofColor, 0.35));
                    }
                  } else {
                    const midN = { x: (topNW.x + topNE.x) / 2, y: (topNW.y + topNE.y) / 2 };
                    const midS = { x: (topSW.x + topSE.x) / 2, y: (topSW.y + topSE.y) / 2 };
                    const ridgeN = { x: midN.x, y: midN.y - ridgeRise };
                    const ridgeS = { x: midS.x, y: midS.y - ridgeRise };
                    fillQuad(
                      g as PixiGraphics,
                      { x: topNW.x, y: topNW.y },
                      ridgeN,
                      ridgeS,
                      { x: topSW.x, y: topSW.y },
                      mixColor(roofColor, 0x000000, 0.02 + fogShade),
                      1,
                      anchor
                    );
                    fillQuad(
                      g as PixiGraphics,
                      ridgeN,
                      { x: topNE.x, y: topNE.y },
                      { x: topSE.x, y: topSE.y },
                      ridgeS,
                      mixColor(roofColor, 0x000000, 0.11 + fogShade),
                      1,
                      anchor
                    );
                    if (ridgeCap) {
                      drawFasciaLine(g as PixiGraphics, ridgeN, ridgeS, anchor, darkenColor(roofColor, 0.35));
                    }
                  }
                } else {
                  const roofCenter = {
                    x: (topNW.x + topNE.x + topSE.x + topSW.x) / 4,
                    y: (topNW.y + topNE.y + topSE.y + topSW.y) / 4
                  };
                  const pitch = clamp(roofCfg.pitch ?? 0.25, 0, 1);
                  const center = {
                    x: roofCenter.x,
                    y: roofCenter.y - Math.max(5, Math.round(roofRisePx * pitch))
                  };
                  const faces = [
                    { poly: [topNW, topNE, center], shade: 0.02 },
                    { poly: [topNE, topSE, center], shade: 0.08 },
                    { poly: [topSE, topSW, center], shade: 0.13 },
                    { poly: [topSW, topNW, center], shade: 0.05 }
                  ];
                  faces.forEach(({ poly, shade }) => {
                    g.beginFill(mixColor(roofColor, 0x000000, shade + fogShade), 1);
                    drawPoly(
                      g as PixiGraphics,
                      poly.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y }))
                    );
                    g.endFill();
                  });
                }

                drawFasciaLine(g as PixiGraphics, topNE, topSE, anchor, roofTrimColor);
                drawFasciaLine(g as PixiGraphics, topSE, topSW, anchor, roofTrimColor);
                drawRoofSurfaceDetail(
                  g as PixiGraphics,
                  topPoly.map((p) => ({ x: p.x, y: p.y })),
                  anchor,
                  roofColor,
                  fogShade,
                  q0 * 109 + r0 * 151
                );

                drawRoofVents(
                  g as PixiGraphics,
                  topPoly.map((p) => ({ x: p.x, y: p.y })),
                  anchor,
                  roofVents,
                  lightenColor(roofColor, 0.1)
                );

                if (b.id === 'spire-core') {
                  const roofCenter = {
                    x: (topNW.x + topNE.x + topSE.x + topSW.x) / 4,
                    y: (topNW.y + topNE.y + topSE.y + topSW.y) / 4 - Math.max(5, roofRisePx * 0.85)
                  };
                  const apex = {
                    x: roofCenter.x,
                    y: roofCenter.y - Math.max(18, levelHeightPx * 1.35)
                  };
                  g.lineStyle(6, 0x08050d, isVisible ? 0.9 : 0.42);
                  g.moveTo(roofCenter.x - anchor.x, roofCenter.y - anchor.y + 2);
                  g.lineTo(apex.x - anchor.x, apex.y - anchor.y);
                  g.lineStyle(2.2, 0x8f66c5, isVisible ? 0.82 : 0.36);
                  g.moveTo(roofCenter.x - anchor.x, roofCenter.y - anchor.y + 1);
                  g.lineTo(apex.x - anchor.x, apex.y - anchor.y);
                  g.beginFill(0xb89aff, isVisible ? 0.34 : 0.14);
                  g.drawCircle(apex.x - anchor.x, apex.y - anchor.y, 4.2);
                  g.endFill();
                  g.lineStyle(1.2, 0x5a3f83, isVisible ? 0.58 : 0.24);
                  g.moveTo(roofCenter.x - anchor.x - 7, roofCenter.y - anchor.y + 2);
                  g.lineTo(apex.x - anchor.x, apex.y - anchor.y + 7);
                  g.moveTo(roofCenter.x - anchor.x + 7, roofCenter.y - anchor.y + 2);
                  g.lineTo(apex.x - anchor.x, apex.y - anchor.y + 7);
                }
              }}
            />
          </Container>
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [movementOcclusionCoordinate, map.props, map.width, map.height, battleState.sides, exploredTiles, visibleTiles, topGeomFor, selectedUnitId, targetUnitId, movingUnit?.unitId, viewerFaction]);

  // Keyboard pan animation loop: apply velocity from Arrow keys continuously (stable, no restarts)
  useEffect(() => {
    let rafId: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const vel = panVelRef.current;
      if ((vel.x !== 0 || vel.y !== 0) && hostSize.w > 0 && hostSize.h > 0) {
        setFollowTargetPx((prev) => {
          // If no follow center yet, start from selected unit or map center
          const current = prev ?? (() => {
            let selected: UnitInstance | undefined;
            if (selectedUnitId) {
              for (const side of Object.values(battleState.sides)) {
                const u = side.units.get(selectedUnitId);
                if (u) { selected = u; break; }
              }
            }
            const coord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
            const p = toScreen(coord);
            return { x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y };
          })();
          const s = scaleRef.current || 1;
          const next = {
            x: current.x + (vel.x * dt) / s,
            y: current.y + (vel.y * dt) / s
          };
          return {
            x: Math.max(0, Math.min(stageDimensions.width, next.x)),
            y: Math.max(0, Math.min(stageDimensions.height, next.y))
          };
        });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hostSize.h, hostSize.w, battleState.sides, isoBaseX, map.width, map.height, selectedUnitId, stageDimensions.height, stageDimensions.width]);

  const rangeOverlayLayer = (
    <>
      {globalRangeOverlays}
      {movementRangeOverlays}
      {attackRangeOverlays}
      {plannedHighlights}
      {objectiveOverlays}
      {arrivalOverlays}
      {scenarioEventOverlays}
      {startZoneOverlays}
    </>
  );

  const presentationMetricsRef = useRef<HTMLDivElement | null>(null);
  const pendingPresentationFrameRef = useRef<number | null>(null);
  const presentationIdentity = battleIdentity ?? map.id;
  const presentationIdentityRef = useRef(presentationIdentity);
  presentationIdentityRef.current = presentationIdentity;
  const drawPresentationSentinel = useCallback((g: PixiGraphics) => {
    g.clear();
    g.beginFill(0xffffff, 0);
    g.drawRect(0, 0, 1, 1);
    g.endFill();

    if (pendingPresentationFrameRef.current !== null) {
      cancelAnimationFrame(pendingPresentationFrameRef.current);
    }
    const pendingIdentity = presentationIdentity;
    pendingPresentationFrameRef.current = requestAnimationFrame(() => {
      pendingPresentationFrameRef.current = requestAnimationFrame(() => {
        if (presentationIdentityRef.current === pendingIdentity) {
          presentationMetricsRef.current?.setAttribute('data-presented-battle-id', pendingIdentity);
        }
        pendingPresentationFrameRef.current = null;
      });
    });
  }, [presentationIdentity]);
  useEffect(() => () => {
    if (pendingPresentationFrameRef.current !== null) {
      cancelAnimationFrame(pendingPresentationFrameRef.current);
    }
  }, []);

  // Memoized: @pixi/react re-runs a Graphics draw callback whenever its identity changes, and these
  // two rebuild their whole geometry — inline closures re-tessellated them on every render tick.
  const drawOverlayMask = useCallback((g: PixiGraphics) => {
    g.clear();
    g.beginFill(0xffffff, 1);
    g.drawRect(-10000, -10000, 20000, 20000);
    const EDGE_KEYS: EdgeKey[] = ['N', 'E', 'S', 'W'];
    const EDGE_VECTORS: Record<EdgeKey, { dq: number; dr: number }> = {
      N: { dq: 0, dr: -1 },
      E: { dq: +1, dr: 0 },
      S: { dq: 0, dr: +1 },
      W: { dq: -1, dr: 0 }
    };
    const idxAt = (qq: number, rr: number) => rr * map.width + qq;
    const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;
    for (let rr = 0; rr < map.height; rr++) {
      for (let qq = 0; qq < map.width; qq++) {
        const index = idxAt(qq, rr);
        if (!visibleTiles.has(index)) continue;
        const tileCorners = snappedCorners.getCorners(qq, rr);
        const avgHeight = averageCornerHeight(tileCorners);
        const localPoints = makeCornerPoints(tileCorners, avgHeight);
        const worldPos = toScreen({ q: qq, r: rr });
        const worldOffsetY = worldPos.y - avgHeight * ELEV_Y_OFFSET;
        const worldPoints: Record<CornerKey, { x: number; y: number }> = {
          NW: { x: worldPos.x + localPoints.NW.x, y: worldOffsetY + localPoints.NW.y },
          NE: { x: worldPos.x + localPoints.NE.x, y: worldOffsetY + localPoints.NE.y },
          SE: { x: worldPos.x + localPoints.SE.x, y: worldOffsetY + localPoints.SE.y },
          SW: { x: worldPos.x + localPoints.SW.x, y: worldOffsetY + localPoints.SW.y }
        };
        const myHeights: Record<CornerKey, number> = {
          NW: tileCorners.hNW,
          NE: tileCorners.hNE,
          SE: tileCorners.hSE,
          SW: tileCorners.hSW
        };
        EDGE_KEYS.forEach((edge) => {
          const vec = EDGE_VECTORS[edge];
          const nq = qq + vec.dq;
          const nr = rr + vec.dr;
          const neighborIdx = inb(nq, nr) ? idxAt(nq, nr) : -1;
          const neighborCorners = neighborIdx >= 0 ? snappedCorners.getCorners(nq, nr) : null;
          const neighborHeights: Record<CornerKey, number> | null = neighborCorners
            ? {
                NW: neighborCorners.hNW,
                NE: neighborCorners.hNE,
                SE: neighborCorners.hSE,
                SW: neighborCorners.hSW
              }
            : null;
          const [myA, myB] = EDGE_TO_CORNERS[edge];
          const [oppA, oppB] = EDGE_TO_CORNERS[OPP_EDGE[edge]];
          const myAvg = (myHeights[myA] + myHeights[myB]) / 2;
          const neighborAvg = neighborHeights
            ? (neighborHeights[oppA] + neighborHeights[oppB]) / 2
            : 0;
          const delta = myAvg - neighborAvg;
          if (delta < 2) return;
          const topA = worldPoints[myA];
          const topB = worldPoints[myB];
          const depth = delta * CLIFF_DEPTH;
          const bottomA = { x: topA.x, y: topA.y + depth };
          const bottomB = { x: topB.x, y: topB.y + depth };
          g.beginHole();
          g.moveTo(topA.x, topA.y);
          g.lineTo(topB.x, topB.y);
          g.lineTo(bottomB.x, bottomB.y);
          g.lineTo(bottomA.x, bottomA.y);
          g.closePath();
          g.endHole();
        });
      }
    }
    g.endFill();
  }, [map.height, map.width, snappedCorners, visibleTiles]);

  const drawMinimap = useCallback((g: PixiGraphics) => {
    const mmW = 160;
    const mmH = 120;
    const sx = mmW / stageDimensions.width;
    const sy = mmH / stageDimensions.height;
    g.clear();
    // frame
    g.beginFill(0x000000, 0.35);
    g.drawRoundedRect(-4, -4, mmW + 8, mmH + 8, 6);
    g.endFill();
    g.beginFill(0x0b1a2b, 0.85);
    g.drawRect(0, 0, mmW, mmH);
    g.endFill();
    // fog-of-war overlay (unexplored=dark, explored-not-visible=dim)
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const idx = r * map.width + q;
        const p = toScreen({ q, r });
        const tx = (p.x + (ISO_MODE ? isoBaseX : 0)) * sx;
        const ty = p.y * sy;
        if (!exploredTiles.has(idx)) {
          g.beginFill(0x000000, 0.7);
          g.drawRect(tx - 1.5, ty - 1.5, 3, 3);
          g.endFill();
        } else if (!visibleTiles.has(idx)) {
          g.beginFill(0x000000, 0.35);
          g.drawRect(tx - 1.5, ty - 1.5, 3, 3);
          g.endFill();
        }
      }
    }
    // units dots (respect fog-of-war: show enemies only if visible to viewer)
    const allUnits = Object.values(battleState.sides).flatMap((side) => Array.from(side.units.values()));
    for (const u of allUnits) {
      if (u.stance === 'destroyed' || u.embarkedOn) continue;
      const tileIdx = u.coordinate.r * map.width + u.coordinate.q;
      const isFriendly = u.faction === viewerFaction;
      const isVisible = visibleTiles.has(tileIdx);
      if (!isFriendly && !isVisible) continue;
      const p = toScreen(u.coordinate);
      const ux = (p.x + (ISO_MODE ? isoBaseX : 0)) * sx;
      const uy = p.y * sy;
      g.beginFill(u.faction === 'alliance' ? 0x5dade2 : 0xe74c3c, 0.95);
      g.drawRect(ux - 1, uy - 1, 2, 2);
      g.endFill();
    }
    // viewport rectangle
    const viewWorldX = (-offsetX) / scale;
    const viewWorldY = (-offsetY) / scale;
    const viewWorldW = hostSize.w / scale;
    const viewWorldH = hostSize.h / scale;
    g.lineStyle(1, 0xffffff, 0.9);
    g.drawRect(viewWorldX * sx, viewWorldY * sy, viewWorldW * sx, viewWorldH * sy);
  }, [battleState.sides, exploredTiles, hostSize.h, hostSize.w, isoBaseX, map.height, map.width, offsetX, offsetY, scale, stageDimensions.height, stageDimensions.width, viewerFaction, visibleTiles]);

  return (
    <div
      ref={hostRef}
      className={`battlefield-stage-host battlefield-palette-${battleState.weather ?? 'clear'}`}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      onPointerDown={(e) => {
        if (e.button !== 0 || minimapDragging) return;
        setDraggingCam(true);
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        if (!followTargetPx) {
          setFollowTargetPx({
            x: (-offsetX + hostSize.w / 2) / scale,
            y: (-offsetY + hostSize.h / 2) / scale
          });
        }
      }}
      onPointerMove={(e) => {
        if (!draggingCam) return;
        const last = lastPointerRef.current;
        if (!last) return;
        const nx = e.clientX, ny = e.clientY;
        const dx = nx - last.x, dy = ny - last.y;
        lastPointerRef.current = { x: nx, y: ny };
        setFollowTargetPx((prev) => {
          const current = prev ?? {
            x: (-offsetX + hostSize.w / 2) / scale,
            y: (-offsetY + hostSize.h / 2) / scale
          };
          const next = { x: current.x - dx / scale, y: current.y - dy / scale };
          return {
            x: Math.max(0, Math.min(stageDimensions.width, next.x)),
            y: Math.max(0, Math.min(stageDimensions.height, next.y))
          };
        });
      }}
      onPointerUp={() => { setDraggingCam(false); lastPointerRef.current = null; }}
      onPointerLeave={() => { setDraggingCam(false); lastPointerRef.current = null; }}
    >
      {minimapVisible && (
        <div data-testid="minimap" style={{ position: 'absolute', top: 8, left: 8, width: 160, height: 120, pointerEvents: 'none' }} />
      )}
      {/* Hidden camera metrics for E2E assertions */}
      <div data-testid="camera-metrics" style={{ display: 'none' }}
           data-center-x={(-offsetX + hostSize.w / 2) / scale}
           data-center-y={(-offsetY + hostSize.h / 2) / scale}
           data-scale={scale}
      />
      {/* Hidden map metrics for E2E assertions */}
      <div data-testid="map-metrics" style={{ display: 'none' }}
           ref={presentationMetricsRef}
           data-map-width={map.width}
           data-map-height={map.height}
           data-battle-id={battleIdentity}
           data-presented-battle-id=""
      />
      <div
        data-testid="battlefield-render-profile"
        style={{ display: 'none' }}
        data-fow-memory-alpha={rememberedBuildingProfile.containerAlpha}
        data-fow-memory-tint={rememberedBuildingProfile.spriteTint.toString(16).padStart(6, '0')}
        data-terrain-detail-texture={terrainMacroTexture.baseTexture.valid
          ? `${terrainMacroTexture.width}x${terrainMacroTexture.height}`
          : 'unavailable'}
        data-terrain-grid-alpha={TERRAIN_GRID_ALPHA}
        data-terrain-wash-visibility-radius={TERRAIN_WASH_VISIBILITY_RADIUS}
        data-contact-shadow-layers={softShadowLayers(1).length}
      />


      {/* Minimap + help toggles (top-right; mirror the keyboard shortcuts for discoverability) */}
      <button data-testid="minimap-toggle" onClick={() => setMinimapVisible((v) => !v)}
        style={{ position: 'absolute', top: 8, right: 42, height: 28, padding: '0 9px', borderRadius: 4, border: '1px solid #2a3b55', background: minimapVisible ? '#1d3a57' : '#112238', color: '#e6eefc', cursor: 'pointer', fontSize: 12 }}
        title={t('tooltip.toggleMinimap')}
      >{t('controls.map')}</button>
      <button data-testid="keyboard-help-toggle" onClick={() => setHelpVisible((v) => !v)}
        style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 4, border: '1px solid #2a3b55', background: helpVisible ? '#1d3a57' : '#112238', color: '#e6eefc', cursor: 'pointer' }}
        title={t('tooltip.toggleHelp')}
      >?</button>

      {helpVisible && (
        <div data-testid="keyboard-help" style={{ position: 'absolute', top: 40, right: 8, background: 'rgba(11,26,43,0.94)', color: '#fefefe', padding: '10px 12px', borderRadius: 6, fontSize: 12, lineHeight: 1.45, maxWidth: 282 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>{t('help.title')}</div>
          <ul style={{ margin: '0 0 8px', paddingLeft: 16 }}>
            <li>{t('help.clickSelect')}</li>
            <li>{t('help.clickMove')}</li>
            <li>{t('help.clickAttack')}</li>
            <li>{t('help.overwatchHint')}</li>
            <li>{t('help.startBattleHint')}</li>
            <li>{t('help.endTurnHint')}</li>
          </ul>
          <div style={{ fontWeight: 700, marginBottom: 6, letterSpacing: 0.5 }}>{t('help.hotkeysTitle')}</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>{t('help.hotkeys.pan')}</li>
            <li>{t('help.hotkeys.zoom')}</li>
            <li>{t('help.hotkeys.minimap')}</li>
            <li>{t('help.hotkeys.help')}</li>
          </ul>
        </div>
      )}

      {!webglAvailable ? (
        <div
          data-testid="webgl-required"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: '#050908',
            color: '#d8e3d0',
            padding: 24,
            zIndex: 20
          }}
        >
          <div
            style={{
              width: 'min(620px, calc(100vw - 48px))',
              border: '1px solid #33423a',
              background: 'linear-gradient(180deg, rgba(20,31,28,0.98), rgba(8,14,13,0.98))',
              boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
              padding: 24
            }}
          >
            <div style={{ color: '#d4a520', fontWeight: 800, fontSize: 22, letterSpacing: 1.5, marginBottom: 12 }}>
              {t('webglRequired.title')}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#edf4e8', marginBottom: 18 }}>
              {t('webglRequired.message')}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#d4a520',
                color: '#050908',
                border: '1px solid #f4c520',
                padding: '10px 14px',
                fontWeight: 800,
                cursor: 'pointer',
                textTransform: 'uppercase'
              }}
            >
              {t('webglRequired.reload')}
            </button>
          </div>
        </div>
      ) : (

      <Stage
        width={hostSize.w}
        height={hostSize.h}
        options={{
          backgroundColor: 0x020506, // match screenBackdrop so there's no navy flash on mount/resize
          resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
          autoDensity: true, // makes text and sprites crisp on retina displays
          antialias: true // smooths the hard isometric polygon edges (buildings, tiles)
        }}
      >
        {screenBackdrop}
        <Container x={combatOffsetX} y={combatOffsetY} scale={combatScale}>
          {/* World container. In HEX mode we fake tilt; in ISO mode it's identity. */}
          <Container x={ISO_MODE ? isoBaseX : 0} scale={{ x: 1, y: ISO_MODE ? 1 : 0.72 }} skew={{ x: ISO_MODE ? 0 : -0.28, y: 0 }}>
            {voidSkirt}
            {battlefieldBackdrop}
            {tileGraphics}
            {terrainGrimeLayer}
            {tileOverlays}
            {terrainMissingTexts}
            {/* Top-only overlay mask: punch holes for all vertical wall faces (E/S) */}
            <Graphics ref={setOverlayMaskNode} draw={drawOverlayMask} />

            {/* Overlays clipped by the mask (no spill over walls) */}
            {activeOverlayMask ? (
              <Container mask={activeOverlayMask}>{rangeOverlayLayer}</Container>
            ) : (
              <Container>{rangeOverlayLayer}</Container>
            )}

            {tileWalls}
            <Container sortableChildren>
              {procBuildings}
              {propsSprites}
              {deathMarkerSprites}
              {targetLinkOverlay}
              {units}
              {attackEffectSprites}
              {invalidMoveHighlight}
            </Container>
          </Container>
        </Container>
        {/* Weather atmosphere (screen-space, above the world, below the minimap/HUD). Night scenarios
            read as bright day without this; fog gets a light haze. Kept non-interactive. */}
        {battleState.weather && battleState.weather !== 'clear' ? (
          <Graphics
            draw={(g) => {
              g.clear();
              if (battleState.weather === 'night') {
                // Moonlit blue, not pitch black — still clearly night but the battlefield stays readable.
                g.beginFill(0x18294a, 0.28);
              } else {
                // Dim cool haze. A lighter grey at higher alpha brightened the (dark) terrain and made
                // fog maps look washed-out/over-lit; this darker, subtler tone reads as mist without it.
                g.beginFill(0x4d5860, 0.16);
              }
              g.drawRect(0, 0, hostSize.w, hostSize.h);
              g.endFill();
            }}
          />
        ) : null}
        {hostSize.w > 0 && hostSize.h > 0 ? (
          <Sprite texture={vignetteTexture} width={hostSize.w} height={hostSize.h} eventMode="none" />
        ) : null}
        <Graphics
          eventMode="static"
          cursor="pointer"
          pointertap={handleBattlefieldTap}
          pointermove={handleBattlefieldHover}
          pointerout={handleBattlefieldHoverEnd}
          draw={(g) => {
            g.clear();
            g.beginFill(0x000000, 0.001);
            g.drawRect(0, 0, hostSize.w, hostSize.h);
            g.endFill();
          }}
        />
        {/* Minimap (screen-space) */}
        {minimapVisible && (
          <Container x={10} y={10} eventMode="static"
            pointerdown={(e: FederatedPointerEvent) => {
              setMinimapDragging(true);
              const mmW = 160; const mmH = 120;
              const sx = mmW / stageDimensions.width; const sy = mmH / stageDimensions.height;
              const local = e.data?.getLocalPosition?.(e.currentTarget as DisplayObject) ?? { x: e.offsetX, y: e.offsetY };
              const worldX = local.x / sx; const worldY = local.y / sy;
              setFollowTargetPx({ x: worldX, y: worldY });
            }}
            pointermove={(e: FederatedPointerEvent) => {
              if (!minimapDragging) return;
              const mmW = 160; const mmH = 120;
              const sx = mmW / stageDimensions.width; const sy = mmH / stageDimensions.height;
              const local = e.data?.getLocalPosition?.(e.currentTarget as DisplayObject) ?? { x: e.offsetX, y: e.offsetY };
              const worldX = local.x / sx; const worldY = local.y / sy;
              setFollowTargetPx({ x: worldX, y: worldY });
            }}
            pointerup={() => setMinimapDragging(false)}
          >
            <Graphics draw={drawMinimap} />
          </Container>
        )}
        <Graphics draw={drawPresentationSentinel} eventMode="none" />

      </Stage>
      )}
    </div>
  );
}
