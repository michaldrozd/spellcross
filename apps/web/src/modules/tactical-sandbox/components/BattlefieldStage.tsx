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
    const width = map.width * hexWidth + hexWidth;
    const height = map.height * hexHeight + hexHeight;
    return { width, height };
  }, [map.height, map.width]);

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
      const p = axialToPixel((friendly as any).coordinate);
      setFollowTargetPx({ x: p.x, y: p.y });
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
        const p = axialToPixel(coord);
        setFollowTargetPx({ x: p.x, y: p.y });
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
      const { x: tx, y: ty } = axialToPixel(followCoord);
      offsetX = hostSize.w / 2 - tx * scale;

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

  const tileGraphics = useMemo(() => {
    return map.tiles.map((tile: any, index: number) => {
      const q = index % map.width;
      const r = Math.floor(index / map.width);
      const pos = axialToPixel({ q, r });
      const isVisible = visibleTiles.has(index);
      const isExplored = exploredTiles.has(index);

      return (
        <Graphics
          key={`tile-${index}`}

          x={pos.x}
          y={pos.y}
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
            const points = [
              { x: 0, y: -size },
              { x: hexWidth / 2, y: -size / 2 },
              { x: hexWidth / 2, y: size / 2 },
              { x: 0, y: size },
              { x: -hexWidth / 2, y: size / 2 },
              { x: -hexWidth / 2, y: -size / 2 }
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

              // 2) subtle pattern overlay (reduced alpha, no scaling to avoid moiré)
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
            }

            if (isExplored && !isVisible) {
              g.lineStyle(1, 0x0a1a2c, 0.45);
              g.moveTo(points[0].x, points[0].y);
              for (let i = 1; i < points.length; i++) {
                g.lineTo(points[i].x, points[i].y);
              }
              g.closePath();
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
        const pos = axialToPixel({ q, r });
        const isVisible = visibleTiles.has(index);
        const isExplored = exploredTiles.has(index);
        if (!isExplored) return null;
        return (
          <Graphics
            key={`overlay-${index}`}
            x={pos.x}
            y={pos.y}
            draw={(g) => {
              g.clear();
              const s = tileSize / 2;
              const hw = hexWidth / 2;
              const pts = [
                { x: 0, y: -s },
                { x: hw, y: -s / 2 },
                { x: hw, y: s / 2 },
                { x: 0, y: s },
                { x: -hw, y: s / 2 },
                { x: -hw, y: -s / 2 }
              ];
              // subtle border
              g.lineStyle(1, 0x0f1f16, isVisible ? 0.28 : 0.18);
              g.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
              g.closePath();

              // top-left light
              const varf = (((q * 31 + r * 57) % 7) - 3) * 0.01;
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
            }}
          />
        );
      })
        .filter(Boolean) as JSX.Element[];
    }, [map.tiles, map.width, visibleTiles, exploredTiles]);

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

    const dirs = [
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
        if (!tile || !tile.passable) continue;
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
      if (!exploredTiles.has(idx)) return; // respect FoW for rendering
      const { x, y } = axialToPixel({ q, r });
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
            const pts = [
              { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
              { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
            ];
            g.beginFill(canShoot ? 0x4a90e2 : 0x245a96, canShoot ? 0.22 : 0.22);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath(); g.endFill();

            // subtle outline to stand out over terrain overlay
            g.lineStyle(1, canShoot ? 0x6fb3ff : 0x3a78c4, 0.6);
            g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();

            // perimeter ring: draw thicker edges where neighbor is outside range
            g.lineStyle(2, canShoot ? 0x86b7ff : 0x3a78c4, 0.9);
            for (let ei = 0; ei < 6; ei++) {
              const d = dirs[ei];
              const nq = q + d.dq, nr = r + d.dr;
              const nkey = `${nq},${nr}`;
              if (!best.has(nkey)) {
                const a = pts[ei];
                const b = pts[(ei + 1) % 6];
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
        const d = axialDistance(start as any, { q, r } as any);
        if (d <= maxRange) inRange.add(`${q},${r}`);
      }
    }

    const dirs = [
      { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
      { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
    ];

    const elements: JSX.Element[] = [];
    inRange.forEach((_, key) => {
      const [qStr, rStr] = key.split(',');
      const q = Number(qStr), r = Number(rStr);
      const idx = r * map.width + q;
      if (!exploredTiles.has(idx)) return;
      const { x, y } = axialToPixel({ q, r });

      elements.push(
        <Graphics key={`atk-${q}-${r}`} x={x} y={y} draw={(g) => {
          g.clear();
          const s = (tileSize / 2) * 0.92; const hw = (hexWidth / 2) * 0.92;
          const pts = [
            { x: 0, y: -s }, { x: hw, y: -s / 2 }, { x: hw, y: s / 2 },
            { x: 0, y: s }, { x: -hw, y: s / 2 }, { x: -hw, y: -s / 2 }
          ];
          // soft orange fill
          g.beginFill(0xffa726, 0.15);
          g.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
          g.closePath();
          g.endFill();

          // ring edges only on perimeter of range
          g.lineStyle(2, 0xffc107, 0.9);
          for (let ei = 0; ei < 6; ei++) {
            const d = dirs[ei];
            const nq = q + d.dq, nr = r + d.dr;
            const nkey = `${nq},${nr}`;
            if (!inRange.has(nkey)) {
              const a = pts[ei];
              const b = pts[(ei + 1) % 6];
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
              if (!exploredTiles.has(idxA) || !exploredTiles.has(idxB)) continue;
              const pa = axialToPixel(a);
              const pb = axialToPixel(b);
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
      if (exploredTiles.has(idx)) {
        const { x, y } = axialToPixel(dest);
        elements.push(
          <Graphics
            key="dest-ring"
            x={x}
            y={y}
            draw={(g) => {
              g.clear();
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

  const units = useMemo(() => {
    return (Object.values(battleState.sides) as any[]).flatMap((side) =>
      Array.from((side as any).units.values()).flatMap((unit: any) => {
        const { x, y } = axialToPixel(unit.coordinate);
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
              <Graphics
                draw={(g) => {
                  g.clear();
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
                  g.lineStyle(2, 0x9adcb1, 0.95);
                  g.moveTo(pts[0].x, pts[0].y);
                  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
                  g.closePath();
                  // inner ring
                  g.lineStyle(1, 0x0b2a1d, 0.9);
                  const k = 0.92;
                  g.moveTo(pts[0].x * k, pts[0].y * k);
                  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x * k, pts[i].y * k);
                  g.closePath();
                }}
              />
            )}
            {isTarget && (
              <Graphics
                draw={(g) => {
                  g.clear();
                  const s = (tileSize / 2) * 0.98;
                  const hw = (hexWidth / 2) * 0.98;
                  const pts = [
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
            )}
            <Graphics
              draw={(g) => {
                g.clear();
                // simple placeholder sprites per unit type
                g.lineStyle(1, 0x000000, 0.5);
                const t = (unit as any).unitType as string;
                if (t === 'infantry') {
                  g.beginFill(color, 1); g.drawRect(-6, -6, 12, 12); g.endFill();
                  g.beginFill(0xf0f0f0, 0.9); g.drawCircle(0, -9, 2); g.endFill();
                } else if (t === 'vehicle' || t === 'artillery') {
                  g.beginFill(color, 1); g.drawRoundedRect(-12, -7, 24, 14, 3); g.endFill();
                  g.beginFill(0x222222, 0.9); g.drawRect(-12, -9, 24, 2); g.drawRect(-12, 7, 24, 2); g.endFill();
                  if (t === 'artillery') { g.lineStyle(2, 0xdddddd, 0.9); g.moveTo(0, -3); g.lineTo(14, -10); }
                } else if (t === 'air') {
                  g.beginFill(color, 1);
                  g.moveTo(0, -12); g.lineTo(12, 6); g.lineTo(-12, 6); g.closePath(); g.endFill();
                } else {
                  g.beginFill(color, 1);
                  g.moveTo(0, -10); g.lineTo(10, 0); g.lineTo(0, 10); g.lineTo(-10, 0); g.closePath(); g.endFill();
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
            const p = axialToPixel(coord);
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
          {tileGraphics}
          {tileOverlays}
          {movementRangeOverlays}
          {attackRangeOverlays}
          {plannedHighlights}
          {units}
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
                    const p = axialToPixel({ q, r });
                    const tx = p.x * sx;
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
                  const p = axialToPixel(u.coordinate);
                  const ux = p.x * sx;
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
