import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance, MapProp, EdgeDir } from '@spellcross/core';
import { movementMultiplierForStance } from '@spellcross/core';
import { canAffordAttack } from '@spellcross/core';
import { axialDistance } from '@spellcross/core';
import { calculateAttackRange } from '@spellcross/core';
import { Container, Graphics, Sprite, Stage, Text } from '@pixi/react';
import { Matrix, Texture, Rectangle, Polygon, MIPMAP_MODES, SCALE_MODES, settings } from 'pixi.js';
import type { FederatedPointerEvent, Graphics as PixiGraphics } from 'pixi.js';

import { TextStyle } from 'pixi.js';
const basename = (p: string) => {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
};
const assetUrl = (path: string) => (path.startsWith('/') ? path : `/${path}`);
(settings as any).SCALE_MODE = SCALE_MODES.LINEAR;
settings.ROUND_PIXELS = true;

const webglContextNames = ['webgl2', 'webgl', 'experimental-webgl'] as const;

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
  const baseTexture = texture.baseTexture as any;
  if (baseTexture) {
    baseTexture.scaleMode = SCALE_MODES.LINEAR;
    baseTexture.mipmap = MIPMAP_MODES.OFF;
    baseTexture.update?.();
  }
  return texture;
};

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)
const DEATH_TTL_MS = 20_000;


// Isometric elevation illusion parameters
const ELEV_Y_OFFSET = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // vertical pixel offset per elevation level (screen)
const CLIFF_DEPTH   = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // sheer cliff face height per level

const terrainPalette: Record<string, number> = {
  plain: 0x4b7139,
  road: 0x756650,
  forest: 0x203b1c,
  urban: 0x625f57,
  hill: 0x6b7040,
  water: 0x226480,
  swamp: 0x3a5437,
  structure: 0x62584b
};

export interface AttackEffect {
  id: string;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  startTime: number;
  type: 'gunshot' | 'explosion' | 'magic' | 'melee';
  damage?: number;
  hit?: boolean;
}

export interface MovingUnit {
  unitId: string;
  path: HexCoordinate[];
  startTime: number;
  stepDuration: number;
  preAlignDuration?: number;
}

export interface InvalidMoveFeedback {
  coordinate: HexCoordinate;
  time: number;
}

export interface BattlefieldStageProps {
  battleState: TacticalBattleState;
  onSelectUnit?: (unitId: string) => void;
  onSelectTile?: (coordinate: HexCoordinate) => void;
  plannedPath?: HexCoordinate[];
  plannedDestination?: HexCoordinate;
  invalidMoveFeedback?: InvalidMoveFeedback | null;
  targetUnitId?: string;
  focusTargetUnitId?: string;
  restoreCameraSignal?: number;
  deployMode?: boolean;
  targetHitChance?: number; // 0-1, hit chance to display on target
  targetDamagePreview?: number; // predicted damage to show
  selectedUnitId?: string;
  viewerFaction?: FactionId;
  width?: number;
  height?: number;
  cameraMode?: 'fit' | 'follow';
  showAttackOverlay?: boolean;
  rangeOverlayCoords?: Set<string>;
  objectiveCoords?: HexCoordinate[];
  attackEffects?: AttackEffect[];
  movingUnit?: MovingUnit | null;
}

type DeathMarker = { id: string; q: number; r: number; t: number; faction: FactionId };

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
  (ctx as any).imageSmoothingEnabled = false;
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

const lightenColor = (color: number, amount: number) => mixColor(color, 0xffffff, amount);
const darkenColor = (color: number, amount: number) => mixColor(color, 0x000000, amount);
const tileNoise = (q: number, r: number, salt: number) => {
  const value = Math.sin(q * 127.1 + r * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
};
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
const snapCameraScale = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(0.5, Math.round(value * 4) / 4);
};

const CAMERA_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5];

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

const CORNER_KEYS: CornerKey[] = ['NW', 'NE', 'SE', 'SW'];
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
const DIRECTIONAL_UNIT_SPRITES: Record<string, string> = {
  'john-alexander': 'light_infantry',
  'field-medic': 'light_infantry',
  'heavy-infantry': 'heavy_infantry',
  'light-infantry': 'light_infantry',
  rangers: 'rangers'
};
const VEHICLE_DIRECTIONAL_SPRITES = {
  tank: 'tank_directional',
  apc: 'm113_apc',
  artillery: 'artillery_directional'
} as const;
const OPPOSITE_DIRECTION_NAMES: Record<string, string> = {
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
  nw: 'se'
};
const VEHICLE_SHEET_DIRECTION_OVERRIDES: Record<string, Record<string, string>> = {
  tank_directional: OPPOSITE_DIRECTION_NAMES,
  artillery_directional: OPPOSITE_DIRECTION_NAMES
};
const VEHICLE_SHEET_DIRECTION_SUBSTITUTES: Record<string, Record<string, string>> = {
  apc_directional: {
    e: 'se',
    w: 'nw'
  }
};
export const directionNameForOrientation = (orientation: number) => {
  const normalized = ((Math.round(orientation) % 8) + 8) % 8;
  const directionNames = ['se', 'e', 'ne', 'nw', 'w', 'sw', 's', 'n'];
  return directionNames[normalized] ?? 'e';
};

const cleanVehicleSheetDirection = (spriteName: string, direction: string) =>
  VEHICLE_SHEET_DIRECTION_SUBSTITUTES[spriteName]?.[direction] ?? direction;

export const vehicleSheetDirectionNameForOrientation = (orientation: number, spriteName: string) => {
  const direction = directionNameForOrientation(orientation);
  const mapped = VEHICLE_SHEET_DIRECTION_OVERRIDES[spriteName]?.[direction] ?? direction;
  return cleanVehicleSheetDirection(spriteName, mapped);
};

export const directionNameForScreenVector = (vector: { x: number; y: number }) => {
  if (Math.hypot(vector.x, vector.y) < 0.01) return 'e';
  const sectors = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
  const sector = Math.round(Math.atan2(vector.y, vector.x) / (Math.PI / 4));
  return sectors[((sector % 8) + 8) % 8];
};

export const vehicleSheetDirectionNameForScreenVector = (vector: { x: number; y: number }, spriteName: string) =>
  cleanVehicleSheetDirection(spriteName, directionNameForScreenVector(vector));

const UNIT_SHEET_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const UNIT_SHEET_FRAME_SIZE = 128;
const DIRECTIONAL_UNIT_FRAME_SIZES: Record<string, { width: number; height: number }> = {
  m113_apc: { width: 192, height: 128 }
};
const RASTER_UNIT_VISIBLE_HEIGHTS: Record<string, number> = {
  '/assets/generated/apc_m113.png': 525,
  '/assets/generated/artillery_mlrs.png': 870,
  '/assets/generated/helicopter_apache.png': 742,
  '/assets/generated/infantry_squad.png': 767,
  '/assets/generated/ghoul_pack.png': 159,
  '/assets/generated/sniper_team.png': 768,
  '/assets/generated/medic_unit.png': 768,
  '/assets/generated/skeleton_warrior.png': 620,
  '/assets/generated/zombie_horde.png': 994,
  '/assets/generated/ogre_brute.png': 891,
  '/assets/generated/bone_golem.png': 902,
  '/assets/generated/necromancer.png': 929,
  '/assets/generated/death_knight.png': 820,
  '/assets/generated/tank_m1_abrams.png': 572
};
const RASTER_UNIT_ANCHOR_Y: Record<string, number> = {
  '/assets/generated/apc_m113.png': 0.71,
  '/assets/generated/artillery_mlrs.png': 0.9,
  '/assets/generated/bone_golem.png': 0.96,
  '/assets/generated/death_knight.png': 0.99,
  '/assets/generated/ghoul_pack.png': 0.86,
  '/assets/generated/helicopter_apache.png': 0.91,
  '/assets/generated/infantry_squad.png': 0.85,
  '/assets/generated/medic_unit.png': 0.94,
  '/assets/generated/necromancer.png': 0.98,
  '/assets/generated/ogre_brute.png': 0.95,
  '/assets/generated/skeleton_warrior.png': 0.76,
  '/assets/generated/sniper_team.png': 0.98,
  '/assets/generated/tank_m1_abrams.png': 0.65,
  '/assets/generated/watchtower.png': 0.99,
  '/assets/generated/zombie_horde.png': 0.97
};
const DIRECTIONAL_UNIT_ANCHOR_Y: Record<string, number> = {
  artillery_directional: 0.93,
  heavy_infantry: 0.92,
  light_infantry: 0.74,
  m113_apc: 0.887,
  rangers: 0.77,
  apc_directional: 0.98,
  tank_directional: 0.72
};
const DIRECTIONAL_UNIT_SOURCE_HEIGHTS: Record<string, number> = {
  artillery_directional: 110,
  apc_directional: 88,
  m113_apc: 121,
  tank_directional: 86
};
const DIRECTIONAL_UNIT_GROUND_BOTTOMS: Record<string, { idle: number; walk: Record<string, number> }> = {
  apc_directional: {
    idle: 128,
    walk: { n: 114, ne: 116, e: 116, se: 116, s: 114, sw: 117, w: 117, nw: 117 }
  }
};

type UnitVisualFootprint = { rx: number; ry: number; alpha: number; y: number };
type UnitPointerArea = { x: number; y: number; width: number; height: number };
type InteractionUnit = {
  id: string;
  faction: FactionId;
  coordinate: HexCoordinate;
  hitArea: UnitPointerArea;
  x: number;
  y: number;
  z: number;
};

export function unitVisualHeight(tile: number, unitType: string, definitionId: string, directionalSprite?: string) {
  if (unitType === 'vehicle') {
    if (definitionId.includes('heli') || definitionId.includes('apache') || definitionId.includes('chopper')) return tile * 0.58;
    if (definitionId.includes('truck') || definitionId.includes('apc') || definitionId.includes('ifv') || definitionId.includes('m113')) return tile * 0.455;
    if (definitionId.includes('tank') || definitionId.includes('leopard') || definitionId.includes('abrams') || definitionId.includes('m1')) return tile * 0.43;
    return tile * 0.44;
  }
  if (unitType === 'artillery') return tile * 0.52;
  if (unitType === 'hero') return tile * 0.58;
  if (unitType === 'support') return definitionId.includes('truck') ? tile * 0.455 : tile * 0.52;
  if (definitionId.includes('ghoul') || definitionId.includes('zombie') || definitionId.includes('undead')) return tile * 0.46;
  if (definitionId.includes('golem') || definitionId.includes('ogre') || definitionId.includes('brute')) return tile * 0.74;
  if (directionalSprite === 'heavy_infantry') return tile * 0.6;
  if (directionalSprite === 'rangers') return tile * 0.56;
  if (unitType === 'infantry') return tile * 0.56;
  return tile * 0.54;
}

