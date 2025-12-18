import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { FactionId, HexCoordinate, TacticalBattleState, UnitInstance, MapProp, EdgeDir } from '@spellcross/core';
import { movementMultiplierForStance } from '@spellcross/core';
import { canAffordAttack } from '@spellcross/core';
import { axialDistance } from '@spellcross/core';
import { calculateAttackRange } from '@spellcross/core';
import { Container, Graphics, Sprite, Stage, Text } from '@pixi/react';
import { Matrix, Texture, Rectangle, Graphics as PixiGraphics } from 'pixi.js';

import { TextStyle } from 'pixi.js';
const basename = (p: string) => {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
};

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)
const DEATH_TTL_MS = 20_000;


// Isometric elevation illusion parameters
const ELEV_Y_OFFSET = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // vertical pixel offset per elevation level (screen)
const CLIFF_DEPTH   = Math.floor(Math.max(8, Math.floor(tileSize * 0.5)) / 2);     // sheer cliff face height per level

const terrainPalette: Record<string, number> = {
  // Spellcross-like greens (top color comes from here; textures are grayscale overlay)
  plain: 0x3a6e2a,     // grassy green
  road:  0x6b5a45,     // earthy road
  forest: 0x1f5a1f,    // darker green
  urban: 0x6e6a76,     // neutral gray for buildings
  hill:  0x6d7f31,     // olive-ish hills
  water: 0x1b3f7a,     // deep water blue (kept blue)
  swamp: 0x355b3a,     // murky green
  structure: 0x6f5f4f  // brownish structures
};

export interface AttackEffect {
  id: string;
  fromQ: number;
  fromR: number;
  toQ: number;
  toR: number;
  startTime: number;
  type: 'gunshot' | 'explosion' | 'magic';
}

export interface MovingUnit {
  unitId: string;
  path: HexCoordinate[];
  startTime: number;
  stepDuration: number;
}

