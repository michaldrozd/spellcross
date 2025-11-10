import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { FactionId, HexCoordinate, TacticalBattleState } from '@spellcross/core';
import { movementMultiplierForStance } from '@spellcross/core';
import { canAffordAttack } from '@spellcross/core';
import { axialDistance } from '@spellcross/core';
import { Container, Graphics, Stage, Text } from '@pixi/react';
import { Matrix, Texture, Rectangle } from 'pixi.js';

import { TextStyle } from 'pixi.js';

const tileSize = 56;
const hexWidth = tileSize;
const hexHeight = tileSize * 0.866; // sin(60deg)


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
        // 1) Per-terrain PNGs (highest priority if present)
        await Promise.all(names.map(async (n) => {
          const url = `/textures/terrain/${n}.png`;
          try {
            const res = await fetch(url, { method: 'GET' });
            if (!res.ok) return;
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            out[n] = Texture.from(objUrl);
            anyLoaded = true;
            explicitColorTextures = true;
          } catch { /* ignore */ }
        }));

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
        const finalMode: 'colored' | 'grayscale' =
          explicitColorTextures ? 'colored' : (sheetMode ?? 'grayscale');
        setExternalTerrainTextures(finalMode === 'colored' && anyLoaded ? out : null);
        setExternalTexturesAreColored(finalMode === 'colored');
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [allowExternalTextures]);


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
      const tex = (externalTerrainTextures?.[tile.terrain] ?? externalTerrainTextures?.plain)
        ?? ((terrainTextures as any)[tile.terrain] ?? (terrainTextures as any).plain);
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
                const tint = mixColor(baseColor, (terrainPalette as any)[neighborTile.terrain] ?? baseColor, 0.45);
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
            const mvAlpha = externalTexturesAreColored ? (canShoot ? 0.08 : 0.06) : (canShoot ? 0.16 : 0.12);
            g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, mvAlpha);
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
  }, [battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles, externalTexturesAreColored]);
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
          const atkAlpha = externalTexturesAreColored ? 0.08 : 0.12;
          g.beginFill(0xffa726, atkAlpha);
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
  }, [showAttackOverlay, battleState.sides, selectedUnitId, viewerFaction, map.width, map.height, exploredTiles, externalTexturesAreColored]);





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
              const elevA = ((map.tiles[idxA] as any).elevation ?? 0);
              const elevB = ((map.tiles[idxB] as any).elevation ?? 0);
              const pa = { x: pa0.x, y: pa0.y - elevA * ELEV_Y_OFFSET };
              const pb = { x: pb0.x, y: pb0.y - elevB * ELEV_Y_OFFSET };
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
        const elev = ((map.tiles[idx] as any).elevation ?? 0);
        const x = p.x;
        const y = p.y - elev * ELEV_Y_OFFSET;
        elements.push(
          <Graphics
            key="dest-ring"
            x={x}
            y={y}
            draw={(g) => {
              g.clear();
              const s = (tileSize / 2) * 0.96;
              const hw = (hexWidth / 2) * 0.96;
              const pts = ISO_MODE
                ? [
                    { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                  ]
                : [
                    { x: 0, y: -s },
                    { x: hw, y: -s / 2 },
                    { x: hw, y: s / 2 },
                    { x: 0, y: s },
                    { x: -hw, y: s / 2 },
                    { x: -hw, y: -s / 2 }
                  ];
              g.lineStyle(2, 0xffc107, 0.95);
              g.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath();
            }}
          />
        );
      }
    }



    return elements;
  }, [exploredTiles, map.width, plannedDestination, plannedPath]);

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


  const units = useMemo(() => {
    return (Object.values(battleState.sides) as any[]).flatMap((side) =>
      Array.from((side as any).units.values()).flatMap((unit: any) => {
        const p = toScreen(unit.coordinate);
        const idx = unit.coordinate.r * map.width + unit.coordinate.q;
        const elev = ((map.tiles[idx] as any).elevation ?? 0);
        const UNIT_NUDGE_X = 0; // ISO: keep X centered
        const UNIT_NUDGE_Y = ISO_MODE ? -Math.round(ISO_TILE_H * 0.34) : 0; // slightly higher per feedback
        const x = Math.round(p.x + UNIT_NUDGE_X);
        const y = Math.round(p.y - elev * ELEV_Y_OFFSET + UNIT_NUDGE_Y);
        const color = unit.faction === 'alliance' ? 0x5dade2 : 0xe74c3c;
        const isSelected = unit.id === selectedUnitId;
        const isTarget = unit.id === targetUnitId;
        const tileIndex = unit.coordinate.r * map.width + unit.coordinate.q;
        const isVisible = visibleTiles.has(tileIndex);
        const isFriendly = unit.faction === viewerFaction;
        const isDestroyed = unit.stance === 'destroyed';

        // Respect fog-of-war for enemies
        if (!isFriendly && !isVisible) return [];

        // Clear death marker (very obvious): skull + burn mark. Do not render normal unit.
        if (isDestroyed) {
          return (
            <Container key={unit.id} x={x} y={y}>
              {/* dark scorched circle */}
              <Graphics
                draw={(g) => {
                  g.clear();
                  g.beginFill(0x000000, 0.45);
                  g.drawCircle(0, 0, tileSize * 0.26);
                  g.endFill();
                  g.lineStyle(2, 0xff2d55, 0.85);
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
        }

        return (
          <Container
            key={unit.id}
            x={x}
            y={y}
            interactive={true}
            pointerdown={() => onSelectUnit?.(unit.id)}
          >
            {isSelected && (
              <Container y={-UNIT_NUDGE_Y}>
                <Graphics
                  draw={(g) => {
                    g.clear();
                    const s = (tileSize / 2) * 0.96;
                    const hw = (hexWidth / 2) * 0.96;
                    const pts = ISO_MODE
                      ? [
                          { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                        ]
                      : [
                          { x: 0, y: -s },
                          { x: hw, y: -s / 2 },
                          { x: hw, y: s / 2 },
                          { x: 0, y: s },
                          { x: -hw, y: s / 2 },
                          { x: -hw, y: -s / 2 }
                        ];
                    g.lineStyle(1, 0x95d7ab, 0.85);
                    g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath();
                    // inner ring
                    g.lineStyle(1, 0x0b2a1d, 0.65);
                    const k = 0.92;
                    g.moveTo(pts[0].x * k, pts[0].y * k);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x * k, pts[i].y * k);
                    g.closePath();
                  }}
                />
              </Container>
            )}
            {isTarget && (
              <Container y={-UNIT_NUDGE_Y}>
                <Graphics
                  draw={(g) => {
                    g.clear();
                    const s = (tileSize / 2) * 0.98;
                    const hw = (hexWidth / 2) * 0.98;
                    const pts = ISO_MODE
                      ? [
                          { x: 0, y: -(s * 0.5) }, { x: hw, y: 0 }, { x: 0, y: (s * 0.5) }, { x: -hw, y: 0 }
                        ]
                      : [
                          { x: 0, y: -s },
                          { x: hw, y: -s / 2 },
                          { x: hw, y: s / 2 },
                          { x: 0, y: s },
                          { x: -hw, y: s / 2 },
                          { x: -hw, y: -s / 2 }
                        ];
                    g.lineStyle(2, 0xff2d55, 0.95);
                    g.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                    g.closePath();
                    // crosshair
                    g.moveTo(-tileSize * 0.18, 0);
                    g.lineTo(tileSize * 0.18, 0);
                    g.moveTo(0, -tileSize * 0.18);
                    g.lineTo(0, tileSize * 0.18);
                  }}
                />
              </Container>
            )}
            <Graphics
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
                const t = (unit as any).unitType as string;

                // soft ground shadow (under the unit)
                const shadowY = tileSize * 0.16; // closer to centre so it doesn't feel "between tiles"
                g.beginFill(0x000000, 0.22);
                g.drawEllipse(0, shadowY, tileSize * 0.34, tileSize * 0.16);
                g.endFill();

                // top cap footprint (diamond in ISO mode, hex otherwise)
                const H = t === 'air' ? tileSize * 0.10 : tileSize * 0.28;
                const k = t === 'infantry' ? 0.32 : (t === 'vehicle' || t === 'artillery') ? 0.46 : 0.40;
                const sCap = (tileSize / 2) * k; const hwCap = (hexWidth / 2) * k;
                const cap = ISO_MODE
                  ? [
                      { x: 0, y: -(sCap * 0.5) }, { x: hwCap, y: 0 }, { x: 0, y: (sCap * 0.5) }, { x: -hwCap, y: 0 }
                    ]
                  : [
                      { x: 0, y: -sCap },
                      { x: hwCap, y: -sCap / 2 },
                      { x: hwCap, y:  sCap / 2 },
                      { x: 0, y:  sCap },
                      { x: -hwCap, y:  sCap / 2 },
                      { x: -hwCap, y: -sCap / 2 }
                    ];

                // side faces (only for ground units)
                if (t !== 'air') {
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
                g.moveTo(cap[0].x, cap[0].y);
                for (let i = 1; i < cap.length; i++) g.lineTo(cap[i].x, cap[i].y);
                g.closePath();
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
                // HP / Morale bars above unit
                const maxHp = (unit as any).stats?.maxHealth ?? 100;
                const hpRatio = Math.max(0, Math.min(1, (unit as any).currentHealth / maxHp));
                const mrRatio = Math.max(0, Math.min(1, (unit as any).currentMorale / 100));
                const bw = 26, bh = 3; const topY = -tileSize * 0.40;
                g.beginFill(0x000000, 0.55); g.drawRect(-bw / 2, topY - 6, bw, bh); g.endFill();
                g.beginFill(0xff3333, 0.95); g.drawRect(-bw / 2, topY - 6, bw * hpRatio, bh); g.endFill();
                g.beginFill(0x000000, 0.55); g.drawRect(-bw / 2, topY - 1, bw, bh); g.endFill();
                g.beginFill(0xffd86b, 0.95); g.drawRect(-bw / 2, topY - 1, bw * mrRatio, bh); g.endFill();
              }}
            />
            <Text
              text={unit.definitionId}
              anchor={0.5}
              y={tileSize * 0.35}
              style={new TextStyle({
                fill: 0xfefefe,
                fontSize: 12
              })}
            />
          </Container>
        );
      })
    );
  }, [
    battleState.sides,
    map.width,
    selectedUnitId,
    targetUnitId,
    viewerFaction,
    visibleTiles
  ]);

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
          antialias: false
        }}
      >
        <Container x={offsetX} y={offsetY} scale={scale}>
          {/* World container. In HEX mode we fake tilt; in ISO mode it's identity. */}
          <Container x={ISO_MODE ? isoBaseX : 0} scale={{ x: 1, y: ISO_MODE ? 1 : 0.72 }} skew={{ x: ISO_MODE ? 0 : -0.28, y: 0 }}>
            {tileGraphics}
            {tileOverlays}
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
            {units}
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
