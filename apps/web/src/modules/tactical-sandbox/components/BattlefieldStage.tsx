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
              // Colored vs. grayscale textures: if colored sheet is used, skip base fill and use full-opacity texture
              const coloredTex = !!externalTerrainTextures && externalTexturesAreColored;
              if (!coloredTex) {
                // 1) solid base color (palette-driven)
                const baseColor = (terrainPalette as any)[tile.terrain] ?? terrainPalette.plain;
                g.beginFill(baseColor, isVisible ? 1.0 : 0.6);
                g.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
                g.closePath();
                g.endFill();
              }

              // 2) textured overlay (external PNGs override procedural textures if present)
              const tex = (externalTerrainTextures?.[tile.terrain] ?? externalTerrainTextures?.plain)
                ?? ((terrainTextures as any)[tile.terrain] ?? (terrainTextures as any).plain);
              const m = new Matrix();
              const ox = (q * 13 + r * 7) % 32; // small per-tile offset to break tiling
              const oy = (q * 5 + r * 11) % 32;
              m.translate(ox, oy);
              const overlayAlpha = coloredTex ? (isVisible ? 1.0 : 0.75) : (isVisible ? 0.28 : 0.16);
              g.beginTextureFill({ texture: tex, matrix: m, alpha: overlayAlpha });
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
                          // no need for slope-edge helper here; top shading uses only per-corner heights
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

                  // Skip edge lines for pure elevation steps — terrain change only
                  if (!terrDiff) continue;

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
    return map.tiles.map((tile: any, index: number) => {
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = toScreen({ q, r });
      const elev = (tile as any).elevation ?? 0;
      const posY = pos.y - elev * ELEV_Y_OFFSET;
      const isVisible = visibleTiles.has(index);
      const isExplored = exploredTiles.has(index);
      if (!isExplored || !isVisible) return null; // walls only on currently visible tiles

      return (
        <Graphics
          key={`walls-${index}`}
          x={pos.x}
          y={posY}
          draw={(g) => {
            g.clear();
            if (!ISO_MODE) return; // walls only for ISO mode

            const points = [
              { x: 0, y: -(ISO_TILE_H / 2) }, // N(0)
              { x: ISO_TILE_W / 2, y: 0 },    // E(1)
              { x: 0, y: ISO_TILE_H / 2 },    // S(2)
              { x: -ISO_TILE_W / 2, y: 0 }    // W(3)
            ];

            const idxAt = (qq: number, rr: number) => rr * map.width + qq;
            const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;

            // Draw only E and S faces with corner-aware rules (no wall under slopes)
            const neighbors = [
              { dq: 0, dr: -1 }, // N(0)
              { dq: +1, dr: 0 }, // E(1)
              { dq: 0, dr: +1 }, // S(2)
              { dq: -1, dr: 0 }  // W(3)
            ];
            const faceEdges = [1, 2]; // E and S
            const opp: Record<'N'|'E'|'S'|'W','N'|'E'|'S'|'W'> = { N: 'S', E: 'W', S: 'N', W: 'E' };
            const tileAt = (qq: number, rr: number) => inb(qq, rr) ? (map.tiles[idxAt(qq, rr)] as any) : undefined;
            const hasSlopeEdgeFromHigher = (qq: number, rr: number, dir: 'N'|'E'|'S'|'W') => {
              const t = tileAt(qq, rr); if (!t) return false;
              const nQ = qq + neighbors[{ N:0,E:1,S:2,W:3 }[dir]].dq;
              const nR = rr + neighbors[{ N:0,E:1,S:2,W:3 }[dir]].dr;
              const nt = tileAt(nQ, nR); if (!nt) return false;
              const eHere = (t.elevation ?? 0), eNei = (nt.elevation ?? 0);
              if (eHere - eNei !== 1) return false; // only when current tile is exactly one higher
              const markHere = (t.elevEdges?.[dir] === 'slope');
              const markNei = (nt.elevEdges?.[opp[dir]] === 'slope');
              return markHere || markNei;
            };
            const cornersOf = (qq: number, rr: number) => snappedCorners.getCorners(qq, rr);
            const edgePair = (c: {hNW:number;hNE:number;hSE:number;hSW:number}, edgeIndex: number): [number,number] => {
              if (edgeIndex === 0) return [c.hNW, c.hNE]; // N
              if (edgeIndex === 1) return [c.hNE, c.hSE]; // E
              if (edgeIndex === 2) return [c.hSW, c.hSE]; // S
              return [c.hNW, c.hSW]; // W
            };

            for (const ei of faceEdges) {
              const nq = q + neighbors[ei].dq; const nr = r + neighbors[ei].dr;
              if (!inb(nq, nr)) continue;
              const p0 = points[ei]; const p1 = points[(ei + 1) % 4];
              if (!p0 || !p1) continue;

              const mul = (hex: number, f: number) => {
                const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * f)));
                const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * f)));
                const b = Math.min(255, Math.max(0, Math.round(((hex) & 255) * f)));
                return (r << 16) | (g << 8) | b;
              };


              // Base terrain color (used for wall tint and slope wedges)
              const baseTop = (terrainPalette as any)[tile.terrain] ?? terrainPalette.plain;
              const r0 = (baseTop >> 16) & 0xff;
              const g0 = (baseTop >> 8) & 0xff;
              const b0 = baseTop & 0xff;

              const dir: 'E'|'S' = (ei === 1 ? 'E' : 'S');
              const color = dir === 'E' ? mul(baseTop, 0.52) : mul(baseTop, 0.62);
              const wallAlpha = 0.88;

              const aC = cornersOf(q, r);
              const bC = cornersOf(nq, nr);
              const aEdge = edgePair(aC, ei);
              const bOpp = edgePair(bC, ei === 1 ? 3 : 0); // neighbor's W or N edge
              const delta = Math.min(aEdge[0], aEdge[1]) - Math.max(bOpp[0], bOpp[1]);
              const edgeIsSlope = Math.abs(aEdge[0] - aEdge[1]) === 1; // ramp runs along this edge

              // If this edge is a slope from the higher tile, draw wedge and skip wall
              const slopeHere = hasSlopeEdgeFromHigher(q, r, dir);
              if (slopeHere) {
                const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                const toCenter = { x: -mid.x, y: -mid.y };
                const len = Math.hypot(toCenter.x, toCenter.y) || 1;
                const k = ei === 1 ? 0.22 : 0.19; // thinner wedge; S slightly subtler
                const nx = (toCenter.x / len) * ISO_TILE_W * k * (ei === 1 ? 1.0 : 0.85);
                const ny = (toCenter.y / len) * ISO_TILE_H * k * (ei === 1 ? 1.0 : 0.85);
                const p0i = { x: p0.x + nx, y: p0.y + ny };
                const p1i = { x: p1.x + nx, y: p1.y + ny };

                const rS = Math.max(0, Math.min(255, Math.round(r0 * 0.55)));
                const gS = Math.max(0, Math.min(255, Math.round(g0 * 0.55)));
                const bS = Math.max(0, Math.min(255, Math.round(b0 * 0.55)));
                const slopeColor = (rS << 16) | (gS << 8) | bS;
                const alpha = ei === 1 ? 0.26 : 0.20; // E a bit darker than S (light from NW)

                g.beginFill(slopeColor, alpha);
                g.moveTo(p0.x, p0.y); g.lineTo(p1.x, p1.y); g.lineTo(p1i.x, p1i.y); g.lineTo(p0i.x, p0i.y); g.closePath();
                g.endFill();

                // inner rim
                g.lineStyle(1, 0xffffff, 0.06);
                g.moveTo(p0i.x, p0i.y); g.lineTo(p1i.x, p1i.y); g.lineStyle();

                // shoulders
                const s = 0.38, e = 0.18;
                const t0 = { x: p0.x + (p0i.x - p0.x) * s, y: p0.y + (p0i.y - p0.y) * s };
                const t1 = { x: p1.x + (p1i.x - p1.x) * s, y: p1.y + (p1i.y - p1.y) * s };
                const ex = p1.x - p0.x, ey = p1.y - p0.y;
                const s0 = { x: p0.x + ex * e, y: p0.y + ey * e };
                const s1 = { x: p1.x - ex * e, y: p1.y - ey * e };
                g.beginFill(slopeColor, alpha * 0.92);
                g.moveTo(p0.x, p0.y); g.lineTo(t0.x, t0.y); g.lineTo(s0.x, s0.y); g.closePath();
                g.moveTo(p1.x, p1.y); g.lineTo(t1.x, t1.y); g.lineTo(s1.x, s1.y); g.closePath();
                g.endFill();
                g.lineStyle(1, 0xffffff, 0.05);
                g.moveTo(p0.x, p0.y); g.lineTo(s0.x, s0.y);
                g.moveTo(p1.x, p1.y); g.lineTo(s1.x, s1.y);
                g.lineStyle();
                continue;
              }

              // Never draw a vertical wall along a ramp edge (robust even if elevEdges missing)
              if (edgeIsSlope) continue;

              // No wall if corners meet (slope/flat transition)
              if (delta <= 0) continue;

              // Vertical wall for a sheer cliff; height from corner delta
              const depth = delta * CLIFF_DEPTH;

              g.beginFill(color, wallAlpha);
              g.moveTo(p0.x, p0.y);
              g.lineTo(p1.x, p1.y);
              g.lineTo(p1.x, p1.y + depth);
              g.lineTo(p0.x, p0.y + depth);
              g.closePath();
              g.endFill();

              // top rim highlight for readability
              g.lineStyle(1, 0xffffff, 0.16);
              g.moveTo(p0.x, p0.y);
              g.lineTo(p1.x, p1.y);
              g.lineStyle();

              // base shadow to anchor the wall
              g.lineStyle(1, 0x000000, 0.20);
              g.moveTo(p0.x, p0.y + depth);
              g.lineTo(p1.x, p1.y + depth);
              g.lineStyle();
            }
          }}
        />
      );
    }).filter(Boolean) as JSX.Element[];
  }, [map.tiles, map.width, visibleTiles, exploredTiles]);


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
                // Fill whole world, then subtract wall quads as holes
                g.beginFill(0xffffff, 1);
                g.drawRect(-10000, -10000, 20000, 20000);

                const idxAt = (qq: number, rr: number) => rr * map.width + qq;
                const inb = (qq: number, rr: number) => qq >= 0 && rr >= 0 && qq < map.width && rr < map.height;
                const neighbors = [
                  { dq: 0, dr: -1 }, // N(0)
                  { dq: +1, dr: 0 }, // E(1)
                  { dq: 0, dr: +1 }, // S(2)
                  { dq: -1, dr: 0 }  // W(3)
                ];
                const faceEdges = [1, 2]; // E and S
                const cornersOf = (qq: number, rr: number) => snappedCorners.getCorners(qq, rr);
                const edgePair = (c: {hNW:number;hNE:number;hSE:number;hSW:number}, edgeIndex: number): [number,number] => {
                  if (edgeIndex === 0) return [c.hNW, c.hNE]; // N
                  if (edgeIndex === 1) return [c.hNE, c.hSE]; // E
                  if (edgeIndex === 2) return [c.hSW, c.hSE]; // S
                  return [c.hNW, c.hSW]; // W
                };

                for (let rr = 0; rr < map.height; rr++) {
                  for (let qq = 0; qq < map.width; qq++) {
                    const index = idxAt(qq, rr);
                    if (!visibleTiles.has(index)) continue; // mask only where walls can appear (visible)

                    const aC = cornersOf(qq, rr);
                    const pos = toScreen({ q: qq, r: rr });
                    const elev = ((map.tiles[index] as any).elevation ?? 0);
                    const posY = pos.y - elev * ELEV_Y_OFFSET;
                    const points = [
                      { x: pos.x + 0, y: posY - ISO_TILE_H / 2 },    // N
                      { x: pos.x + ISO_TILE_W / 2, y: posY },        // E
                      { x: pos.x + 0, y: posY + ISO_TILE_H / 2 },    // S
                      { x: pos.x - ISO_TILE_W / 2, y: posY }         // W
                    ];

                    for (const ei of faceEdges) {
                      const nq = qq + neighbors[ei].dq; const nr = rr + neighbors[ei].dr;
                      if (!inb(nq, nr)) continue;
                      const bC = cornersOf(nq, nr);

                      const aEdge = edgePair(aC, ei);
                      const bOpp  = edgePair(bC, ei === 1 ? 3 : 0);
                      // Skip if the edge is a ramp (no vertical face to mask)
                      const edgeIsSlope = Math.abs(aEdge[0] - aEdge[1]) === 1;
                      if (edgeIsSlope) continue;

                      const delta = Math.min(aEdge[0], aEdge[1]) - Math.max(bOpp[0], bOpp[1]);
                      if (delta <= 0) continue; // no vertical wall
                      const depth = delta * CLIFF_DEPTH;

                      const p0 = points[ei];
                      const p1 = points[(ei + 1) % points.length];
                      const b0 = { x: p0.x, y: p0.y + depth };
                      const b1 = { x: p1.x, y: p1.y + depth };

                      g.beginHole();
                      g.moveTo(p0.x, p0.y);
                      g.lineTo(p1.x, p1.y);
                      g.lineTo(b1.x, b1.y);
                      g.lineTo(b0.x, b0.y);
                      g.closePath();
                      g.endHole();
                    }
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