export interface BattlefieldStageProps {
  battleState: TacticalBattleState;
  onSelectUnit?: (unitId: string) => void;
  onSelectTile?: (coordinate: HexCoordinate) => void;
  plannedPath?: HexCoordinate[];
  plannedDestination?: HexCoordinate;
  targetUnitId?: string;
  targetHitChance?: number; // 0-1, hit chance to display on target
  targetDamagePreview?: number; // predicted damage to show
  selectedUnitId?: string;
  viewerFaction?: FactionId;
  width?: number;
  height?: number;
  cameraMode?: 'fit' | 'follow';
  showAttackOverlay?: boolean;
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
const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

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
  if (!material || material === 'plaster') return;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 24 || heightPx < 20) return;
  const ux = dx / length;
  const uy = dy / length;
  const horizontalStep = material === 'brick' ? 6 : material === 'wood' ? 10 : 14;
  const verticalStep = material === 'brick' ? 12 : material === 'metal' ? 18 : 0;
  const baseAlpha = 0.08 + fogShade * 0.4;

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
      const s = i / count;
      const px = start.x + ux * length * s;
      const py = start.y + uy * length * s;
      lineSegment(
        g,
        { x: px, y: py },
        { x: px, y: py - Math.min(heightPx, 60) },
        darkenColor(color, material === 'metal' ? 0.25 : 0.4),
        baseAlpha * 0.7,
        1,
        origin
      );
    }
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
  targetUnitId,
  targetHitChance,
  targetDamagePreview,
  selectedUnitId,
  viewerFaction = 'alliance',
  width,
  height,
  cameraMode = 'fit',
  showAttackOverlay,
  attackEffects = [],
  movingUnit
}: BattlefieldStageProps) {
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
  // Mask graphics for clipping overlays to top-only (exclude vertical walls)
  const overlayMaskRef = useRef<any>(null);

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
  // Optional external texture override (drop PNGs in /public/textures/terrain or a spritesheet in /public/textures/textures_black.png)
  const [externalTerrainTextures, setExternalTerrainTextures] = useState<Record<string, Texture> | null>(null);
  const [externalTexturesAreColored, setExternalTexturesAreColored] = useState<boolean>(false);
  const [missingTerrainPng, setMissingTerrainPng] = useState<Set<string>>(new Set());
  const [missingPropPaths, setMissingPropPaths] = useState<Set<string>>(new Set());
  const [allowExternalTextures] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const qs = new URLSearchParams(window.location.search);
    const pref = qs.get('textures') ?? qs.get('tileset');
    if (!pref) return false;
    const norm = pref.toLowerCase();
    if (norm === 'external' || norm === 'on' || norm === 'true' || norm === 'color') return true;
    return false;
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
              out[n] = Texture.from(objUrl);
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
            const base = Texture.from(bmp).baseTexture;
            const rect = (x: number, y: number, w: number, h: number) => new Rectangle(x, y, w, h);
            const sub = (cx: number, cy: number) => new Texture(base, rect(cx * cellW, cy * cellH, cellW, cellH));
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
      const paths = Array.from(new Set(props.map((p) => p.texture).filter(Boolean))) as string[];
      if (paths.length === 0) {
        setMissingPropPaths(new Set());
        return;
      }
      const missing = new Set<string>();
      await Promise.all(
        paths.map(async (path) => {
          try {
            const res = await fetch(path, { method: 'GET', cache: 'no-store' });
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
      const baseColor = (terrainPalette as any)[tile.terrain] ?? terrainPalette.plain;
      const tex =
        (externalTerrainTextures?.[tile.terrain] ?? externalTerrainTextures?.plain) ??
        ((terrainTextures as any)[tile.terrain] ?? (terrainTextures as any).plain);
      const coloredTex = !!externalTerrainTextures && externalTexturesAreColored;
      const overlayAlpha = coloredTex ? (isVisible ? 1.0 : 0.75) : (isVisible ? 0.28 : 0.16);
      const texMatrix = new Matrix();
      texMatrix.translate((q * 13 + r * 7) % 32, (q * 5 + r * 11) % 32);
      const center = {
        x: (cornerPoints.NW.x + cornerPoints.NE.x + cornerPoints.SE.x + cornerPoints.SW.x) / 4,
        y: (cornerPoints.NW.y + cornerPoints.NE.y + cornerPoints.SE.y + cornerPoints.SW.y) / 4
      };

      return (
        <Graphics
          key={`tile-${index}`}
          x={pos.x}
          y={pos.y - avgHeight * ELEV_Y_OFFSET}
          interactive={isExplored}
          eventMode={isExplored ? 'static' : 'none'}
          cursor={isExplored ? 'pointer' : 'not-allowed'}
          pointertap={() => {
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
                g.beginFill(0x030509, 0.95);
                g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
                g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
                g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
                g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
                g.closePath();
                g.endFill();
                return;
              }
              for (const tri of tris) {
                const [a, b, c] = tri;
                g.beginFill(baseColor, isVisible ? 1.0 : 0.6);
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
              g.lineStyle(1, 0x0d1b24, isVisible ? 0.14 : 0.10);
              g.moveTo(cornerPoints.NW.x, cornerPoints.NW.y);
              g.lineTo(cornerPoints.NE.x, cornerPoints.NE.y);
              g.lineTo(cornerPoints.SE.x, cornerPoints.SE.y);
              g.lineTo(cornerPoints.SW.x, cornerPoints.SW.y);
              g.closePath();
              g.lineStyle();
            }}
          />
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [exploredTiles, map.tiles, map.width, snappedCorners, visibleTiles]);
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
            const mvAlpha = externalTexturesAreColored ? (canShoot ? 0.08 : 0.06) : (canShoot ? 0.16 : 0.12);
            if (ISO_MODE && geom) {
              const shape = geom.inset(0.92);
              g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, mvAlpha);
              drawPoly(g as PixiGraphics, shape);
              g.endFill();

              g.lineStyle(1, canShoot ? 0x6fb3ff : 0x3a78c4, 0.45);
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
              g.lineStyle(1, canShoot ? 0x86b7ff : 0x3a78c4, 0.7);
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

              g.lineStyle(1, canShoot ? 0x6fb3ff : 0x3a78c4, 0.45);
              g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath();

              g.lineStyle(1, canShoot ? 0x86b7ff : 0x3a78c4, 0.7);
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
  }, [battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles, externalTexturesAreColored, topGeomFor]);
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
      const z = Math.round(y);

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
              g.lineStyle(2, 0xff2d55, 0.85 * fade);
              g.moveTo(-tileSize * 0.18, -tileSize * 0.18);
              g.lineTo(tileSize * 0.18, tileSize * 0.18);
              g.moveTo(tileSize * 0.18, -tileSize * 0.18);
              g.lineTo(-tileSize * 0.18, tileSize * 0.18);
            }}
          />
          <Text
            text={'\u2620'}
            anchor={0.5}
            y={-tileSize * 0.02}
            style={new TextStyle({ fill: 0xffe08a, fontSize: 16 })}
          />
        </Container>
      );
    });
    return els;
  }, [deathMarkers, map.tiles, map.width, now, topGeomFor, toScreen, viewerFaction, visibleTiles]);


  const units = useMemo(() => {
    return (Object.values(battleState.sides) as any[]).flatMap((side) =>
      Array.from((side as any).units.values()).flatMap((unit: any) => {
        // Calculate animated position if this unit is moving
        let displayCoord = unit.coordinate;
        let animatedOrientation = unit.orientation ?? 0;

        if (movingUnit && movingUnit.unitId === unit.id && movingUnit.path.length >= 2) {
          const elapsed = now - movingUnit.startTime;
          const totalSteps = movingUnit.path.length - 1;
          const currentStepFloat = elapsed / movingUnit.stepDuration;
          const currentStep = Math.min(Math.max(0, Math.floor(currentStepFloat)), totalSteps - 1);
          const stepProgress = Math.min(Math.max(0, currentStepFloat - currentStep), 1);

          const fromCoord = movingUnit.path[currentStep];
          const toCoord = movingUnit.path[currentStep + 1];

          if (fromCoord && toCoord && currentStep < totalSteps) {
            // Interpolate position
            displayCoord = {
              q: fromCoord.q + (toCoord.q - fromCoord.q) * stepProgress,
              r: fromCoord.r + (toCoord.r - fromCoord.r) * stepProgress
            };

            // Calculate facing direction based on movement
            const dq = toCoord.q - fromCoord.q;
            const dr = toCoord.r - fromCoord.r;
            // Map direction to orientation (0-5)
            if (dq > 0 && dr === 0) animatedOrientation = 0; // E
            else if (dq > 0 && dr < 0) animatedOrientation = 1; // NE
            else if (dq === 0 && dr < 0) animatedOrientation = 2; // N
            else if (dq < 0 && dr === 0) animatedOrientation = 3; // W
            else if (dq < 0 && dr > 0) animatedOrientation = 4; // SW
            else if (dq === 0 && dr > 0) animatedOrientation = 5; // S
          }
        }

        const p = toScreen(displayCoord);
        const idx = Math.floor(displayCoord.r) * map.width + Math.floor(displayCoord.q);
        const elev = ((map.tiles[idx] as any)?.elevation ?? 0);
        const geom = ISO_MODE ? topGeomFor(Math.floor(displayCoord.q), Math.floor(displayCoord.r)) : null;
        const baseHeight = ISO_MODE && geom ? geom.avgHeight : elev;
        const UNIT_NUDGE_X = 0; // ISO: keep X centered
        const unitType = (unit as any).unitType as string;
        // Different Y offsets for different unit types
        // infantry/hero need less offset, vehicles need more to sit on ground
        const nudgeMultiplier = (unitType === 'infantry' || unitType === 'hero') ? 0.10 : 0.55;
        const UNIT_NUDGE_Y = ISO_MODE ? Math.round(ISO_TILE_H * nudgeMultiplier) : 0;
        const x = Math.round(p.x + UNIT_NUDGE_X);
        const y = Math.round(p.y - baseHeight * ELEV_Y_OFFSET + UNIT_NUDGE_Y);
        const worldZ = Math.round(y);
        const color = unit.faction === 'alliance' ? 0x5dade2 : 0xe74c3c;
        const isSelected = unit.id === selectedUnitId;
        const isTarget = unit.id === targetUnitId;
        const tileIndex = unit.coordinate.r * map.width + unit.coordinate.q;
        const isVisible = visibleTiles.has(tileIndex);
        const isFriendly = unit.faction === viewerFaction;
        const isDestroyed = unit.stance === 'destroyed';
        const capHeight = unitType === 'air' ? tileSize * 0.10 : tileSize * 0.28;
        const k = unitType === 'infantry' ? 0.32 : (unitType === 'vehicle' || unitType === 'artillery') ? 0.46 : 0.40;

        // Respect fog-of-war for enemies
        if (!isFriendly && !isVisible) return [];

        if (isDestroyed) {
          return [];
        }

        return (
          <Container
            key={unit.id}
            x={x}
            y={y}
            zIndex={worldZ}
            sortableChildren
            interactive={true}
            pointerdown={() => {
              if (isFriendly) {
                onSelectUnit?.(unit.id);
              } else {
                onSelectTile?.(unit.coordinate);
              }
            }}
          >
            {isSelected && (
              <Container y={-UNIT_NUDGE_Y}>
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
                    const outer = ringShape(0.96);
                    const inner = ringShape(0.86);
                    g.lineStyle(1, 0x95d7ab, 0.85);
                    drawPoly(g as PixiGraphics, outer);
                    g.lineStyle(1, 0x0b2a1d, 0.65);
                    drawPoly(g as PixiGraphics, inner);
                  }}
                />
              </Container>
            )}
            {isTarget && (
              <Container y={-UNIT_NUDGE_Y}>
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
                    const pts = ringShape(0.98);
                    g.lineStyle(2, 0xff2d55, 0.95);
                    drawPoly(g as PixiGraphics, pts);
                    // crosshair
                    g.moveTo(-tileSize * 0.18, 0);
                    g.lineTo(tileSize * 0.18, 0);
                    g.moveTo(0, -tileSize * 0.18);
                    g.lineTo(0, tileSize * 0.18);
                  }}
                />
                {/* Hit chance display */}
                {targetHitChance !== undefined && (
                  <Container y={-tileSize * 0.6}>
                    <Graphics
                      draw={(g) => {
                        g.clear();
                        g.beginFill(0x000000, 0.75);
                        g.drawRoundedRect(-28, -10, 56, 20, 4);
                        g.endFill();
                      }}
                    />
                    <Text
                      text={`${Math.round(targetHitChance * 100)}%`}
                      anchor={0.5}
                      style={new TextStyle({
                        fontFamily: 'monospace',
                        fontSize: 14,
                        fontWeight: 'bold',
                        fill: targetHitChance >= 0.7 ? 0x4ade80 : targetHitChance >= 0.4 ? 0xfbbf24 : 0xef4444,
                      })}
                    />
                    {targetDamagePreview !== undefined && targetDamagePreview > 0 && (
                      <Text
                        text={`~${targetDamagePreview} dmg`}
                        anchor={0.5}
                        y={14}
                        style={new TextStyle({
                          fontFamily: 'monospace',
                          fontSize: 10,
                          fill: 0xffffff,
                        })}
                      />
                    )}
                  </Container>
                )}
              </Container>
            )}
            <Graphics
              zIndex={0}
              draw={(g) => {
                g.clear();
                const shadowScaleISO = Math.min(0.95, Math.max(0.72, k * 1.55));
                if (ISO_MODE && geom) {
                  const shadow = geom.inset(shadowScaleISO).map((pt) => ({ x: pt.x, y: pt.y + 1 }));
                  g.beginFill(0x000000, 0.16);
                  drawPoly(g as PixiGraphics, shadow);
                  g.endFill();
                } else {
                  const shadowY = tileSize * 0.16;
                  g.beginFill(0x000000, 0.2);
                  g.drawEllipse(0, shadowY, tileSize * 0.34, tileSize * 0.16);
                  g.endFill();
                }
              }}
            />
            {(() => {
              // Smart sprite selection based on unit type and definitionId
              const defId = unit.definitionId.toLowerCase();
              let texturePath = '/assets/generated/infantry_squad.png';
              let desiredH = tileSize * 0.45; // infantry default - smaller to fit tile
              let anchorY = 0.95; // anchor near bottom so units stand on ground

              if (unitType === 'vehicle') {
                desiredH = tileSize * 0.65; // vehicles a bit bigger
                anchorY = 0.95; // anchor near bottom to sit on ground
                if (defId.includes('tank') || defId.includes('abrams') || defId.includes('m1')) {
                  texturePath = '/assets/generated/tank_m1_abrams.png';
                } else if (defId.includes('apc') || defId.includes('ifv') || defId.includes('m113')) {
                  texturePath = '/assets/generated/apc_m113.png';
                } else if (defId.includes('artillery') || defId.includes('mlrs') || defId.includes('howitzer')) {
                  texturePath = '/assets/generated/artillery_mlrs.png';
                } else if (defId.includes('heli') || defId.includes('apache') || defId.includes('chopper')) {
                  texturePath = '/assets/generated/helicopter_apache.png';
                } else {
                  texturePath = isFriendly ? '/assets/generated/tank_m1_abrams.png' : '/assets/generated/apc_m113.png';
                }
              } else if (unitType === 'infantry') {
                if (isFriendly) {
                  if (defId.includes('sniper') || defId.includes('scout')) {
                    texturePath = '/assets/generated/sniper_team.png';
                  } else if (defId.includes('medic') || defId.includes('doctor')) {
                    texturePath = '/assets/generated/medic_unit.png';
                  } else {
                    texturePath = '/assets/generated/infantry_squad.png';
                  }
                } else {
                  if (defId.includes('zombie') || defId.includes('undead')) {
                    texturePath = '/assets/generated/zombie_horde.png';
                  } else if (defId.includes('skeleton') || defId.includes('bone')) {
                    texturePath = '/assets/generated/skeleton_warrior.png';
                  } else if (defId.includes('golem')) {
                    texturePath = '/assets/generated/bone_golem.png';
                  } else if (defId.includes('ogre') || defId.includes('brute') || defId.includes('troll')) {
                    texturePath = '/assets/generated/ogre_brute.png';
                    desiredH = tileSize * 0.65; // ogres are bigger than infantry
                  } else {
                    texturePath = '/assets/generated/skeleton_warrior.png';
                  }
                }
              } else if (unitType === 'hero') {
                desiredH = tileSize * 0.55; // heroes slightly bigger than infantry
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

              let texture = unitTextureCache.get(texturePath);
              if (!texture) {
                texture = Texture.from(texturePath);
                unitTextureCache.set(texturePath, texture);
              }
              const baseScale = texture?.valid && texture.height > 0 ? desiredH / texture.height : 0.05;
              // Flip sprite based on unit orientation (0-5 hex directions)
              // 0=E, 1=NE, 2=N face right; 3=W, 4=SW, 5=S face left
              // Use animatedOrientation for smooth facing during movement
              const facingLeft = animatedOrientation >= 3 && animatedOrientation <= 5;
              const scaleX = facingLeft ? -baseScale : baseScale;
              return (
                <Sprite
                  texture={texture}
                  anchor={{ x: 0.5, y: anchorY }}
                  scale={{ x: scaleX, y: baseScale }}
                  alpha={isVisible ? 1 : 0.8}
                  y={tileSize * 0.05}
                  zIndex={1}
                />
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
                // entrench pips (top - slightly higher to make room for bars)
                const ent = (unit as any).entrench ?? 0;
                if (ent > 0) {
                  g.lineStyle(0);
                  g.beginFill(0xf5f5f5, 0.9);
                  const pipW = 4; const gap = 2; const totalW = ent * pipW + (ent - 1) * gap; let startX = -totalW / 2;
                  for (let i = 0; i < ent; i++) { g.drawRect(startX, -tileSize * 0.49, pipW, 3); startX += pipW + gap; }
                  g.endFill();
                }
                // HP / Morale / AP bars above unit - Spellcross style
                const maxHp = (unit as any).stats?.maxHealth ?? 100;
                const hpRatio = Math.max(0, Math.min(1, (unit as any).currentHealth / maxHp));
                const mrRatio = Math.max(0, Math.min(1, (unit as any).currentMorale / 100));
                const apRatio = Math.max(0, Math.min(1, (unit as any).currentAP / ((unit as any).stats?.maxAP ?? 10)));
                const bw = 32, bh = 4; const topY = -tileSize * 0.48;

                // HP bar (red/green gradient based on health)
                g.lineStyle(1, 0x222222, 0.9);
                g.beginFill(0x1a1a1a, 0.75); g.drawRect(-bw / 2, topY - 10, bw, bh); g.endFill();
                const hpColor = hpRatio > 0.6 ? 0x22cc44 : hpRatio > 0.3 ? 0xffaa00 : 0xff3333;
                g.beginFill(hpColor, 0.95); g.drawRect(-bw / 2 + 1, topY - 9, (bw - 2) * hpRatio, bh - 2); g.endFill();

                // Morale bar (yellow/blue)
                g.beginFill(0x1a1a1a, 0.75); g.drawRect(-bw / 2, topY - 5, bw, bh); g.endFill();
                const mrColor = mrRatio > 0.5 ? 0x4488ff : 0xffd700;
                g.beginFill(mrColor, 0.9); g.drawRect(-bw / 2 + 1, topY - 4, (bw - 2) * mrRatio, bh - 2); g.endFill();

                // AP bar (cyan)
                g.beginFill(0x1a1a1a, 0.75); g.drawRect(-bw / 2, topY, bw, bh); g.endFill();
                g.beginFill(0x00ddff, 0.85); g.drawRect(-bw / 2 + 1, topY + 1, (bw - 2) * apRatio, bh - 2); g.endFill();
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
    const EFFECT_DURATION = 400; // ms

    return attackEffects.map((effect) => {
      const elapsed = now - effect.startTime;
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

      // Projectile position along path
      const projX = fromX + (toX - fromX) * Math.min(progress * 2, 1);
      const projY = fromY + (toY - fromY) * Math.min(progress * 2, 1);

      const zIndex = Math.round(Math.max(fromY, toY)) + 100;

      return (
        <Container key={effect.id} zIndex={zIndex}>
          {/* Muzzle flash at source (first 100ms) */}
          {elapsed < 100 && (
            <Graphics
              x={fromX}
              y={fromY - tileSize * 0.15}
              draw={(g) => {
                g.clear();
                const flashSize = tileSize * 0.25 * (1 - elapsed / 100);
                // Orange/yellow flash
                g.beginFill(0xffaa00, 0.9);
                g.drawCircle(0, 0, flashSize);
                g.endFill();
                g.beginFill(0xffffff, 0.8);
                g.drawCircle(0, 0, flashSize * 0.5);
                g.endFill();
              }}
            />
          )}

          {/* Projectile trail (gunshot = small yellow dot, explosion = larger red) */}
          {progress < 0.5 && (
            <Graphics
              x={projX}
              y={projY - tileSize * 0.15}
              draw={(g) => {
                g.clear();
                if (effect.type === 'gunshot') {
                  // Small yellow tracer
                  g.beginFill(0xffdd00, 0.95);
                  g.drawCircle(0, 0, 3);
                  g.endFill();
                } else if (effect.type === 'explosion') {
                  // Larger red projectile
                  g.beginFill(0xff4400, 0.9);
                  g.drawCircle(0, 0, 5);
                  g.endFill();
                } else {
                  // Magic = purple sparkle
                  g.beginFill(0xaa44ff, 0.9);
                  g.drawCircle(0, 0, 4);
                  g.endFill();
                }
              }}
            />
          )}

          {/* Hit marker at target (after 200ms) */}
          {elapsed > 200 && (
            <Graphics
              x={toX}
              y={toY - tileSize * 0.2}
              draw={(g) => {
                g.clear();
                const hitProgress = (elapsed - 200) / (EFFECT_DURATION - 200);
                const hitSize = tileSize * 0.3 * (1 - hitProgress * 0.5);
                const hitAlpha = 1 - hitProgress;

                if (effect.type === 'explosion') {
                  // Explosion ring
                  g.beginFill(0xff6600, hitAlpha * 0.7);
                  g.drawCircle(0, 0, hitSize * 1.2);
                  g.endFill();
                  g.beginFill(0xffaa00, hitAlpha * 0.9);
                  g.drawCircle(0, 0, hitSize * 0.7);
                  g.endFill();
                } else {
                  // Impact sparks
                  g.beginFill(0xffffff, hitAlpha * 0.8);
                  g.drawCircle(0, 0, hitSize * 0.4);
                  g.endFill();
                }
              }}
            />
          )}
        </Container>
      );
    }).filter(Boolean) as JSX.Element[];
  }, [attackEffects, now, map.width, map.tiles, topGeomFor, toScreen]);

  const propsSprites = useMemo(() => {
    const props = (map.props ?? []).filter((prop) => prop.kind !== 'proc-building');
    if (props.length === 0) return [];
    const idxAt = (q: number, r: number) => r * map.width + q;
    const defaultTexturePath = '/props/tree1.png';
    const getTexture = (path?: string) => {
      const key = path ?? defaultTexturePath;
      if (!propTextureCache.has(key)) {
        propTextureCache.set(key, Texture.from(key));
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
        const scaleX = scale * (prop.flipX ? -1 : 1);
        const texturePath = prop.texture ?? defaultTexturePath;
        const textureMissing = missingPropPaths.has(texturePath);
        const texture = textureMissing ? null : getTexture(texturePath);

        return (
          <Container key={prop.id} x={worldX} y={worldY} zIndex={zIndex} sortableChildren>
            <Graphics
              zIndex={-1}
              draw={(g) => {
                g.clear();
                g.beginFill(0x000000, isVisible ? 0.18 : 0.1);
                g.drawEllipse(0, PROP_SHADOW_Y, tileSize * 0.18, tileSize * 0.1);
                g.endFill();
              }}
            />
            {textureMissing ? (
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
                scale={{ x: scaleX, y: scale }}
                alpha={isVisible ? 1 : 0.75}
              />
            )}
          </Container>
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [map.props, map.width, exploredTiles, visibleTiles, propTextureCache, topGeomFor, toScreen, missingPropPaths]);

  const procBuildings = useMemo(() => {
    const props = (map.props ?? []).filter(
      (p): p is MapProp & { kind: 'proc-building' } => p.kind === 'proc-building'
    );
    if (props.length === 0) return [];

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
        const isVisible = footprint.some((i) => visibleTiles.has(i));
        const fogAlpha = isVisible ? 1 : 0.62;
        const fogShade = isVisible ? 0 : 0.06;

        const q0 = b.coordinate.q;
        const r0 = b.coordinate.r;
        const w = Math.max(1, b.w ?? 1);
        const h = Math.max(1, b.h ?? 1);

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

        const levels = Math.max(1, b.levels ?? 2);
        const levelHeightPx = Math.max(8, b.levelHeightPx ?? Math.round(tileSize * 0.55));
        const heightPx = levels * levelHeightPx;
        const topNW = { x: bottomNW.x, y: bottomNW.y - heightPx };
        const topNE = { x: bottomNE.x, y: bottomNE.y - heightPx };
        const topSE = { x: bottomSE.x, y: bottomSE.y - heightPx };
        const topSW = { x: bottomSW.x, y: bottomSW.y - heightPx };

        const facade = b.facade ?? {};
        const wallColor = facade.baseColor ?? b.wallColor ?? 0x6f5f4f;
        const facadeMaterial = facade.material ?? 'plaster';
        const trimColor = facade.trimColor ?? lightenColor(wallColor, 0.25);
        const accentColor = facade.accentColor ?? darkenColor(wallColor, 0.2);
        const grimeStrength = clamp(facade.grime ?? 0, 0, 1);

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
              zIndex={-1}
              draw={(g) => {
                g.clear();
                g.beginFill(0x000000, isVisible ? 0.15 : 0.08);
                drawPoly(
                  g as PixiGraphics,
                  basePoly.map((p) => ({
                    x: p.x - anchor.x,
                    y: p.y - anchor.y
                  }))
                );
                g.endFill();
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
                  const dir = roofCfg.dir ?? 'E-W';
                  if (dir === 'E-W') {
                    const midW = { x: (topNW.x + topSW.x) / 2, y: (topNW.y + topSW.y) / 2 };
                    const midE = { x: (topNE.x + topSE.x) / 2, y: (topNE.y + topSE.y) / 2 };
                    const ridgeW = { x: midW.x, y: midW.y - heightPx * (1 + pitch) };
                    const ridgeE = { x: midE.x, y: midE.y - heightPx * (1 + pitch) };
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
                    const ridgeN = { x: midN.x, y: midN.y - heightPx * (1 + pitch) };
                    const ridgeS = { x: midS.x, y: midS.y - heightPx * (1 + pitch) };
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
                  const pitch = clamp(roofCfg.pitch ?? 0.25, 0, 1);
                  const center = {
                    x: (topNW.x + topNE.x + topSE.x + topSW.x) / 4,
                    y: (topNW.y + topNE.y + topSE.y + topSW.y) / 4 - heightPx * pitch
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

                drawRoofVents(
                  g as PixiGraphics,
                  topPoly.map((p) => ({ x: p.x, y: p.y })),
                  anchor,
                  roofVents,
                  lightenColor(roofColor, 0.1)
                );
              }}
            />
          </Container>
        );
      })
      .filter(Boolean) as JSX.Element[];
  }, [map.props, map.width, map.height, exploredTiles, visibleTiles, topGeomFor]);

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

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', imageRendering: 'pixelated' }}
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
        <Container x={offsetX} y={offsetY} scale={scale}>
          {/* World container. In HEX mode we fake tilt; in ISO mode it's identity. */}
          <Container x={ISO_MODE ? isoBaseX : 0} scale={{ x: 1, y: ISO_MODE ? 1 : 0.72 }} skew={{ x: ISO_MODE ? 0 : -0.28, y: 0 }}>
            {tileGraphics}
            {tileOverlays}
            {terrainMissingTexts}
            {/* Top-only overlay mask: punch holes for all vertical wall faces (E/S) */}
            <Graphics
              ref={overlayMaskRef}
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
            <Container mask={overlayMaskRef.current as any}>
              {movementRangeOverlays}
              {attackRangeOverlays}
              {plannedHighlights}
            </Container>

            {tileWalls}
            <Container sortableChildren>
              {procBuildings}
              {propsSprites}
              {deathMarkerSprites}
              {units}
              {attackEffectSprites}
            </Container>
          </Container>
        </Container>
        {/* Minimap (screen-space) */}
        {minimapVisible && (
          <Container x={10} y={10} interactive={true} eventMode="static"
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