function unitContactFootprint(tile: number, unitType: string, definitionId: string): UnitVisualFootprint {
  if (unitType === 'support' && definitionId.includes('truck')) return { rx: tile * 0.31, ry: tile * 0.082, alpha: 0.48, y: tile * 0.07 };
  if (unitType === 'vehicle') return { rx: tile * 0.31, ry: tile * 0.082, alpha: 0.48, y: tile * 0.07 };
  if (unitType === 'artillery') return { rx: tile * 0.3, ry: tile * 0.075, alpha: 0.4, y: tile * 0.06 };
  if (unitType === 'air') return { rx: tile * 0.22, ry: tile * 0.055, alpha: 0.12, y: tile * 0.08 };
  if (definitionId.includes('ghoul') || definitionId.includes('zombie') || definitionId.includes('undead')) {
    return { rx: tile * 0.25, ry: tile * 0.065, alpha: 0.32, y: tile * 0.04 };
  }
  if (definitionId.includes('golem') || definitionId.includes('ogre') || definitionId.includes('brute')) {
    return { rx: tile * 0.25, ry: tile * 0.075, alpha: 0.34, y: tile * 0.045 };
  }
  return { rx: tile * 0.18, ry: tile * 0.05, alpha: 0.28, y: tile * 0.04 };
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

export function rasterVehiclePose(vector: { x: number; y: number }) {
  const mirrored = vector.x > 0.08;
  const rotation = 0;
  return { mirrored, rotation };
}

function directionalVehicleSprite(unitType: string, definitionId: string) {
  if (unitType === 'support' && definitionId.includes('truck')) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (unitType === 'artillery') return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  if (unitType !== 'vehicle') return undefined;
  if (definitionId.includes('heli') || definitionId.includes('apache') || definitionId.includes('chopper')) return undefined;
  if (definitionId.includes('apc') || definitionId.includes('ifv') || definitionId.includes('m113')) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (definitionId.includes('artillery') || definitionId.includes('mlrs') || definitionId.includes('howitzer')) return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  return VEHICLE_DIRECTIONAL_SPRITES.tank;
}

function unitPointerArea(tile: number, unitType: string, definitionId: string, selected = false): UnitPointerArea {
  const isTruck = definitionId.includes('truck');
  if (unitType === 'vehicle' || (unitType === 'support' && isTruck)) {
    return selected
      ? { x: -tile * 0.18, y: -tile * 0.03, width: tile * 0.36, height: tile * 0.17 }
      : { x: -tile * 0.18, y: -tile * 0.34, width: tile * 0.54, height: tile * 0.52 };
  }
  if (unitType === 'artillery') {
    return { x: -tile * 0.38, y: -tile * 0.46, width: tile * 0.76, height: tile * 0.64 };
  }
  if (selected && (unitType === 'infantry' || unitType === 'hero' || unitType === 'support')) {
    return { x: -tile * 0.18, y: -tile * 0.22, width: tile * 0.36, height: tile * 0.34 };
  }
  if (unitType === 'infantry') {
    return { x: -tile * 0.18, y: -tile * 0.22, width: tile * 0.36, height: tile * 0.34 };
  }
  if (unitType === 'hero') {
    return { x: -tile * 0.26, y: -tile * 0.58, width: tile * 0.52, height: tile * 0.66 };
  }
  if (definitionId.includes('golem') || definitionId.includes('ogre') || definitionId.includes('brute')) {
    return { x: -tile * 0.3, y: -tile * 0.66, width: tile * 0.6, height: tile * 0.74 };
  }
  if (definitionId.includes('ghoul') || definitionId.includes('zombie') || definitionId.includes('undead')) {
    return { x: -tile * 0.34, y: -tile * 0.4, width: tile * 0.68, height: tile * 0.52 };
  }
  if (unitType === 'support') {
    return { x: -tile * 0.28, y: -tile * 0.52, width: tile * 0.56, height: tile * 0.6 };
  }
  return { x: -tile * 0.3, y: -tile * 0.46, width: tile * 0.6, height: tile * 0.58 };
}

const unitSheetTexture = (
  cache: Map<string, Texture>,
  spriteName: string,
  state: 'idle' | 'walk',
  direction: string,
  frame: number
) => {
  const sheetPath = `/assets/generated/${spriteName}_${state}_sheet.png`;
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

export const directionalSpriteGroundOffset = (
  spriteName: string,
  state: 'idle' | 'walk',
  direction: string,
  scale: number
) => {
  if (state !== 'walk') return 0;
  const ground = DIRECTIONAL_UNIT_GROUND_BOTTOMS[spriteName];
  const walkBottom = ground?.walk[direction];
  if (ground === undefined || walkBottom === undefined) return 0;
  return (ground.idle - walkBottom) * scale;
};

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
const PROP_ANCHOR_Y = 0.9;
const missingLabelStyle = new TextStyle({
  fontSize: 9,
  fill: 0xffffff,
  stroke: 0x000000,
  strokeThickness: 3,
  align: 'center'
});
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
  invalidMoveFeedback,
  targetUnitId,
  focusTargetUnitId,
  restoreCameraSignal = 0,
  deployMode = false,
  targetHitChance,
  targetDamagePreview,
  selectedUnitId,
  viewerFaction = 'alliance',
  width,
  height,
  cameraMode = 'fit',
  showAttackOverlay,
  rangeOverlayCoords,
  objectiveCoords = [],
  attackEffects = [],
  movingUnit
}: BattlefieldStageProps) {
  const [webglAvailable] = useState(hasWebGLRenderer);
  const map = battleState.map;
  const viewerVision = battleState.vision[viewerFaction];
  const visibleTiles = viewerVision?.visibleTiles ?? new Set<number>();
  const exploredTiles = viewerVision?.exploredTiles ?? new Set<number>();
  const [now, setNow] = useState(() => Date.now());
  // Update more frequently during animations
  useEffect(() => {
    const interval = (movingUnit || attackEffects.length > 0) ? 16 : 250; // 60fps during animation
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [movingUnit, attackEffects.length]);
  const [deathMarkers, setDeathMarkers] = useState<Map<string, DeathMarker>>(new Map());

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
    overlayMask?.mapId === map.id && !overlayMask.node.destroyed ? overlayMask.node : undefined;

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


  // Maintain a local buffer of recent death markers so they fade out even if the unit object disappears.
  useEffect(() => {
    const next = new Map(deathMarkers);
    for (const side of Object.values(battleState.sides) as any[]) {
      for (const u of (side as any).units.values()) {
        if (u.stance === 'destroyed' && !next.has(u.id)) {
          next.set(u.id, { id: u.id, q: u.coordinate.q, r: u.coordinate.r, t: Date.now(), faction: u.faction });
        }
      }
    }
    if (next.size !== deathMarkers.size) {
      setDeathMarkers(next);
    }
  }, [battleState.sides, deathMarkers]);

  useEffect(() => {
    if (deathMarkers.size === 0) return;
    const cutoff = now - DEATH_TTL_MS;
    let changed = false;
    const next = new Map(deathMarkers);
    for (const [id, marker] of next) {
      if (marker.t < cutoff) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) {
      setDeathMarkers(next);
    }
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
      ctx.fillStyle = shade(grassBase, 0.86);
      for (let i = 0; i < 12; i++) ctx.fillRect((i * 23) % w, (i * 31) % h, 10 + (i % 5), 2);
      for (let i = 0; i < w * h * 0.055; i++) { dot(ctx, (i*29)%w, (i*53)%h, shade(grassBase, 1.1), 0.72); }
      for (let i = 0; i < w * h * 0.035; i++) { dot(ctx, (i*17)%w, (i*41)%h, shade(grassBase, 0.86), 0.74); }
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

    return { plain: grass, road, forest, urban, hill, water, swamp, structure } as Record<string, Texture>;
  }, []);
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

  useEffect(() => {
    if (!allowExternalTextures) {
      setExternalTerrainTextures(null);
      setExternalTexturesAreColored(false);
      setMissingTerrainPng(new Set());
      return;
    }
    let cancelled = false;
    const names = ['plain','road','forest','urban','hill','water','swamp','structure'] as const;

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

    (async () => {
      try {
        const out: Record<string, Texture> = {} as any;
        let anyLoaded = false;
        let explicitColorTextures = false;
        const missing = new Set<string>();
        // 1) Per-terrain PNGs (highest priority if present)
        await Promise.all(
          names.map(async (n) => {
            const url = `/textures/terrain/${n}.png`;
            try {
              const res = await fetch(url, { method: 'GET', cache: 'no-store' });
              if (!res.ok) {
                missing.add(`${n}.png`);
                return;
              }
              const type = res.headers.get('content-type') ?? '';
              if (!type.startsWith('image/')) {
                missing.add(`${n}.png`);
                return;
              }
              const blob = await res.blob();
              await ensureImageDecodable(blob);
              const objUrl = URL.createObjectURL(blob);
              out[n] = crispTexture(Texture.from(objUrl));
              anyLoaded = true;
              explicitColorTextures = true;
            } catch {
              missing.add(`${n}.png`);
            }
          })
        );

        // 2) Spritesheet fallback(s): prefer COLORED sheet if present; else grayscale
        const trySheet = async (url: string, forcedMode?: 'colored' | 'grayscale'): Promise<'colored' | 'grayscale' | null> => {
          try {
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) return null;
            const blob = await res.blob();
            const bmp = await createImageBitmap(blob);
            const cols = 4, rows = 2;
            const cellW = Math.floor(bmp.width / cols);
            const cellH = Math.floor(bmp.height / rows);
            const base = crispTexture(Texture.from(bmp)).baseTexture;
            const rect = (x: number, y: number, w: number, h: number) => new Rectangle(x, y, w, h);
            const sub = (cx: number, cy: number) => crispTexture(new Texture(base, rect(cx * cellW, cy * cellH, cellW, cellH)));
            const order = ['plain','road','forest','urban','hill','water','swamp','structure'] as const;
            const coords: Array<[number, number]> = [[0,0],[1,0],[2,0],[3,0],[0,1],[1,1],[2,1],[3,1]];
            let loaded = false;
            for (let i = 0; i < order.length; i++) {
              const key = order[i];
              if (!out[key]) { // don't overwrite explicit per-terrain PNGs
                out[key] = sub(coords[i][0], coords[i][1]);
                anyLoaded = true;
                loaded = true;
              }
            }
            if (!loaded) return null;
            return forcedMode ?? detectBitmapColorMode(bmp);
          } catch { return null; }
        };
        let sheetMode: 'colored' | 'grayscale' | null = null;
        const sheetCandidates: Array<{ url: string; forcedMode?: 'colored' | 'grayscale' }> = [
          { url: '/textures/textures.png' },                 // user-supplied colored sheet
          { url: '/textures/textures_black.png', forcedMode: 'grayscale' },
          { url: '/pics/textures.png', forcedMode: 'grayscale' },          // repo placeholder sheet (keep grayscale)
          { url: '/pics/textures_black.png', forcedMode: 'grayscale' }
        ];
        for (const candidate of sheetCandidates) {
          const mode = await trySheet(candidate.url, candidate.forcedMode);
          if (!mode) continue;
          sheetMode = mode;
          if (mode === 'colored') break;
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
  }, [allowExternalTextures, terrainTextures]);

  useEffect(() => {
    let cancelled = false;
    const scan = async () => {
      const props = map.props ?? [];
      const paths = Array.from(new Set([
        '/props/tree1.png',
        ...props.map((p) => p.texture).filter(Boolean).map((path) => assetUrl(path as string))
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

  useEffect(() => {
    const targetEffect = attackEffects[attackEffects.length - 1];
    let fromCoord: any | undefined;
    let toCoord: any | undefined;

    if (targetEffect) {
      targetCameraSnapshotRef.current = null;
      fromCoord = { q: targetEffect.fromQ, r: targetEffect.fromR };
      toCoord = { q: targetEffect.toQ, r: targetEffect.toR };
    } else if (selectedUnitId && focusTargetUnitId) {
      if (!targetCameraSnapshotRef.current) {
        targetCameraSnapshotRef.current = {
          targetId: focusTargetUnitId,
          followTargetPx,
          zoom: zoomRef.current
        };
      }
      for (const side of Object.values(battleState.sides) as any[]) {
        fromCoord ??= side.units.get(selectedUnitId)?.coordinate;
        toCoord ??= side.units.get(focusTargetUnitId)?.coordinate;
      }
    }

    if (!fromCoord || !toCoord) return;

    const from = toScreen(fromCoord);
    const to = toScreen(toCoord);
    setFollowTargetPx({
      x: ((from.x + to.x) / 2) + (ISO_MODE ? isoBaseX : 0),
      y: ((from.y + to.y) / 2) + tileSize * 0.2
    });
    const cinematicZoom = targetEffect ? 2.62 : 2.25;
    setZoom((current) => Math.max(current, cinematicZoom));
  }, [attackEffects, battleState.sides, focusTargetUnitId, selectedUnitId, toScreen, tileSize]);

  useEffect(() => {
    if (restoreCameraSignal === lastRestoreCameraSignalRef.current) return;
    lastRestoreCameraSignalRef.current = restoreCameraSignal;
    const snapshot = targetCameraSnapshotRef.current;
    if (!snapshot) return;
    setFollowTargetPx(snapshot.followTargetPx);
    setZoom(snapshot.zoom);
    targetCameraSnapshotRef.current = null;
  }, [restoreCameraSignal]);

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
      setZoom((current) => {
        const next = nextCameraScale(current, direction);
        zoomRef.current = next;
        return next;
      });
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [cameraMode, battleState.sides, selectedUnitId, map.width, map.height]);

  const fitScaleRaw = Math.min(
    hostSize.w > 0 ? hostSize.w / contentWidth : 1,
    hostSize.h > 0 ? hostSize.h / contentHeight : 1
  );
  const fitScale = snapCameraScale(fitScaleRaw);
  const initialFollowZoom = clampCameraScale(Math.max(2.35, snapCameraScale(fitScaleRaw * 1.95)));
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
      for (const side of Object.values(battleState.sides) as any[]) {
        const u = (side as any).units.get(selectedUnitId);
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

  useEffect(() => {
    if (typeof window === 'undefined' || !import.meta.env.DEV) return;
    (window as any).__battleCamera = {
      centerOnCoord: (q: number, r: number) => {
        const p = toScreen({ q, r });
        setFollowTargetPx({ x: p.x + (ISO_MODE ? isoBaseX : 0), y: p.y });
        return true;
      },
      centerOnWorld: (x: number, y: number) => {
        setFollowTargetPx({ x, y });
        return true;
      },
      screenForCoord: (q: number, r: number) => {
        const p = toScreen({ q, r });
        return {
          x: offsetX + (p.x + (ISO_MODE ? isoBaseX : 0)) * scale,
          y: offsetY + p.y * scale
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
      delete (window as any).__battleCamera;
    };
  }, [hostSize.h, hostSize.w, offsetX, offsetY, scale, stageDimensions.height, stageDimensions.width, toScreen]);

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

  const unitByCoord = useMemo(() => {
    const m = new Map<string, any>();
    for (const side of Object.values(battleState.sides) as any[]) {
      for (const u of (side as any).units.values()) {
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
      const t = tileAt(qq, rr);
      if (t?.cornerHeights) {
        const h = t.cornerHeights as Record<CornerKey, number>;
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
    return {
      getCorners: (qq: number, rr: number) => ({
        hNW: V[qq][rr],
        hNE: V[qq + 1][rr],
        hSE: V[qq + 1][rr + 1],
        hSW: V[qq][rr + 1]
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
    const tile = map.tiles[idx] as any;
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
      for (const side of Object.values(battleState.sides) as any[]) {
        const selected = (side as any).units.get(selectedUnitId);
        if (selected?.embarkedOn) {
          selectedEmbarkedCarrierId = selected.embarkedOn;
          break;
        }
      }
    }

    for (const side of Object.values(battleState.sides) as any[]) {
      for (const unit of (side as any).units.values()) {
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
  }, [battleState.sides, map.width, selectedUnitId, tileSize, topGeomFor, viewerFaction, visibleTiles]);

  const handleBattlefieldTap = useCallback((event: FederatedPointerEvent) => {
    if (minimapDragging) return;
    event.stopPropagation();
    const local = event.getLocalPosition?.(event.currentTarget as any) ?? event.global;
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
          g.beginFill(0x050906, 0.22);
          drawPoly(g as unknown as PixiGraphics, outer);
          g.endFill();
          g.beginFill(0x0b150b, 0.1);
          drawPoly(g as unknown as PixiGraphics, middle);
          g.endFill();
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
            g.beginFill(tileNoise(i, map.width, salt + 4) > 0.5 ? 0x1a2b18 : 0x0b1b12, 0.045);
            g.drawEllipse(x, y, 38 + tileNoise(i, map.width, salt + 5) * 70, 12 + tileNoise(i, map.height, salt + 6) * 30);
            g.endFill();
          }
        }}
      />
    );
  }, [map.height, map.width, topGeomFor]);


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
    return map.tiles.map((tile: any, index: number) => {
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
      const fillTerrain = tile.terrain === 'road' ? 'plain' : tile.terrain === 'water' ? 'swamp' : tile.terrain;
      let baseColor = (terrainPalette as any)[fillTerrain] ?? terrainPalette.plain;
      const colorNoise = tileNoise(q, r, 911) - 0.5;
      if (tile.terrain !== 'water') {
        baseColor = colorNoise > 0
          ? lightenColor(baseColor, colorNoise * 0.08)
          : darkenColor(baseColor, Math.abs(colorNoise) * 0.12);
      }
      const roadColor = terrainPalette.road;
      const waterColor = terrainPalette.water;
      const tex =
        (externalTerrainTextures?.[fillTerrain] ?? externalTerrainTextures?.plain) ??
        ((terrainTextures as any)[fillTerrain] ?? (terrainTextures as any).plain);
      const roadTex =
        externalTerrainTextures?.road ??
        ((terrainTextures as any).road ?? tex);
      const waterTex =
        externalTerrainTextures?.water ??
        ((terrainTextures as any).water ?? tex);
      const coloredTex = !!externalTerrainTextures && externalTexturesAreColored;
      const overlayAlpha = coloredTex ? (isVisible ? 0.42 : 0.28) : (isVisible ? 0.17 : 0.11);
      const texMatrix = new Matrix();
      texMatrix.translate((q * 13 + r * 7) % 64, (q * 5 + r * 11) % 64);
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
                const hiddenColor = mixColor(baseColor, 0x020508, 0.72);
                g.beginFill(hiddenColor, 0.92);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                g.endFill();
                g.beginTextureFill({ texture: tex, matrix: texMatrix, alpha: 0.07 });
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                g.endFill();
                g.lineStyle(1, 0x0b1722, 0.2);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                return;
              }
              for (const tri of tris) {
                const [a, b, c] = tri;
                g.beginFill(baseColor, isVisible ? 0.98 : 0.58);
                g.moveTo(cornerPoints[a].x, cornerPoints[a].y);
                g.lineTo(cornerPoints[b].x, cornerPoints[b].y);
                g.lineTo(cornerPoints[c].x, cornerPoints[c].y);
                g.closePath();
                g.endFill();
              }
              for (const tri of tris) {
                const [a, b, c] = tri;
                g.beginTextureFill({ texture: tex, matrix: texMatrix, alpha: overlayAlpha });
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
                  const neighbor = map.tiles[idxAt(q + vec.dq, r + vec.dr)] as any;
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
                  const roadTextureMatrix = new Matrix();
                  roadTextureMatrix.translate((q * 17 + r * 5 + i * 11) % 64, (q * 3 + r * 19 + i * 7) % 32);
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
                const waterNeighbor = (edge: EdgeKey) => {
                  const vec = EDGE_VECTORS[edge];
                  if (!inb(q + vec.dq, r + vec.dr)) return false;
                  const neighbor = map.tiles[idxAt(q + vec.dq, r + vec.dr)] as any;
                  return neighbor?.terrain === 'water';
                };
                const edgeMid = (edge: EdgeKey) => {
                  const [a, b] = EDGE_TO_CORNERS[edge];
                  return {
                    x: (cornerPoints[a].x + cornerPoints[b].x) / 2,
                    y: (cornerPoints[a].y + cornerPoints[b].y) / 2
                  };
                };
                const connected = EDGE_KEYS.filter(waterNeighbor);
                const exits = connected.length > 0 ? connected : (['E', 'W'] as EdgeKey[]);
                const drawWaterBand = (edge: EdgeKey, width: number, color: number, alpha: number, jitterSalt: number) => {
                  const p = edgeMid(edge);
                  const dx = p.x - center.x;
                  const dy = p.y - center.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  const nx = (-dy / len) * width;
                  const ny = (dx / len) * width * 0.76;
                  const j1 = (tileNoise(q, r, jitterSalt) - 0.5) * 2.4;
                  const j2 = (tileNoise(q, r, jitterSalt + 1) - 0.5) * 2.4;
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
                const bankColor = mixColor(baseColor, waterColor, 0.36);
                exits.forEach((edge, i) => {
                  drawWaterBand(edge, 13.2, bankColor, isVisible ? 0.84 : 0.52, 700 + i * 9);
                });
                g.beginFill(bankColor, isVisible ? 0.86 : 0.54);
                g.drawEllipse(center.x, center.y, 15.5, 7.1);
                g.endFill();
                exits.forEach((edge, i) => {
                  drawWaterBand(edge, 9.6, waterColor, isVisible ? 0.96 : 0.65, 740 + i * 9);
                });
                g.beginFill(waterColor, isVisible ? 0.98 : 0.67);
                g.drawEllipse(center.x, center.y, 11.6, 5.3);
                g.endFill();
                exits.forEach((edge, i) => {
                  const p = edgeMid(edge);
                  const dx = p.x - center.x;
                  const dy = p.y - center.y;
                  const len = Math.max(1, Math.hypot(dx, dy));
                  const nx = (-dy / len) * 6.8;
                  const ny = (dx / len) * 4.1;
                  const poly = [
                    { x: center.x + nx, y: center.y + ny },
                    { x: p.x + nx, y: p.y + ny },
                    { x: p.x - nx, y: p.y - ny },
                    { x: center.x - nx, y: center.y - ny }
                  ];
                  const waterTextureMatrix = new Matrix();
                  waterTextureMatrix.translate((q * 23 + r * 7 + i * 13) % 64, (q * 5 + r * 17 + i * 11) % 32);
                  g.beginTextureFill({ texture: waterTex, matrix: waterTextureMatrix, alpha: isVisible ? 0.46 : 0.24 });
                  drawPoly(g as unknown as PixiGraphics, poly);
                  g.endFill();
                });
              }

              if (isVisible) {
                const decalAlpha = coloredTex ? 0.32 : 0.28;
                const drawSpot = (salt: number, color: number, alpha: number, rx: number, ry: number) => {
                  const px = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.56;
                  const py = (tileNoise(q, r, salt + 17) - 0.5) * ISO_TILE_H * 0.58;
                  g.beginFill(color, alpha);
                  g.drawEllipse(px, py, rx, ry);
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
                const drawEdgeBreakup = (colors: number[], alpha = 0.34) => {
                  EDGE_KEYS.forEach((edge, edgeIndex) => {
                    const [aKey, bKey] = EDGE_TO_CORNERS[edge];
                    const a = cornerPoints[aKey];
                    const b = cornerPoints[bKey];
                    for (let i = 0; i < 2; i++) {
                      const t = 0.18 + tileNoise(q, r, 870 + edgeIndex * 11 + i) * 0.64;
                      const p = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
                      const dx = (b.x - a.x) * 0.08;
                      const dy = (b.y - a.y) * 0.08;
                      const color = colors[(edgeIndex + i) % colors.length] ?? colors[0];
                      g.lineStyle(1, color, alpha * (0.5 + tileNoise(q, r, 880 + edgeIndex * 11 + i) * 0.45));
                      g.moveTo(Math.round(p.x - dx), Math.round(p.y - dy));
                      g.lineTo(Math.round(p.x + dx), Math.round(p.y + dy));
                      g.lineStyle();
                    }
                  });
                };
	                if (tile.terrain === 'plain') {
	                  drawPixelBreakup(410, 14, [darkenColor(baseColor, 0.28), darkenColor(baseColor, 0.16), lightenColor(baseColor, 0.2), 0x334829], 0.26, 5);
	                  drawEdgeBreakup([darkenColor(baseColor, 0.38), lightenColor(baseColor, 0.12)], 0.28);
	                } else if (tile.terrain === 'forest') {
	                  drawPixelBreakup(430, 20, [0x0b180d, 0x153015, 0x2e4a21, 0x4d6c32], 0.36, 5);
	                  drawEdgeBreakup([0x0a160b, 0x315127], 0.31);
	                } else if (tile.terrain === 'hill') {
	                  drawPixelBreakup(450, 18, [darkenColor(baseColor, 0.3), 0x7e7c49, 0x454629, 0x97905d], 0.31, 6);
	                  drawEdgeBreakup([darkenColor(baseColor, 0.44), lightenColor(baseColor, 0.12)], 0.3);
	                } else if (tile.terrain === 'road') {
	                  drawPixelBreakup(470, 14, [0x342a20, 0x7d6d54, 0x4a3d2f, 0x998a6b], 0.32, 7);
	                  drawEdgeBreakup([0x2b241b, 0x7c6e55], 0.32);
	                } else if (tile.terrain === 'urban' || tile.terrain === 'structure') {
	                  drawPixelBreakup(490, 16, [0x2d2c29, 0x746f65, 0x494640, 0x938c7c], 0.31, 5);
	                  drawEdgeBreakup([0x24231f, 0x777268], 0.34);
	                } else if (tile.terrain === 'swamp') {
	                  drawPixelBreakup(510, 14, [0x182516, 0x594c30, 0x416138, 0x0e1d12], 0.32, 5);
                  drawEdgeBreakup([0x121d13, 0x405b35], 0.28);
                } else if (tile.terrain === 'water') {
                  drawPixelBreakup(530, 10, [0x0c2a3a, 0x2f6b7b, 0x78aab0], 0.28, 7);
                }
                const scar = tileNoise(q, r, 103);
                if (scar > 0.7 && tile.terrain !== 'water') {
                  drawSpot(104, 0x17130f, decalAlpha * 1.25, 7 + tileNoise(q, r, 105) * 5, 3.2);
                  drawSpot(106, 0x5f5a4a, decalAlpha * 0.55, 4.5, 1.8);
                }
                if (tile.terrain === 'plain' || tile.terrain === 'hill' || tile.terrain === 'swamp') {
                  drawSpot(1, darkenColor(baseColor, 0.32), decalAlpha, 9, 3.5);
                  drawSpot(2, lightenColor(baseColor, 0.13), decalAlpha * 0.8, 11, 2.7);
                  drawSpot(8, darkenColor(baseColor, 0.24), decalAlpha * 0.8, 4.5, 2.2);
                  drawSpot(15, 0x1b2514, decalAlpha * 0.55, 6, 2.5);
                  drawStroke(30, lightenColor(baseColor, 0.13), decalAlpha * 0.95, 11);
                  drawStroke(31, darkenColor(baseColor, 0.28), decalAlpha * 0.75, 15);
                  drawStroke(37, 0x1a2516, decalAlpha * 0.7, 17);
                } else if (tile.terrain === 'forest') {
                  drawSpot(3, 0x0f2310, decalAlpha * 1.65, 10, 5.5);
                  drawSpot(4, 0x3a5c27, decalAlpha * 1.05, 8, 3.3);
                  drawSpot(12, 0x0b1a0d, decalAlpha * 1.35, 6, 4.4);
                  drawStroke(33, 0x172e14, decalAlpha * 1.1, 15);
                  drawStroke(38, 0x314c24, decalAlpha * 0.7, 11);
                } else if (tile.terrain === 'road' || tile.terrain === 'urban') {
                  const markBase = tile.terrain === 'road' ? roadColor : baseColor;
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
                } else if (tile.terrain === 'water') {
                  g.lineStyle(1, 0x7ab0b8, 0.22);
                  for (let i = 0; i < 3; i++) {
                    const px = (tileNoise(q, r, 80 + i) - 0.5) * ISO_TILE_W * 0.5;
                    const py = (tileNoise(q, r, 90 + i) - 0.5) * ISO_TILE_H * 0.35;
                    g.moveTo(px - 8, py);
                    g.lineTo(px + 8, py - 1);
                  }
                  g.lineStyle();
                  drawSpot(92, 0x0d2f43, 0.2, 11, 3);
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
                const neighborTile = map.tiles[neighborIdx] as any;
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
                if (tile.terrain === 'water' || neighborTile.terrain === 'water') {
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
                  if (tile.terrain !== neighborTile.terrain) {
                    const landTerrain = tile.terrain === 'water' ? neighborTile.terrain : tile.terrain;
                    const landColor = (terrainPalette as any)[landTerrain] ?? terrainPalette.plain;
                    const bankBase = mixColor(landColor, terrainPalette.water, tile.terrain === 'water' ? 0.18 : 0.32);
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
                    g.beginFill(bankBase, tile.terrain === 'water' ? (isVisible ? 0.88 : 0.58) : (isVisible ? 0.62 : 0.36));
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
                  const shoreColor = tile.terrain === neighborTile.terrain ? 0x24485b : 0x8c8a6d;
                  const shoreAlpha = tile.terrain === neighborTile.terrain ? 0.08 : 0.36;
                  g.lineStyle(tile.terrain === neighborTile.terrain ? 1 : 2, shoreColor, shoreAlpha);
                  g.moveTo(a.x, a.y);
                  g.lineTo(mid.x, mid.y);
                  g.lineTo(b.x, b.y);
                  g.lineStyle();
                }
                if (delta > 0 && delta <= 1.05) {
                  const tint = mixColor(
                    baseColor,
                    (terrainPalette as any)[neighborTile.terrain] ?? baseColor,
                    0.45
                  );
                  const alpha = (isVisible ? 0.55 : 0.4) * Math.min(1, delta);
                  g.beginFill(tint, alpha);
                  g.moveTo(center.x, center.y);
                  g.lineTo(cornerPoints[cornerA].x, cornerPoints[cornerA].y);
                  g.lineTo(cornerPoints[cornerB].x, cornerPoints[cornerB].y);
                  g.closePath();
                  g.endFill();
                } else if (delta < 0) {
                  const depth = Math.min(1, Math.abs(delta));
                  const tint = darkenColor(baseColor, 0.25);
                  const alpha = (isVisible ? 0.35 : 0.2) * depth;
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
                const fringeDepth = 0.15 + tileNoise(q, r, 960 + edgeIndex) * 0.12;
                const fringe = [
                  a,
                  b,
                  towardCenter(b, fringeDepth),
                  towardCenter(a, fringeDepth * 0.82)
                ];
                g.beginFill(darkenColor(baseColor, 0.45), isVisible ? 0.24 : 0.16);
                drawPoly(g as unknown as PixiGraphics, fringe);
                g.endFill();
                g.lineStyle(1, 0x050805, isVisible ? 0.2 : 0.12);
                const mid = {
                  x: (a.x + b.x) / 2 + (tileNoise(q, r, 970 + edgeIndex) - 0.5) * 6,
                  y: (a.y + b.y) / 2 + (tileNoise(q, r, 974 + edgeIndex) - 0.5) * 3
                };
                g.moveTo(a.x, a.y);
                g.lineTo(mid.x, mid.y);
                g.lineTo(b.x, b.y);
                g.lineStyle();
              });

              if (isExplored && !isVisible) {
                g.lineStyle(1, 0x0a1a2c, 0.22);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
              }
            }}
          />
      );
    });
  }, [
    externalTerrainTextures,
    externalTexturesAreColored,
    exploredTiles,
    friendlyByCoord,
    map.tiles,
    map.width,
    onSelectTile,
    snappedCorners,
    terrainTextures,
    visibleTiles
  ]);

  const screenBackdrop = useMemo(() => {
    return (
      <Graphics
        draw={(g) => {
          g.clear();
          g.beginFill(0x020506, 1);
          g.drawRect(0, 0, hostSize.w, hostSize.h);
          g.endFill();
          g.beginFill(0x0d1b12, 0.28);
          g.drawPolygon([
            -hostSize.w * 0.08, hostSize.h * 0.22,
            hostSize.w * 0.42, -hostSize.h * 0.1,
            hostSize.w * 1.08, hostSize.h * 0.28,
            hostSize.w * 0.52, hostSize.h * 0.72
          ]);
          g.endFill();
          g.beginFill(0x10150e, 0.22);
          g.drawPolygon([
            hostSize.w * 0.12, hostSize.h * 0.82,
            hostSize.w * 0.78, hostSize.h * 0.48,
            hostSize.w * 1.1, hostSize.h * 0.68,
            hostSize.w * 0.56, hostSize.h * 1.08
          ]);
          g.endFill();
          for (let i = 0; i < 12; i += 1) {
            const y = hostSize.h * (0.12 + i * 0.075);
            g.lineStyle(1, 0x1c3524, 0.055);
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
  }, [hostSize.h, hostSize.w]);

  const tileOverlays = useMemo(() => {
    return map.tiles
      .map((_: any, index: number) => {
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
              g.lineStyle(1, 0x07140d, isVisible ? 0.11 : 0.055);
              g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
              g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
              g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
              g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
              g.closePath();
              if (isVisible) {
                g.lineStyle(1, 0xd7e2b7, 0.035);
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
          for (let index = 0; index < map.tiles.length; index++) {
            if (!exploredTiles.has(index)) continue;
            const tile = map.tiles[index] as any;
            const q = index % map.width;
            const r = Math.floor(index / map.width);
            const visible = visibleTiles.has(index);
            const geom = topGeomFor(q, r);
            const pos = toScreen({ q, r });
            const cx = pos.x + geom.center.x;
            const cy = pos.y - geom.avgHeight * ELEV_Y_OFFSET + geom.center.y;
            const fog = visible ? 1 : 0.45;
            const seed = tileNoise(q, r, 211);
            if (tile.terrain !== 'water' && tileNoise(q, r, 205) > 0.08) {
              const washColor =
                tile.terrain === 'road' || tile.terrain === 'urban'
                  ? 0x2d271e
                  : tile.terrain === 'forest'
                    ? 0x122712
                    : tile.terrain === 'hill'
                      ? 0x4b5530
                      : 0x26391f;
              const rx = ISO_TILE_W * (0.55 + tileNoise(q, r, 206) * 0.55);
              const ry = ISO_TILE_H * (0.22 + tileNoise(q, r, 207) * 0.32);
              const ox = (tileNoise(q, r, 208) - 0.5) * ISO_TILE_W * 0.9;
              const oy = (tileNoise(q, r, 209) - 0.5) * ISO_TILE_H * 0.85;
              g.beginFill(washColor, fog * (0.018 + tileNoise(q, r, 210) * 0.026));
              g.drawEllipse(cx + ox, cy + oy, rx, ry);
              g.endFill();
            }
            if (tile.terrain !== 'water' && seed > 0.18) {
              const color =
                tile.terrain === 'road' || tile.terrain === 'urban'
                  ? 0x1b1713
                  : tile.terrain === 'forest'
                    ? 0x0c1a0d
                    : 0x1d2517;
              const rx = ISO_TILE_W * (0.22 + tileNoise(q, r, 212) * 0.34);
              const ry = ISO_TILE_H * (0.1 + tileNoise(q, r, 213) * 0.18);
              const ox = (tileNoise(q, r, 214) - 0.5) * ISO_TILE_W * 0.45;
              const oy = (tileNoise(q, r, 215) - 0.5) * ISO_TILE_H * 0.5;
              g.beginFill(color, fog * (0.038 + tileNoise(q, r, 216) * 0.032));
              g.drawEllipse(cx + ox, cy + oy, rx, ry);
              g.endFill();
            }
            if (tile.terrain !== 'water' && tileNoise(q, r, 221) > 0.34) {
              const len = ISO_TILE_W * (0.32 + tileNoise(q, r, 222) * 0.35);
              const ox = (tileNoise(q, r, 223) - 0.5) * ISO_TILE_W * 0.5;
              const oy = (tileNoise(q, r, 224) - 0.5) * ISO_TILE_H * 0.5;
              const skew = (tileNoise(q, r, 225) - 0.5) * ISO_TILE_H * 0.28;
              g.lineStyle(1, tile.terrain === 'road' ? 0x6e604c : 0x25361f, fog * 0.14);
              g.moveTo(cx + ox - len / 2, cy + oy - skew);
              g.lineTo(cx + ox + len / 2, cy + oy + skew);
              g.lineStyle();
            }
            if (tile.terrain === 'plain' || tile.terrain === 'forest' || tile.terrain === 'hill' || tile.terrain === 'swamp') {
              const clusters = tile.terrain === 'forest' ? 7 : 5;
              for (let i = 0; i < clusters; i++) {
                const salt = 260 + i * 17;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.58;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.58;
                const blade = 2 + tileNoise(q, r, salt + 2) * 3;
                const color = tile.terrain === 'forest'
                  ? (tileNoise(q, r, salt + 3) > 0.5 ? 0x102610 : 0x2f4c22)
                  : (tileNoise(q, r, salt + 3) > 0.5 ? 0x273820 : 0x4f6134);
                g.lineStyle(1, color, fog * 0.24);
                g.moveTo(cx + ox - blade, cy + oy + 1);
                g.lineTo(cx + ox + blade, cy + oy - 1);
                g.lineStyle();
              }
            }
            if (tile.terrain !== 'water') {
              const flecks = tile.terrain === 'urban' || tile.terrain === 'road' || tile.terrain === 'structure' ? 10 : 8;
              for (let i = 0; i < flecks; i++) {
                const salt = 390 + i * 23;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.62;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.6;
                const warm = tile.terrain === 'road' || tile.terrain === 'urban' || tile.terrain === 'structure';
                const fleckColor = warm
                  ? (tileNoise(q, r, salt + 2) > 0.46 ? 0x7b6b53 : 0x211b15)
                  : tile.terrain === 'forest'
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
            if (tile.terrain === 'road' || tile.terrain === 'urban') {
              for (let i = 0; i < 2; i++) {
                const salt = 520 + i * 19;
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.34;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.32;
                const len = ISO_TILE_W * (0.22 + tileNoise(q, r, salt + 2) * 0.2);
                const skew = (tileNoise(q, r, salt + 3) - 0.5) * ISO_TILE_H * 0.18;
                g.lineStyle(1, tile.terrain === 'road' ? 0x9a8564 : 0x5e5a4e, fog * 0.26);
                g.moveTo(cx + ox - len * 0.5, cy + oy - skew);
                g.lineTo(cx + ox + len * 0.5, cy + oy + skew);
                g.lineStyle(1, 0x15110d, fog * 0.18);
                g.moveTo(cx + ox - len * 0.42, cy + oy + 3 - skew);
                g.lineTo(cx + ox + len * 0.42, cy + oy + 3 + skew);
                g.lineStyle();
              }
            }
            if (tile.terrain === 'water') {
              for (let i = 0; i < 3; i++) {
                const salt = 230 + i * 17;
                const len = ISO_TILE_W * (0.22 + tileNoise(q, r, salt + 2) * 0.22);
                const ox = (tileNoise(q, r, salt) - 0.5) * ISO_TILE_W * 0.42;
                const oy = (tileNoise(q, r, salt + 1) - 0.5) * ISO_TILE_H * 0.42;
                g.lineStyle(1, 0x8fc0c5, fog * (0.14 + tileNoise(q, r, salt + 3) * 0.14));
                g.moveTo(cx + ox - len / 2, cy + oy);
                g.lineTo(cx + ox + len / 2, cy + oy - 1);
                g.lineStyle(2, 0x0b2938, fog * 0.16);
                g.moveTo(cx + ox - len / 3, cy + oy + 4);
                g.lineTo(cx + ox + len / 3, cy + oy + 3);
                g.lineStyle();
              }
            }
          }
        }}
      />
    );
  }, [exploredTiles, map.tiles, map.width, topGeomFor, toScreen, visibleTiles]);
  const coveredByProcBuilding = useMemo(() => {
    const set = new Set<number>();
    const W = map.width;
    const H = map.height;
    const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < W && r < H;
    const idx = (q: number, r: number) => r * W + q;
    for (const prop of map.props ?? []) {
      if (!prop || prop.kind !== 'proc-building') continue;
      if (Array.isArray(prop.tiles) && prop.tiles.length) {
        for (const t of prop.tiles) {
          if (inb(t.q, t.r)) set.add(idx(t.q, t.r));
        }
        continue;
      }
      const q0 = prop.coordinate?.q ?? 0;
      const r0 = prop.coordinate?.r ?? 0;
      const w = Math.max(1, prop.w ?? 1);
      const h = Math.max(1, prop.h ?? 1);
      for (let dq = 0; dq < w; dq++) {
        for (let dr = 0; dr < h; dr++) {
          const qq = q0 + dq;
          const rr = r0 + dr;
          if (inb(qq, rr)) set.add(idx(qq, rr));
        }
      }
    }
    return set;
  }, [map.props, map.width, map.height]);

  const terrainMissingTexts = useMemo(() => {
    if (!allowExternalTextures) return null;
    if (!missingTerrainPng || missingTerrainPng.size === 0) return null;
    const labels: JSX.Element[] = [];
    for (let index = 0; index < map.tiles.length; index++) {
      const tile: any = map.tiles[index];
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
  }, [allowExternalTextures, missingTerrainPng, map.tiles, map.width, snappedCorners, toScreen, coveredByProcBuilding]);
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
    if (!plannedDestination && (!plannedPath || plannedPath.length === 0)) return null;
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
      const geom = ISO_MODE ? topGeomFor(q, r) : null;
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
      const avgHeight = ISO_MODE ? geom!.avgHeight : elev;
      const x = p.x;
      const y = p.y - avgHeight * ELEV_Y_OFFSET;
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

    return elements.filter((el) => (el as any).key !== `mv-${start.q}-${start.r}`);
  }, [battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles, externalTexturesAreColored, topGeomFor, plannedDestination, plannedPath]);

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

    const elements: JSX.Element[] = [];
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
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
      const avgHeight = ISO_MODE && geom ? geom.avgHeight : elev;

      elements.push(
        <Graphics
          key={`rng-${q}-${r}`}
          x={p.x}
          y={p.y - avgHeight * ELEV_Y_OFFSET}
          draw={(g) => {
            g.clear();
            if (ISO_MODE && geom) {
              const shape = geom.inset(0.86);
              g.beginFill(0x89b46f, externalTexturesAreColored ? 0.055 : 0.075);
              drawPoly(g as PixiGraphics, shape);
              g.endFill();
              g.lineStyle(2.15, 0x10190d, 0.3);
              edges.forEach(([aIdx, bIdx], edgeIndex) => {
                const d = edgeDirs[edgeIndex];
                if (rangeOverlayCoords.has(`${q + d.dq},${r + d.dr}`)) return;
                g.moveTo(shape[aIdx].x, shape[aIdx].y);
                g.lineTo(shape[bIdx].x, shape[bIdx].y);
              });
              g.lineStyle(1.05, 0xd2c66e, 0.54);
              edges.forEach(([aIdx, bIdx], edgeIndex) => {
                const d = edgeDirs[edgeIndex];
                if (rangeOverlayCoords.has(`${q + d.dq},${r + d.dr}`)) return;
                g.moveTo(shape[aIdx].x, shape[aIdx].y);
                g.lineTo(shape[bIdx].x, shape[bIdx].y);
              });
              if ((q * 7 + r * 11) % 3 === 0) {
                g.lineStyle(0.75, 0xe5d98f, 0.16);
                g.moveTo(shape[3].x * 0.36, shape[3].y * 0.36);
                g.lineTo(shape[1].x * 0.56, shape[1].y * 0.56);
              }
              return;
            }

            const s = (tileSize / 2) * 0.86;
            const hw = (hexWidth / 2) * 0.86;
            const pts = [
              { x: 0, y: -s },
              { x: hw, y: -s / 2 },
              { x: hw, y: s / 2 },
              { x: 0, y: s },
              { x: -hw, y: s / 2 },
              { x: -hw, y: -s / 2 }
            ];
            g.beginFill(0x89b46f, 0.075);
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();
            g.endFill();
          }}
        />
      );
    });

    return elements;
  }, [rangeOverlayCoords, map.width, map.height, map.tiles, visibleTiles, externalTexturesAreColored, topGeomFor]);

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
      const geom = ISO_MODE ? topGeomFor(q, r) : null;
      const elev = ((map.tiles[idx] as any).elevation ?? 0);
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
    return elements.filter((el) => (el as any).key !== `atk-${start.q}-${start.r}`);
  }, [showAttackOverlay, battleState.map, battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles, externalTexturesAreColored, topGeomFor]);





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
            g.lineStyle(2, 0x7ec8a1, 0.9);
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



    return elements;
  }, [exploredTiles, map.width, plannedDestination, plannedPath, visibleTiles, topGeomFor]);

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
    const scale = 0.88 + (1 - pulse) * 0.12;
    const alpha = 0.24 + pulse * 0.42;
    const x = p.x;
    const y = p.y - geom.avgHeight * ELEV_Y_OFFSET;

    return (
      <Graphics
        key={`invalid-move-${invalidMoveFeedback.time}`}
        zIndex={50}
        x={x}
        y={y}
        draw={(g) => {
          g.clear();
          const drawCross = () => {
            g.lineStyle(4, 0x140504, Math.min(0.56, alpha));
            g.moveTo(-tileSize * 0.26, -tileSize * 0.1);
            g.lineTo(tileSize * 0.26, tileSize * 0.1);
            g.moveTo(tileSize * 0.26, -tileSize * 0.1);
            g.lineTo(-tileSize * 0.26, tileSize * 0.1);
            g.lineStyle(1.55, 0xffd277, Math.min(0.78, alpha + 0.16));
            g.moveTo(-tileSize * 0.22, -tileSize * 0.085);
            g.lineTo(tileSize * 0.22, tileSize * 0.085);
            g.moveTo(tileSize * 0.22, -tileSize * 0.085);
            g.lineTo(-tileSize * 0.22, tileSize * 0.085);
          };

          if (ISO_MODE) {
            const ring = geom.inset(scale);
            g.beginFill(0x6f1812, alpha * 0.075);
            drawPoly(g as PixiGraphics, ring);
            g.endFill();
            g.lineStyle(3.2, 0x170706, alpha * 0.66);
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(1.25, 0xf05a43, Math.min(0.78, alpha + 0.12));
            drawPoly(g as PixiGraphics, ring);
            g.lineStyle(0.8, 0xffd277, 0.18 * alpha);
            g.moveTo(ring[3].x * 0.5, ring[3].y * 0.5);
            g.lineTo(ring[1].x * 0.65, ring[1].y * 0.65);
            drawCross();
          } else {
            const s = (tileSize / 2) * scale;
            const hw = (hexWidth / 2) * scale;
            const pts = [
              { x: 0, y: -s },
              { x: hw, y: -s / 2 },
              { x: hw, y: s / 2 },
              { x: 0, y: s },
              { x: -hw, y: s / 2 },
              { x: -hw, y: -s / 2 }
            ];
            g.beginFill(0x6f1812, alpha * 0.075);
            drawPoly(g as PixiGraphics, pts);
            g.endFill();
            g.lineStyle(1.4, 0xf05a43, Math.min(0.78, alpha + 0.12));
            drawPoly(g as PixiGraphics, pts);
            drawCross();
          }
        }}
      />
    );
  }, [invalidMoveFeedback, map.height, map.width, now, topGeomFor, toScreen]);

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
      .map((tile: any, index: number) => {
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
        const baseColor = (terrainPalette as any)[tile.terrain] ?? terrainPalette.plain;

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
                const neighbor = neighborIdx >= 0 ? (map.tiles[neighborIdx] as any) : null;
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
  }, [ISO_MODE, exploredTiles, map.tiles, map.width, snappedCorners, visibleTiles]);


  const propTextureCache = useMemo(() => new Map<string, Texture>(), []);
  const unitTextureCache = useMemo(() => new Map<string, Texture>(), []);
  const propAtlasTextures = useMemo(() => {
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

    return { bush, rock };
  }, []);


  const deathMarkerSprites = useMemo(() => {
    if (deathMarkers.size === 0) return null;
    const els: JSX.Element[] = [];
    deathMarkers.forEach((m) => {
      const idx = m.r * map.width + m.q;
      const isFriendly = m.faction === viewerFaction;
      const isVisible = visibleTiles.has(idx);
      if (!isFriendly && !isVisible) return;

      const p = toScreen({ q: m.q, r: m.r });
      const tile = map.tiles[idx] as any;
      const elev = tile?.elevation ?? 0;
      const geom = ISO_MODE ? topGeomFor(m.q, m.r) : null;
      const baseHeight = ISO_MODE && geom ? geom.avgHeight : elev;
      const x = Math.round(p.x);
      const y = Math.round(p.y - baseHeight * ELEV_Y_OFFSET);
      const z = Math.round(y) + (m.id === selectedUnitId ? 5000 : 0);

      const elapsed = now - m.t;
      if (elapsed >= DEATH_TTL_MS) return;
      const fade = Math.max(0, 1 - elapsed / DEATH_TTL_MS);

      els.push(
        <Container key={`dead-${m.id}`} x={x} y={y} alpha={fade} zIndex={z}>
          <Graphics
            draw={(g) => {
              g.clear();
              g.beginFill(0x000000, 0.20 + 0.25 * fade);
              g.drawCircle(0, 0, tileSize * 0.26);
              g.endFill();
              g.lineStyle(2, 0x5f3328, 0.72 * fade);
              g.moveTo(-tileSize * 0.16, tileSize * 0.02);
              g.lineTo(tileSize * 0.16, tileSize * 0.02);
              g.moveTo(-tileSize * 0.11, -tileSize * 0.07);
              g.lineTo(tileSize * 0.09, tileSize * 0.1);
            }}
          />
        </Container>
      );
    });
    return els;
  }, [deathMarkers, map.tiles, map.width, now, selectedUnitId, topGeomFor, toScreen, viewerFaction, visibleTiles]);

  const targetLinkOverlay = useMemo(() => {
    if (!selectedUnitId || !targetUnitId) return null;
    let selectedUnit: any | undefined;
    let targetUnit: any | undefined;
    for (const side of Object.values(battleState.sides) as any[]) {
      const selectedCandidate = side.units.get(selectedUnitId);
      const targetCandidate = side.units.get(targetUnitId);
      if (selectedCandidate) selectedUnit = selectedCandidate;
      if (targetCandidate) targetUnit = targetCandidate;
    }
    if (!selectedUnit || !targetUnit || targetUnit.stance === 'destroyed') return null;
    const targetIdx = targetUnit.coordinate.r * map.width + targetUnit.coordinate.q;
    if (!visibleTiles.has(targetIdx)) return null;
    const pointFor = (unit: any) => {
      const p = toScreen(unit.coordinate);
      const geom = ISO_MODE ? topGeomFor(unit.coordinate.q, unit.coordinate.r) : null;
      const elev = geom?.avgHeight ?? ((map.tiles[unit.coordinate.r * map.width + unit.coordinate.q] as any)?.elevation ?? 0);
      return { x: p.x, y: p.y - elev * ELEV_Y_OFFSET };
    };
    const from = pointFor(selectedUnit);
    const to = pointFor(targetUnit);
    const explicitTarget = targetHitChance !== undefined;
    return (
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
          const step = explicitTarget ? 10 : 18;
          const dash = explicitTarget ? 8 : 7;
          g.lineStyle(explicitTarget ? 3.4 : 1.8, 0x050807, explicitTarget ? 0.68 : 0.42);
          for (let d = 0; d < linkLen; d += step) {
            const a = d / linkLen;
            const b = Math.min(d + dash, linkLen) / linkLen;
            g.moveTo(sx + (ex - sx) * a, sy + (ey - sy) * a);
            g.lineTo(sx + (ex - sx) * b, sy + (ey - sy) * b);
          }
          g.lineStyle(explicitTarget ? 1.65 : 0.9, explicitTarget ? 0xf1e7a8 : 0xb0aa62, explicitTarget ? 0.82 : 0.48);
          for (let d = 0; d < linkLen; d += step) {
            const a = d / linkLen;
            const b = Math.min(d + dash, linkLen) / linkLen;
            g.moveTo(sx + (ex - sx) * a, sy + (ey - sy) * a);
            g.lineTo(sx + (ex - sx) * b, sy + (ey - sy) * b);
          }
          const midX = (sx + ex) / 2;
          const midY = (sy + ey) / 2;
          g.beginFill(explicitTarget ? 0xf1e7a8 : 0x9c9c58, explicitTarget ? 0.7 : 0.42);
          g.drawCircle(midX, midY, explicitTarget ? 3.2 : 1.6);
          g.endFill();
        }}
      />
    );
  }, [battleState.sides, map.tiles, map.width, selectedUnitId, targetHitChance, targetUnitId, toScreen, topGeomFor, visibleTiles]);

  const objectiveOverlays = useMemo(() => {
    if (objectiveCoords.length === 0) return [];
    const pulse = (Math.sin(now / 420) + 1) / 2;
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
  }, [objectiveCoords, map.width, exploredTiles, visibleTiles, now, toScreen, topGeomFor]);


  const units = useMemo(() => {
    let selectedEmbarkedCarrierId: string | undefined;
    if (selectedUnitId) {
      for (const side of Object.values(battleState.sides) as any[]) {
        const selected = (side as any).units.get(selectedUnitId);
        if (selected?.embarkedOn) {
          selectedEmbarkedCarrierId = selected.embarkedOn;
          break;
        }
      }
    }

    return (Object.values(battleState.sides) as any[]).flatMap((side) =>
      Array.from((side as any).units.values()).flatMap((unit: any) => {
        let displayCoord = unit.coordinate;
        let animatedOrientation = unit.orientation ?? 0;
        let movementPhase = 0;
        let movingThisUnit = false;
        let moveScreenVector = orientationScreenVector(animatedOrientation);
        let movingBaseHeight: number | undefined;
        const unitType = (unit as any).unitType as string;
        const definitionId = unit.definitionId.toLowerCase();
        const isSupportVehicle = unitType === 'support' && definitionId.includes('truck');
        const isGroundVehicle = unitType === 'vehicle' || unitType === 'artillery' || isSupportVehicle;

        if (movingUnit && movingUnit.unitId === unit.id && movingUnit.path.length >= 2) {
          const rawElapsed = now - movingUnit.startTime;
          const preAlignDuration = Math.max(0, movingUnit.preAlignDuration ?? 0);
          const elapsed = Math.max(0, rawElapsed - preAlignDuration);
          const totalSteps = movingUnit.path.length - 1;
          const currentStepFloat = elapsed / movingUnit.stepDuration;
          const currentStep = Math.min(Math.max(0, Math.floor(currentStepFloat)), totalSteps - 1);
          const stepProgress = rawElapsed < preAlignDuration ? 0 : Math.min(Math.max(0, currentStepFloat - currentStep), 1);
          const easedProgress = stepProgress * stepProgress * (3 - 2 * stepProgress);

          const fromCoord = movingUnit.path[currentStep];
          const toCoord = movingUnit.path[currentStep + 1];

          if (fromCoord && toCoord && currentStep < totalSteps) {
            movingThisUnit = true;
            movementPhase = currentStepFloat;
            displayCoord = {
              q: fromCoord.q + (toCoord.q - fromCoord.q) * easedProgress,
              r: fromCoord.r + (toCoord.r - fromCoord.r) * easedProgress
            };

            const fromIdx = fromCoord.r * map.width + fromCoord.q;
            const toIdx = toCoord.r * map.width + toCoord.q;
            const fromGeom = ISO_MODE ? topGeomFor(fromCoord.q, fromCoord.r) : null;
            const toGeom = ISO_MODE ? topGeomFor(toCoord.q, toCoord.r) : null;
            const fromHeight = fromGeom ? fromGeom.avgHeight : ((map.tiles[fromIdx] as any)?.elevation ?? 0);
            const toHeight = toGeom ? toGeom.avgHeight : ((map.tiles[toIdx] as any)?.elevation ?? 0);
            movingBaseHeight = fromHeight + (toHeight - fromHeight) * easedProgress;

            const dq = toCoord.q - fromCoord.q;
            const dr = toCoord.r - fromCoord.r;
            if (dq > 0 && dr === 0) animatedOrientation = 0; // E
            else if (dq > 0 && dr < 0) animatedOrientation = 1; // NE
            else if (dq === 0 && dr < 0) animatedOrientation = 2; // N
            else if (dq < 0 && dr === 0) animatedOrientation = 3; // W
            else if (dq < 0 && dr > 0) animatedOrientation = 4; // SW
            else if (dq === 0 && dr > 0) animatedOrientation = 5; // S
            else if (dq > 0 && dr > 0) animatedOrientation = 6; // SE
            else if (dq < 0 && dr < 0) animatedOrientation = 7; // NW
            moveScreenVector = screenVectorBetween(fromCoord, toCoord);
            const turnBlendWindow = 0.64;
            if (!isGroundVehicle && stepProgress > 1 - turnBlendWindow && currentStep + 2 < movingUnit.path.length) {
              const nextVector = screenVectorBetween(toCoord, movingUnit.path[currentStep + 2]);
              const t = (stepProgress - (1 - turnBlendWindow)) / turnBlendWindow;
              const smoothT = t * t * (3 - 2 * t);
              moveScreenVector = mixScreenVectors(moveScreenVector, nextVector, smoothT);
            } else if (!isGroundVehicle && stepProgress < turnBlendWindow && currentStep > 0) {
              const previousVector = screenVectorBetween(movingUnit.path[currentStep - 1], fromCoord);
              const t = stepProgress / turnBlendWindow;
              const smoothT = t * t * (3 - 2 * t);
              moveScreenVector = mixScreenVectors(previousVector, moveScreenVector, smoothT);
            }
          }
        }

        const p = toScreen(displayCoord);
        const idx = Math.floor(displayCoord.r) * map.width + Math.floor(displayCoord.q);
        const elev = ((map.tiles[idx] as any)?.elevation ?? 0);
        const geom = ISO_MODE ? topGeomFor(Math.floor(displayCoord.q), Math.floor(displayCoord.r)) : null;
        const baseHeight = movingBaseHeight ?? (ISO_MODE && geom ? geom.avgHeight : elev);
        const isGhoulPack = definitionId.includes('ghoul') || definitionId.includes('zombie') || definitionId.includes('undead');
        const x = Math.round(p.x);
        const y = Math.round(p.y - baseHeight * ELEV_Y_OFFSET);
        const color = unit.faction === 'alliance' ? 0x5dade2 : 0xe74c3c;
        const isSelected = unit.id === selectedUnitId;
        const isSelectedCarrier = unit.id === selectedEmbarkedCarrierId;
        const isTarget = unit.id === targetUnitId;
        const worldZ = Math.round(y) + (isSelected || isSelectedCarrier || isTarget || movingThisUnit ? 5000 : 0);
        const tileIndex = unit.coordinate.r * map.width + unit.coordinate.q;
        const isVisible = visibleTiles.has(tileIndex);
        const isFriendly = unit.faction === viewerFaction;
        const isDestroyed = unit.stance === 'destroyed';
        const isEmbarked = Boolean(unit.embarkedOn);
        const incomingHit = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.toQ === unit.coordinate.q
            && effect.toR === unit.coordinate.r
            && effect.hit !== false
            && elapsed >= 240
            && elapsed <= 920;
        });
        const outgoingShot = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.fromQ === unit.coordinate.q
            && effect.fromR === unit.coordinate.r
            && elapsed >= 0
            && elapsed <= 320;
        });
        const recentAttackSource = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.fromQ === unit.coordinate.q
            && effect.fromR === unit.coordinate.r
            && elapsed >= 0
            && elapsed <= 1300;
        });
        const recentHitTarget = attackEffects.find((effect) => {
          const elapsed = now - effect.startTime;
          return effect.toQ === unit.coordinate.q
            && effect.toR === unit.coordinate.r
            && effect.hit !== false
            && elapsed > 920
            && elapsed <= 2500;
        });
        const hitElapsed = incomingHit ? now - incomingHit.startTime : 0;
        const hitPhase = incomingHit ? Math.min(Math.max((hitElapsed - 240) / 680, 0), 1) : 1;
        const hitPulse = incomingHit ? 1 - hitPhase : 0;
        const groundVehicleHitJolt = movingThisUnit ? 0.9 : 1.8;
        const hitJolt = incomingHit ? Math.sin(hitPhase * Math.PI * 5) * hitPulse * (unitType === 'vehicle' || unitType === 'artillery' ? groundVehicleHitJolt : 3.2) : 0;
        const shotPulse = outgoingShot ? 1 - Math.min((now - outgoingShot.startTime) / 320, 1) : 0;
        const residualPulse = recentHitTarget ? 1 - Math.min((now - recentHitTarget.startTime - 920) / 1580, 1) : 0;
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
        const recoil = outgoingShot
          ? shotPulse * (unitType === 'vehicle' || unitType === 'artillery' ? 2.4 : 1.3)
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

        // Respect fog-of-war for enemies
        if (!isFriendly && !isVisible && !recentAttackSource) return [];

        if ((isDestroyed && !movingThisUnit) || isEmbarked) {
          return [];
        }

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
          >
            <Graphics
              zIndex={0}
              draw={(g) => {
                g.clear();
                const movingVehicleUiDamping = movingThisUnit && isGroundVehicle ? 0.68 : 1;
                const markerScale = unitType === 'vehicle' || unitType === 'artillery'
                  ? (movingThisUnit && isGroundVehicle ? 0.82 : 0.96)
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
                      const colorValue = isSelectedCarrier ? 0xd8b65b : 0x7ec3df;
                      const bright = isSelectedCarrier ? 0xffe6a3 : 0xd4f4f2;
                      g.lineStyle(1.7 * movingVehicleUiDamping, 0x071015, 0.52 * movingVehicleUiDamping);
                      strokeArc(198, 245, 0x071015, 0.52 * movingVehicleUiDamping, 1.7 * movingVehicleUiDamping);
                      strokeArc(295, 342, 0x071015, 0.52 * movingVehicleUiDamping, 1.7 * movingVehicleUiDamping);
                      strokeArc(198, 245, colorValue, 0.64 * movingVehicleUiDamping, 1.05 * movingVehicleUiDamping);
                      strokeArc(295, 342, colorValue, 0.64 * movingVehicleUiDamping, 1.05 * movingVehicleUiDamping);
                      g.lineStyle(0.75 * movingVehicleUiDamping, bright, 0.32 * movingVehicleUiDamping);
                      g.moveTo(-rx - 3, 0); g.lineTo(-rx + 3, -1.5);
                      g.moveTo(rx + 3, 0); g.lineTo(rx - 3, -1.5);
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
                    bracket(sx, sy, 0x081014, 0.18, 1.35);
                    bracket(sx, sy, 0x75b7d3, 0.18, 0.7);
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
                    const baseAlpha = isSelected || isTarget ? (isFriendly ? 0.16 : 0.24) : (isFriendly ? 0.11 : 0.18);
                    const baseRx = isGroundVehicle ? footprint.rx * 0.74 : footprint.rx * 1.14;
                    const baseRy = isGroundVehicle ? footprint.ry * 0.56 : footprint.ry * 1.22;
                    const isApcContact = definitionId.includes('m113') || definitionId.includes('apc') || definitionId.includes('ifv') || (unitType === 'support' && definitionId.includes('truck'));
                    const shadowAlpha = isGroundVehicle ? (movingThisUnit ? 0.07 : 0.045) * (isApcContact ? 0.88 : 1) : footprint.alpha;
                    const shadowRx = isGroundVehicle ? footprint.rx * (isApcContact ? 0.39 : 0.42) : footprint.rx;
                    const shadowRy = isGroundVehicle ? footprint.ry * (isApcContact ? 0.155 : 0.18) : footprint.ry;
	                  const showFactionBase = isVisible && !isGroundVehicle;
	                  if (showFactionBase && !isGroundVehicle) {
	                    g.beginFill(isFriendly ? 0x1b5771 : 0x861d17, isVisible ? baseAlpha : baseAlpha * 0.55);
	                    g.drawEllipse(0, footprint.y, baseRx, baseRy);
	                    g.endFill();
                  }
                    if (shadowAlpha > 0) {
	                    g.beginFill(isGroundVehicle ? 0x020403 : 0x000000, isVisible ? shadowAlpha : shadowAlpha * 0.55);
	                    g.drawEllipse(1, footprint.y + (isGroundVehicle ? tileSize * 0.012 : 0), shadowRx, shadowRy);
	                    g.endFill();
                    }
                    if (!isGroundVehicle) {
	                    g.beginFill(0x000000, isVisible ? footprint.alpha * 0.45 : footprint.alpha * 0.22);
	                    g.drawEllipse(1, footprint.y - tileSize * 0.006, footprint.rx * 0.56, footprint.ry * 0.46);
	                    g.endFill();
                    }
                    if (isGroundVehicle && isVisible && movingThisUnit) {
                      const perpX = -moveScreenVector.y;
                      const perpY = moveScreenVector.x;
                      const trackHalf = footprint.rx * 0.76;
                      const trackGap = footprint.ry * 0.95;
                      const trackPhase = ((movementPhase % 1) + 1) % 1;
                      const rearX = -moveScreenVector.x * footprint.rx * 0.58;
                      const rearY = footprint.y - moveScreenVector.y * footprint.ry * 0.5;
                      g.beginFill(0x2d2a20, 0.17);
                      g.drawEllipse(rearX, rearY, footprint.rx * 0.5, footprint.ry * 0.2);
                      g.endFill();
                      g.beginFill(0x5a5137, 0.12);
                      g.drawEllipse(rearX - moveScreenVector.x * footprint.rx * 0.34, rearY - moveScreenVector.y * footprint.ry * 0.18, footprint.rx * 0.22, footprint.ry * 0.12);
                      g.drawEllipse(rearX - moveScreenVector.x * footprint.rx * 0.62 + perpX * footprint.ry * 0.3, rearY - moveScreenVector.y * footprint.ry * 0.34 + perpY * footprint.ry * 0.3, footprint.rx * 0.14, footprint.ry * 0.08);
                      g.endFill();
                      for (const sideOffset of [-1, 1]) {
                        const ox = perpX * trackGap * sideOffset;
                        const oy = perpY * trackGap * sideOffset;
                        g.lineStyle(2.2, 0x050706, 0.46);
                        g.moveTo(ox - moveScreenVector.x * trackHalf, footprint.y + oy - moveScreenVector.y * trackHalf * 0.32);
                        g.lineTo(ox + moveScreenVector.x * trackHalf, footprint.y + oy + moveScreenVector.y * trackHalf * 0.32);
                        g.lineStyle(0.95, isFriendly ? 0x5d6048 : 0x6f3b32, 0.38);
                        g.moveTo(ox - moveScreenVector.x * trackHalf * 0.62, footprint.y + oy - moveScreenVector.y * trackHalf * 0.2);
                        g.lineTo(ox + moveScreenVector.x * trackHalf * 0.62, footprint.y + oy + moveScreenVector.y * trackHalf * 0.2);
                        for (let dashIndex = 0; dashIndex < 6; dashIndex += 1) {
                          const amount = ((dashIndex + trackPhase) % 6) / 5;
                          const along = -trackHalf * 0.62 + amount * trackHalf * 1.24;
                          const cx = ox + moveScreenVector.x * along;
                          const cy = footprint.y + oy + moveScreenVector.y * along * 0.32;
                          const dashHalf = footprint.ry * 0.15;
                          g.lineStyle(0.9, 0x090a06, 0.34);
                          g.moveTo(cx - perpX * dashHalf, cy - perpY * dashHalf);
                          g.lineTo(cx + perpX * dashHalf, cy + perpY * dashHalf);
                          g.lineStyle(0.5, isFriendly ? 0x4d5540 : 0x5c332c, 0.18);
                          g.moveTo(cx - perpX * dashHalf * 0.62, cy - perpY * dashHalf * 0.62 - 0.4);
                          g.lineTo(cx + perpX * dashHalf * 0.62, cy + perpY * dashHalf * 0.62 - 0.4);
                        }
                      }
                    }
                } else {
                  const shadowY = tileSize * 0.16;
                  g.beginFill(0x000000, 0.2);
                  g.drawEllipse(0, shadowY, tileSize * 0.34, tileSize * 0.16);
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
              const vehicleDirectionalSprite = directionalVehicleSprite(unitType, defId);
              const directionalSprite = DIRECTIONAL_UNIT_SPRITES[defId] ?? vehicleDirectionalSprite;
              const isFootUnit = unitType === 'infantry' || (unitType === 'support' && !isSupportVehicle) || unitType === 'hero';
              const isVehicleUnit = isGroundVehicle;
              const spriteDirection = isVehicleUnit && movingThisUnit
                ? vehicleSheetDirectionNameForScreenVector(moveScreenVector, directionalSprite ?? '')
                : isVehicleUnit
                  ? vehicleSheetDirectionNameForOrientation(animatedOrientation, directionalSprite ?? '')
                : directionNameForOrientation(animatedOrientation);
              const usesDirectionalMotion = Boolean(directionalSprite && (isFootUnit || isVehicleUnit));
              const stepWave = movingThisUnit ? Math.sin(movementPhase * Math.PI * 2) : 0;
              const fastWave = movingThisUnit ? Math.sin(movementPhase * Math.PI * 4) : 0;
              const sheetState = movingThisUnit && usesDirectionalMotion ? 'walk' : 'idle';
              const textureSheetState = directionalSprite === 'apc_directional' ? 'idle' : sheetState;
              const animatesVehicleFrames = isVehicleUnit && directionalSprite !== 'apc_directional';
              const sheetFrame = textureSheetState === 'walk' && (!isVehicleUnit || animatesVehicleFrames)
                ? Math.floor((((movementPhase % 1) + 1) % 1) * 4)
                : 0;
              let texture: Texture | null = null;

              if (directionalSprite) {
                desiredH = unitVisualHeight(tileSize, unitType, defId, directionalSprite);
                anchorY = DIRECTIONAL_UNIT_ANCHOR_Y[directionalSprite] ?? 0.9;
                canMirrorForFacing = false;
                texture = unitSheetTexture(unitTextureCache, directionalSprite, textureSheetState, spriteDirection, sheetFrame);
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
                ? directionalSpriteGroundOffset(directionalSprite, textureSheetState, spriteDirection, baseScale)
                : 0;
              const vehiclePose = isVehicleUnit && canMirrorForFacing ? rasterVehiclePose(moveScreenVector) : null;
              const facingLeft = vehiclePose ? vehiclePose.mirrored : canMirrorForFacing && animatedOrientation >= 3 && animatedOrientation <= 5;
              const vehicleTrackJitter = 0;
              const spriteBobY = isFootUnit ? -Math.abs(stepWave) * (directionalSprite ? 1.35 : 2.1) : unitType === 'air' ? stepWave * 1.4 : 0;
              const spriteSwayX = (isFootUnit ? fastWave * 0.55 : isVehicleUnit ? moveScreenVector.x * vehicleTrackJitter : 0) + hitOffsetX + shotOffsetX;
              const spriteCombatY = hitOffsetY + shotOffsetY;
              const spriteRotation = vehiclePose ? vehiclePose.rotation + fastWave * 0.004 : 0;
              const squashX = isFootUnit && !directionalSprite ? 1 + Math.abs(stepWave) * 0.018 : 1;
              const squashY = isFootUnit && !directionalSprite ? 1 - Math.abs(stepWave) * 0.012 : 1;
              const scaleX = (facingLeft ? -baseScale : baseScale) * squashX;
              const spriteBaseY = directionalSprite ? 0 : tileSize * (isVehicleUnit ? 0.082 : 0.05);
              const silhouetteAlpha = isFootUnit && isVisible ? 0.32 : 0;
              return (
                <>
                  {silhouetteAlpha > 0 ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.025, y: baseScale * squashY * 1.02 }}
                      alpha={silhouetteAlpha}
                      tint={0x050605}
                      x={spriteSwayX + (facingLeft ? -0.7 : 0.7)}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY + 1.1}
                      rotation={spriteRotation}
                      zIndex={0.8}
                    />
                  ) : null}
                  {isFootUnit && isVisible ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.01, y: baseScale * squashY * 1.01 }}
                      alpha={0.11}
                      tint={0xe5dbc4}
                      x={spriteSwayX + (facingLeft ? 0.45 : -0.45)}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY - 0.9}
                      rotation={spriteRotation}
                      zIndex={0.9}
                    />
                  ) : null}
                  <Sprite
                    texture={texture}
                    anchor={{ x: 0.5, y: anchorY }}
                    scale={{ x: scaleX, y: baseScale * squashY }}
                    alpha={isVisible ? 1 : 0.72}
                    x={spriteSwayX}
                    y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY}
                    rotation={spriteRotation}
                    zIndex={1}
                  />
                  {outgoingShot ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.018, y: baseScale * squashY * 1.018 }}
                      alpha={0.36 * shotPulse}
                      tint={0xffd46d}
                      x={spriteSwayX}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY}
                      rotation={spriteRotation}
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
                        g.lineStyle(Math.max(1, tileSize * 0.012), 0xffffff, 0.48 * alpha);
                        g.drawCircle(impactX, impactY, spark * 0.34);
                      }}
                    />
                  ) : incomingHit ? (
                    <Sprite
                      texture={texture}
                      anchor={{ x: 0.5, y: anchorY }}
                      scale={{ x: scaleX * 1.01, y: baseScale * squashY * 1.01 }}
                      alpha={0.38 * hitPulse}
                      tint={incomingHit.type === 'magic' ? 0xc58cff : 0xffe3a1}
                      x={spriteSwayX}
                      y={spriteBaseY + groundOffsetY + spriteBobY + spriteCombatY}
                      rotation={spriteRotation}
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

                // stance ring
                const stance = unit.stance;
                if (stance === 'suppressed' || stance === 'routed') {
                  g.lineStyle(2, stance === 'routed' ? 0xff2d55 : 0xffc107, 0.9);
                  g.drawCircle(0, 0, tileSize * 0.29);
                }
                const ent = (unit as any).entrench ?? 0;
                if (ent > 0) {
                  g.lineStyle(0);
                  g.beginFill(isFriendly ? 0x8bb6c8 : 0xb58a63, 0.74);
                  const pipW = 4; const gap = 2; const totalW = ent * pipW + (ent - 1) * gap; let startX = -totalW / 2;
                  for (let i = 0; i < ent; i++) { g.drawRect(startX, -tileSize * 0.43, pipW, 2); startX += pipW + gap; }
                  g.endFill();
                }
                const maxHp = (unit as any).stats?.maxHealth ?? 100;
                const hpRatio = Math.max(0, Math.min(1, (unit as any).currentHealth / maxHp));
                const mrRatio = Math.max(0, Math.min(1, (unit as any).currentMorale / 100));
                const apRatio = Math.max(0, Math.min(1, (unit as any).actionPoints / ((unit as any).maxActionPoints ?? 10)));
                const compactDeployStatus = deployMode && isFriendly && !isSelected && !isSelectedCarrier;
                const movingVehicleUiDamping = movingThisUnit && isGroundVehicle ? 0.68 : 1;
                const detailedBar = (isSelected || isTarget) && !compactDeployStatus && !(movingThisUnit && isGroundVehicle);
                const bw = detailedBar
                  ? (unitType === 'infantry' || unitType === 'hero' || unitType === 'support' ? 18 : 23)
                  : (unitType === 'infantry' || unitType === 'hero' || unitType === 'support' ? 12 : 16);
                const topY = unitType === 'vehicle' || unitType === 'artillery' ? -tileSize * 0.36 : -tileSize * 0.34;
                const backplateAlpha = (isSelected ? 0.8 : isTarget ? 0.72 : isFriendly ? 0.34 : 0.44) * movingVehicleUiDamping;
                const barAlpha = (isSelected ? 0.94 : isTarget ? 0.88 : isFriendly ? 0.5 : 0.62) * movingVehicleUiDamping;
                const backplateH = detailedBar ? 6 : 4;
                if (hpRatio <= 0.3) {
                  const criticalPulse = 0.76 + Math.sin(now / 120) * 0.2;
                  g.lineStyle(2.4, 0x1a0706, 0.78);
                  g.drawEllipse(0, tileSize * 0.05, tileSize * 0.35, tileSize * 0.15);
                  g.lineStyle(1.45, 0xef6a55, criticalPulse);
                  g.drawEllipse(0, tileSize * 0.05, tileSize * 0.3, tileSize * 0.13);
                  g.beginFill(0xef6a55, criticalPulse * 0.82);
                  g.drawRect(-2.5, -tileSize * 0.54, 5, 9);
                  g.drawRect(-2.5, -tileSize * 0.42, 5, 2.5);
                  g.endFill();
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
                  const markerW = isSelected ? (movingThisUnit && isGroundVehicle ? 5.4 : 7) : 4.2;
                  const markerDrop = isSelected ? (movingThisUnit && isGroundVehicle ? 5.4 : 7) : 4.2;
                  g.lineStyle((isSelected ? 1.3 : 0.9) * movingVehicleUiDamping, isSelected ? 0xd4f4f2 : 0x071821, (isSelected ? 0.88 : 0.48) * movingVehicleUiDamping);
                  g.beginFill(factionAccent, (isSelected || isSelectedCarrier ? 0.96 : 0.34) * movingVehicleUiDamping);
                  g.moveTo(0, flagY + 5);
                  g.lineTo(-markerW, flagY + 5 - markerDrop);
                  g.lineTo(markerW, flagY + 5 - markerDrop);
                  g.closePath();
                  g.endFill();
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
                  g.lineStyle(0.9, 0x1f0b09, 0.46);
                  g.beginFill(0xad5145, 0.38);
                  g.moveTo(0, flagY + 1);
                  g.lineTo(3.6, flagY + 4.6);
                  g.lineTo(0, flagY + 8.2);
                  g.lineTo(-3.6, flagY + 4.6);
                  g.closePath();
                  g.endFill();
                }

                g.lineStyle(0);
                g.beginFill(0x2a1c18, 0.72 * barAlpha); g.drawRect(-bw / 2, topY - (detailedBar ? 6 : 3), bw, 2); g.endFill();
                const hpColor = hpRatio > 0.55 ? 0x758c5a : hpRatio > 0.25 ? 0xb08a45 : 0xa84a3f;
                g.beginFill(hpColor, 0.95 * barAlpha); g.drawRect(-bw / 2, topY - (detailedBar ? 6 : 3), bw * hpRatio, 2); g.endFill();
                if (hpRatio <= 0.3) {
                  const pipAlpha = 0.82 + Math.sin(now / 110) * 0.18;
                  g.beginFill(0x160504, 0.86);
                  g.drawRect(bw / 2 - 4, topY - (detailedBar ? 8 : 5), 6, 5);
                  g.endFill();
                  g.beginFill(0xff6b55, pipAlpha);
                  g.drawRect(bw / 2 - 3, topY - (detailedBar ? 7 : 4), 4, 3);
                  g.endFill();
                }

                if (detailedBar) {
                  g.beginFill(0x1a1a1a, 0.62 * barAlpha); g.drawRect(-bw / 2, topY - 3, bw, 1); g.endFill();
                  const mrColor = mrRatio > 0.55 ? 0xc0b27a : mrRatio > 0.25 ? 0x9d8a58 : 0x7a6250;
                  g.beginFill(mrColor, 0.82 * barAlpha); g.drawRect(-bw / 2, topY - 3, bw * mrRatio, 1); g.endFill();

                  g.beginFill(0x1a1a1a, 0.62 * barAlpha); g.drawRect(-bw / 2, topY - 1, bw, 1); g.endFill();
                  g.beginFill(isFriendly ? 0x5f94b8 : 0x8e5042, 0.82 * barAlpha); g.drawRect(-bw / 2, topY - 1, bw * apRatio, 1); g.endFill();
                }
              }}
            />
            <Graphics
              zIndex={3}
              draw={(g) => {
                g.clear();
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
    map.tiles,
    map.width,
    selectedUnitId,
    targetUnitId,
    targetHitChance,
    targetDamagePreview,
    attackEffects,
    deployMode,
    viewerFaction,
    visibleTiles,
    topGeomFor,
    toScreen,
    movingUnit,
    now
  ]);

  // Attack effects rendering (muzzle flash, projectile trail, hit marker)
  const attackEffectSprites = useMemo(() => {
    if (!attackEffects || attackEffects.length === 0) return [];
    const EFFECT_DURATION = 2600;

    return attackEffects.map((effect) => {
      const elapsed = now - effect.startTime;
      if (elapsed < 0) return null;
      if (elapsed > EFFECT_DURATION) return null;

      const progress = elapsed / EFFECT_DURATION;
      const fromPos = toScreen({ q: effect.fromQ, r: effect.fromR });
      const toPos = toScreen({ q: effect.toQ, r: effect.toR });

      // Get elevations
      const fromIdx = effect.fromR * map.width + effect.fromQ;
      const toIdx = effect.toR * map.width + effect.toQ;
      const fromGeom = ISO_MODE ? topGeomFor(effect.fromQ, effect.fromR) : null;
      const toGeom = ISO_MODE ? topGeomFor(effect.toQ, effect.toR) : null;
      const fromElev = fromGeom ? fromGeom.avgHeight : ((map.tiles[fromIdx] as any)?.elevation ?? 0);
      const toElev = toGeom ? toGeom.avgHeight : ((map.tiles[toIdx] as any)?.elevation ?? 0);

      const fromX = fromPos.x;
      const fromY = fromPos.y - fromElev * ELEV_Y_OFFSET;
      const toX = toPos.x;
      const toY = toPos.y - toElev * ELEV_Y_OFFSET;
      let targetUnit: any | undefined;
      for (const side of Object.values(battleState.sides) as any[]) {
        targetUnit = Array.from(side.units.values() as Iterable<any>).find((unit: any) =>
          unit.coordinate.q === effect.toQ && unit.coordinate.r === effect.toR
        );
        if (targetUnit) break;
      }
      const targetDefinitionId = String(targetUnit?.definitionId ?? '').toLowerCase();
      const targetUnitType = String(targetUnit?.unitType ?? '');
      const targetMaterial = targetUnitType === 'vehicle' || targetUnitType === 'artillery'
        ? 'armor'
        : targetDefinitionId.includes('skeleton') || targetDefinitionId.includes('ghoul') || targetDefinitionId.includes('undead') || targetDefinitionId.includes('orc')
          ? 'undead'
          : 'organic';

      const travel = Math.min(elapsed / 520, 1);
      const projX = fromX + (toX - fromX) * travel;
      const projY = fromY + (toY - fromY) * travel;

      const zIndex = 20000 + Math.round(Math.max(fromY, toY));

      return (
        <Container key={effect.id} zIndex={zIndex}>
          {effect.type !== 'gunshot' && elapsed < 620 && (
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

          {effect.type !== 'melee' && elapsed < 320 && (
            <Graphics
              x={fromX}
              y={fromY - tileSize * 0.15}
              draw={(g) => {
                g.clear();
                const fade = 1 - elapsed / 320;
                const flashScale = effect.type === 'gunshot' ? 0.18 : effect.type === 'magic' ? 0.22 : 0.31;
                const flashReach = effect.type === 'gunshot' ? 0.42 : 0.5;
                const flashTail = effect.type === 'gunshot' ? 0.32 : 0.38;
                const flashWidth = effect.type === 'gunshot' ? 0.075 : 0.1;
                const flashSize = tileSize * flashScale * fade;
                const dx = toX - fromX;
                const dy = toY - fromY;
                const len = Math.max(1, Math.hypot(dx, dy));
                const ux = dx / len;
                const uy = dy / len;
                const px = -uy;
                const py = ux;
                g.lineStyle(effect.type === 'gunshot' ? 2.8 : 3.8, 0x120b05, 0.9 * fade);
                g.moveTo(-ux * tileSize * 0.14, -uy * tileSize * 0.14);
                g.lineTo(ux * tileSize * (effect.type === 'gunshot' ? 0.28 : 0.32), uy * tileSize * (effect.type === 'gunshot' ? 0.28 : 0.32));
                g.beginFill(effect.type === 'magic' ? 0xc779ff : 0xffe1a1, (effect.type === 'gunshot' ? 0.68 : 0.78) * fade);
                g.moveTo(ux * tileSize * 0.1, uy * tileSize * 0.1);
                g.lineTo(ux * tileSize * flashReach + px * tileSize * flashWidth, uy * tileSize * flashReach + py * tileSize * flashWidth);
                g.lineTo(ux * tileSize * flashTail - px * tileSize * flashWidth, uy * tileSize * flashTail - py * tileSize * flashWidth);
                g.closePath();
                g.endFill();
                g.beginFill(effect.type === 'magic' ? 0xaa44ff : 0xffd57a, (effect.type === 'gunshot' ? 0.84 : 0.95) * fade);
                g.drawCircle(0, 0, flashSize);
                g.endFill();
                if (effect.type !== 'gunshot') {
                  g.beginFill(0xffffff, 0.85 * fade);
                  g.drawCircle(0, 0, flashSize * 0.42);
                  g.endFill();
                }
              }}
            />
          )}

          {travel < 1 && (
            <Graphics
              draw={(g) => {
                g.clear();
                const trailStart = Math.max(0, travel - 0.24);
                const sx = fromX + (toX - fromX) * trailStart;
                const sy = fromY + (toY - fromY) * trailStart - tileSize * 0.15;
                const tx = projX;
                const ty = projY - tileSize * 0.15;
                g.lineStyle(effect.type === 'explosion' ? 5 : effect.type === 'gunshot' ? 3.4 : 3, 0x15110a, 0.9);
                g.moveTo(sx, sy); g.lineTo(tx, ty);
                if (effect.type === 'gunshot') {
                  g.lineStyle(2.6, 0xffe6a0, 0.98);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.beginFill(0xfff3bd, 0.95);
                  g.drawCircle(tx, ty, 3);
                  g.endFill();
                } else if (effect.type === 'explosion') {
                  g.lineStyle(2.6, 0xffcf5d, 0.98);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.beginFill(0xfff0a8, 0.95);
                  g.drawCircle(tx, ty, 4.5);
                  g.endFill();
                } else if (effect.type === 'magic') {
                  g.lineStyle(2.4, 0xc779ff, 0.96);
                  g.moveTo(sx, sy); g.lineTo(tx, ty);
                  g.beginFill(0xaa44ff, 0.9);
                  g.drawCircle(tx, ty, 4.5);
                  g.endFill();
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
              }}
            />
          )}

          {travel >= 1 && elapsed < 1050 && effect.type !== 'melee' && (
            <Graphics
              draw={(g) => {
                g.clear();
                const fade = 1 - Math.max(0, elapsed - 520) / 530;
                const dx = toX - fromX;
                const dy = toY - fromY;
                const sx = fromX + dx * 0.18;
                const sy = fromY + dy * 0.18 - tileSize * 0.15;
                const ex = fromX + dx * 0.88;
                const ey = fromY + dy * 0.88 - tileSize * 0.15;
                const glow = effect.type === 'magic' ? 0xb676ff : effect.type === 'explosion' ? 0xffbf58 : 0xffe6a0;
                g.lineStyle(effect.type === 'gunshot' ? 5.2 : 6.2, 0x120d08, 0.56 * fade);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
                g.lineStyle(effect.type === 'gunshot' ? 2.2 : 3, glow, 0.68 * fade);
                g.moveTo(sx, sy);
                g.lineTo(ex, ey);
              }}
            />
          )}

          {elapsed > 180 && elapsed < 1900 && (
            <Graphics
              x={toX}
              y={toY - tileSize * 0.2}
              draw={(g) => {
                g.clear();
                const hitProgress = Math.min((elapsed - 180) / 1600, 1);
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

                if (effect.type === 'explosion' || effect.type === 'melee') {
                  const primary = targetMaterial === 'armor' ? 0xffbd58 : targetMaterial === 'undead' ? 0xbec1ad : 0xb07a52;
                  const secondary = targetMaterial === 'armor' ? 0xfff0b0 : targetMaterial === 'undead' ? 0xd8d6c2 : 0xd09a67;
                  const dust = targetMaterial === 'armor' ? 0x4b4b42 : targetMaterial === 'undead' ? 0x6f7164 : 0x5b4b36;
                  g.beginFill(dust, hitAlpha * 0.4);
                  g.drawEllipse(1, tileSize * 0.08, hitSize * 1.04, hitSize * 0.4);
                  g.endFill();
                  g.lineStyle(3.6, primary, hitAlpha * 0.94);
                  g.drawCircle(0, 0, hitSize);
                  g.lineStyle(1.9, secondary, hitAlpha * 0.9);
                  for (let i = 0; i < 8; i++) {
                    const angle = (Math.PI * 2 * i) / 8;
                    const inner = hitSize * 0.35;
                    const outer = hitSize * (1.05 + hitProgress * 0.55);
                    g.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                    g.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                  }
                  for (let i = 0; i < 5; i++) {
                    const angle = -0.9 + i * 0.45;
                    const px = Math.cos(angle) * hitSize * (0.45 + hitProgress * 0.35);
                    const py = Math.sin(angle) * hitSize * (0.26 + hitProgress * 0.25);
                    g.beginFill(secondary, hitAlpha * 0.75);
                    g.drawCircle(px, py, Math.max(1.4, 3.2 * hitAlpha));
                    g.endFill();
                  }
                  const edgeX = -ux * tileSize * 0.12;
                  const edgeY = -uy * tileSize * 0.1;
                  g.lineStyle(3.8, 0x1a0b04, hitAlpha * 0.94);
                  g.moveTo(edgeX - hitSize * 0.34, edgeY);
                  g.lineTo(edgeX + hitSize * 0.34, edgeY);
                  g.moveTo(edgeX, edgeY - hitSize * 0.27);
                  g.lineTo(edgeX, edgeY + hitSize * 0.27);
                  g.lineStyle(1.9, 0xfff4c8, hitAlpha);
                  g.moveTo(edgeX - hitSize * 0.27, edgeY);
                  g.lineTo(edgeX + hitSize * 0.27, edgeY);
                  g.moveTo(edgeX, edgeY - hitSize * 0.21);
                  g.lineTo(edgeX, edgeY + hitSize * 0.21);
                  g.beginFill(secondary, hitAlpha * 0.66);
                  g.drawCircle(0, 0, hitSize * 0.32);
                  g.endFill();
                } else {
                  const dust = targetMaterial === 'armor' ? 0x3c3d36 : 0x514436;
                  const spark = targetMaterial === 'armor' ? 0xffe9a8 : 0xd6a26a;
                  g.beginFill(dust, hitAlpha * 0.38);
                  g.drawEllipse(0, tileSize * 0.09, hitSize * 0.86, hitSize * 0.3);
                  g.endFill();
                  g.lineStyle(3.2, 0x1a0f07, hitAlpha * 0.9);
                  g.drawCircle(0, 0, hitSize * 0.56);
                  g.lineStyle(1.75, spark, hitAlpha);
                  g.moveTo(-hitSize * 0.42, -hitSize * 0.1);
                  g.lineTo(hitSize * 0.42, hitSize * 0.1);
                  g.moveTo(-hitSize * 0.14, hitSize * 0.3);
                  g.lineTo(hitSize * 0.2, -hitSize * 0.32);
                  g.beginFill(spark, hitAlpha * 0.68);
                  g.drawCircle(0, 0, hitSize * 0.18);
                  g.endFill();
                }
              }}
            />
          )}
          {elapsed > 220 && elapsed < 2300 && (
            <Text
              text={effect.hit ? `HIT -${effect.damage ?? ''}` : 'MISS'}
              x={toX - (effect.hit ? 30 : 18)}
              y={toY - tileSize * 0.5 - (elapsed - 220) * 0.005}
              zIndex={zIndex + 2}
              style={new TextStyle({
                fontFamily: 'monospace',
                fontSize: effect.hit ? 20 : 15,
                fontWeight: '800',
                fill: effect.hit ? '#f3d58a' : '#d8d1bc',
                stroke: effect.hit ? '#3a1308' : '#17130d',
                strokeThickness: effect.hit ? 4 : 3
              })}
              alpha={Math.max(0, 0.9 - (elapsed - 220) / 2300)}
            />
          )}
        </Container>
      );
    }).filter(Boolean) as JSX.Element[];
  }, [attackEffects, battleState.sides, now, map.width, map.tiles, topGeomFor, toScreen]);

  const propsSprites = useMemo(() => {
    const props = (map.props ?? []).filter((prop) => prop.kind !== 'proc-building');
    if (props.length === 0) return [];
    const idxAt = (q: number, r: number) => r * map.width + q;
    const defaultTexturePath = '/props/tree1.png';
    const getTexture = (path?: string) => {
      const key = path ?? defaultTexturePath;
      if (!propTextureCache.has(key)) {
        propTextureCache.set(key, crispTexture(Texture.from(key)));
      }
      return propTextureCache.get(key)!;
    };

    return props
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
        const bitmapScale = texture && texture.width >= 96 ? scale * 0.5 : scale;
        const bitmapScaleX = bitmapScale * (prop.flipX ? -1 : 1);

        return (
          <Container key={prop.id} x={worldX} y={worldY} zIndex={zIndex} sortableChildren>
            <Graphics
              zIndex={-1}
              draw={(g) => {
                g.clear();
                const treeLike = prop.kind === 'tree';
                g.beginFill(0x000000, isVisible ? (treeLike ? 0.24 : 0.18) : 0.1);
                g.drawEllipse(0, PROP_SHADOW_Y, tileSize * (treeLike ? 0.24 : 0.18), tileSize * (treeLike ? 0.12 : 0.1));
                g.endFill();
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
                alpha={isVisible ? 1 : 0.75}
              />
            )}
          </Container>
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [map.props, map.width, exploredTiles, visibleTiles, propTextureCache, propAtlasTextures, topGeomFor, toScreen, missingPropPaths]);

  const procBuildings = useMemo(() => {
    const props = (map.props ?? []).filter(
      (p): p is MapProp & { kind: 'proc-building' } => p.kind === 'proc-building'
    );
    if (props.length === 0) return [];

    const focusCoords: Array<{ q: number; r: number }> = [];
    for (const side of Object.values(battleState.sides) as any[]) {
      if (selectedUnitId) {
        const selected = side.units.get(selectedUnitId);
        if (selected) focusCoords.push(selected.coordinate);
      }
      if (movingUnit?.unitId) {
        const moving = side.units.get(movingUnit.unitId);
        if (moving) focusCoords.push(moving.coordinate);
      }
      if (targetUnitId) {
        const target = side.units.get(targetUnitId);
        if (target) focusCoords.push(target.coordinate);
      }
    }
    if (movingUnit?.path) focusCoords.push(...movingUnit.path);

    const W = map.width;
    const H = map.height;
    const idxAt = (q: number, r: number) => r * W + q;
    const inBounds = (q: number, r: number) => q >= 0 && r >= 0 && q < W && r < H;

    return props
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
        const focusNear = focusCoords.some((coord) =>
          coord.q >= q0 - 1 && coord.q <= q0 + w && coord.r >= r0 - 1 && coord.r <= r0 + h
        );
        const focusTight = focusCoords.some((coord) =>
          coord.q >= q0 && coord.q <= q0 + w - 1 && coord.r >= r0 && coord.r <= r0 + h - 1
        );
        const focusAlpha = focusTight ? 0.18 : 0.34;
        const fogAlpha = (isVisible ? 1 : 0.62) * (focusNear ? focusAlpha : 1);
        const fogShade = isVisible ? 0 : 0.06;

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

        if (b.texture) {
          const texturePath = assetUrl(b.texture);
          if (!propTextureCache.has(texturePath)) {
            propTextureCache.set(texturePath, crispTexture(Texture.from(texturePath)));
          }
          const texture = propTextureCache.get(texturePath)!;
          const spriteScale = b.scale ?? 0.16;
          return (
            <Container key={b.id} x={anchor.x} y={anchor.y} zIndex={zIndex} sortableChildren alpha={fogAlpha}>
              <Graphics
                zIndex={-1}
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
                  g.beginFill(0x080806, isVisible ? 0.34 : 0.16);
                  drawPoly(g as PixiGraphics, skirt);
                  g.endFill();
                }}
              />
              <Sprite
                texture={texture}
                anchor={{ x: 0.5, y: 0.88 }}
                scale={spriteScale}
                tint={0x8f947c}
                alpha={isVisible ? 1 : 0.72}
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
        const roofOverhang = roofDetails.overhangPx ?? 4;
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
                  lineSegment(g as PixiGraphics, topA, bottomA, darkenColor(wallColor, 0.35), 0.7, 2, anchor);
                  lineSegment(g as PixiGraphics, topB, bottomB, darkenColor(wallColor, 0.45), 0.8, 2, anchor);
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
  }, [map.props, map.width, map.height, battleState.sides, exploredTiles, visibleTiles, topGeomFor, selectedUnitId, targetUnitId, movingUnit, propTextureCache]);

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
            let selected: any | undefined;
            if (selectedUnitId) {
              for (const side of Object.values(battleState.sides) as any[]) {
                const u = (side as any).units.get(selectedUnitId);
                if (u) { selected = u; break; }
              }
            }
            const coord = selected?.coordinate ?? { q: Math.floor(map.width / 2), r: Math.floor(map.height / 2) };
            const p = toScreen(coord);
            return { x: p.x, y: p.y };
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
  }, [hostSize.h, hostSize.w, battleState.sides, map.width, map.height, selectedUnitId, stageDimensions.height, stageDimensions.width]);

  const rangeOverlayLayer = (
    <>
      {globalRangeOverlays}
      {movementRangeOverlays}
      {attackRangeOverlays}
      {plannedHighlights}
      {invalidMoveHighlight}
      {objectiveOverlays}
    </>
  );

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      onPointerDown={(e) => {
        if ((e as any).button !== 0 || minimapDragging) return;
        setDraggingCam(true);
        lastPointerRef.current = { x: (e as any).clientX, y: (e as any).clientY };
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
        const nx = (e as any).clientX, ny = (e as any).clientY;
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
           data-map-width={map.width}
           data-map-height={map.height}
      />


      {/* Help toggle button (fallback to keyboard) */}
      <button data-testid="keyboard-help-toggle" onClick={() => setHelpVisible((v) => !v)}
        style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 4, border: '1px solid #2a3b55', background: '#112238', color: '#e6eefc', cursor: 'pointer' }}
        title="Toggle help (H / F1 / ?)"
      >?</button>

      {helpVisible && (
        <div data-testid="keyboard-help" style={{ position: 'absolute', top: 40, right: 8, background: 'rgba(11,26,43,0.9)', color: '#fefefe', padding: '8px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.4, maxWidth: 260 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Hotkeys</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>E - End Turn</li>
            <li>A - Advance</li>
            <li>F - Fire</li>

            <li>Tab - Toggle Minimap</li>
            <li>H / F1 / ? - Toggle Help</li>
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
              WEBGL REQUIRED
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#edf4e8', marginBottom: 18 }}>
              Tactical combat needs WebGL. Enable browser hardware acceleration or open the game in a browser/profile where WebGL is available, then reload and launch the battle again.
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
              Reload
            </button>
          </div>
        </div>
      ) : (

      <Stage
        width={hostSize.w}
        height={hostSize.h}
        options={{
          backgroundColor: 0x061639,
          resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
          autoDensity: true, // makes text and sprites crisp on retina displays
          antialias: false
        }}
      >
        {screenBackdrop}
        <Container x={offsetX} y={offsetY} scale={scale}>
          {/* World container. In HEX mode we fake tilt; in ISO mode it's identity. */}
          <Container x={ISO_MODE ? isoBaseX : 0} scale={{ x: 1, y: ISO_MODE ? 1 : 0.72 }} skew={{ x: ISO_MODE ? 0 : -0.28, y: 0 }}>
            {battlefieldBackdrop}
            {tileGraphics}
            {terrainGrimeLayer}
            {tileOverlays}
            {terrainMissingTexts}
            {/* Top-only overlay mask: punch holes for all vertical wall faces (E/S) */}
            <Graphics
              key={`overlay-mask-${map.id}`}
              ref={setOverlayMaskNode}
              draw={(g) => {
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
                    const offsetY = worldPos.y - avgHeight * ELEV_Y_OFFSET;
                    const worldPoints: Record<CornerKey, { x: number; y: number }> = {
                      NW: { x: worldPos.x + localPoints.NW.x, y: offsetY + localPoints.NW.y },
                      NE: { x: worldPos.x + localPoints.NE.x, y: offsetY + localPoints.NE.y },
                      SE: { x: worldPos.x + localPoints.SE.x, y: offsetY + localPoints.SE.y },
                      SW: { x: worldPos.x + localPoints.SW.x, y: offsetY + localPoints.SW.y }
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
              }}
            />

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
            </Container>
          </Container>
        </Container>
        <Graphics
          eventMode="static"
          cursor="pointer"
          pointertap={handleBattlefieldTap}
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
            pointerdown={(e: any) => {
              setMinimapDragging(true);
              const mmW = 160; const mmH = 120;
              const sx = mmW / stageDimensions.width; const sy = mmH / stageDimensions.height;
              const local = e?.data?.getLocalPosition?.(e.currentTarget) ?? { x: e.offsetX, y: e.offsetY };
              const worldX = local.x / sx; const worldY = local.y / sy;
              setFollowTargetPx({ x: worldX, y: worldY });
            }}
            pointermove={(e: any) => {
              if (!minimapDragging) return;
              const mmW = 160; const mmH = 120;
              const sx = mmW / stageDimensions.width; const sy = mmH / stageDimensions.height;
              const local = e?.data?.getLocalPosition?.(e.currentTarget) ?? { x: e.offsetX, y: e.offsetY };
              const worldX = local.x / sx; const worldY = local.y / sy;
              setFollowTargetPx({ x: worldX, y: worldY });
            }}
            pointerup={() => setMinimapDragging(false)}
          >
            <Graphics
              draw={(g) => {
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
                const allUnits = Object.values(battleState.sides).flatMap((side: any) => Array.from((side as any).units.values()) as any[]);
                for (const u of allUnits) {
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
              }}
            />
          </Container>
        )}

      </Stage>
      )}
    </div>
  );
}
  const isoPointsFor = (q: number, r: number, elev: number) => {
    const pos = toScreen({ q, r });
    const posY = pos.y - elev * ELEV_Y_OFFSET;
    return [
      { x: pos.x + 0, y: posY - ISO_TILE_H / 2 }, // N
      { x: pos.x + ISO_TILE_W / 2, y: posY },     // E
      { x: pos.x + 0, y: posY + ISO_TILE_H / 2 }, // S
      { x: pos.x - ISO_TILE_W / 2, y: posY }      // W
    ];
  };
