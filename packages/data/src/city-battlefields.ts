// Per-city battlefield generator. Each campaign sector gets its own unique, deterministic
// map themed to the city (river crossings, alpine passes, ruined metropolises, the demonic rift, …),
// instead of reusing 5 shared layouts. Generation is seeded by the sector id, so a city always looks the
// same, and every start zone / spawn / objective is chosen from known-passable tiles — valid by
// construction (a unit test additionally asserts bounds, passability and zone-to-zone connectivity).

import type {
  BattlefieldEnvironment,
  BattlefieldMap,
  MapProp,
  MapTile,
  TacticalObjective,
  TacticalScenario,
  TacticalScenarioEvent,
  TacticalScenarioEventEffect,
  ScenarioUnit,
  TerrainType
} from './index.js';

type Coord = { q: number; r: number };
type GameplayType = 'evac' | 'rescue' | 'hold' | 'bridgehead' | 'convoy' | 'raid-night' | 'spire';
type TacticalMapScaleBand = 'early' | 'mid' | 'late' | 'lateHold';

export const TACTICAL_MAP_SCALE_BANDS = {
  early: {
    width: 30,
    height: 54,
    deploymentWidth: 5,
    deploymentDepth: 4,
    maxCellsPerEnemy: 120,
    sceneryDensity: 1,
    reserveRound: 4,
    travelDeadlineRound: 12,
    patrolProgress: [0.18, 0.4, 0.62, 0.82]
  },
  mid: {
    width: 40,
    height: 54,
    deploymentWidth: 6,
    deploymentDepth: 4,
    maxCellsPerEnemy: 120,
    sceneryDensity: 1,
    reserveRound: 5,
    travelDeadlineRound: 15,
    patrolProgress: [0.16, 0.36, 0.58, 0.8]
  },
  late: {
    width: 60,
    height: 70,
    deploymentWidth: 7,
    deploymentDepth: 5,
    maxCellsPerEnemy: 120,
    sceneryDensity: 0.5,
    reserveRound: 7,
    travelDeadlineRound: 22,
    patrolProgress: [0.15, 0.34, 0.56, 0.79]
  },
  // Hold operations protect a key commander, so their late-game line needs room to deploy wider.
  lateHold: {
    width: 60,
    height: 70,
    deploymentWidth: 8,
    deploymentDepth: 5,
    maxCellsPerEnemy: 120,
    sceneryDensity: 0.5,
    reserveRound: 7,
    travelDeadlineRound: 22,
    patrolProgress: [0.15, 0.34, 0.56, 0.79]
  }
} as const;

interface CityConfig {
  territoryId: string;
  name: string;
  brief: string;
  theme: BattlefieldEnvironment;
  gameplay: GameplayType;
  width: number;
  height: number;
  weather?: 'clear' | 'night' | 'fog';
  difficulty: number; // 1-5, scales enemy roster
  rosterOffset?: number;
  scaleBand?: TacticalMapScaleBand;
  specialistDeadlineRound?: number;
}

// --- deterministic RNG (mulberry32) so generated data is stable across reloads/saves/tests ---
function makeRng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tileOf = (terrain: TerrainType, extra: Partial<MapTile> = {}): MapTile => ({
  terrain, elevation: 0, cover: 0, movementCostModifier: 1, passable: true, providesVisionBoost: false, ...extra
});

const TERRAIN_TILE: Record<string, (rng: () => number) => MapTile> = {
  // Each terrain has a distinct tactical role: open ground is exposed & fast, forest hides & blocks
  // sight, urban/rubble are hard cover that break line of sight, hills see & shoot far, swamp bogs you
  // down with no cover, roads are fast but exposed.
  plain: () => tileOf('plain'),
  road: () => tileOf('road', { cover: 0, movementCostModifier: 0.7 }),
  forest: () => tileOf('forest', { cover: 2, movementCostModifier: 2, blocksVision: true }),
  urban: () => tileOf('urban', { cover: 3, movementCostModifier: 1.1, blocksVision: true }),
  hill: () => tileOf('hill', { elevation: 1, providesVisionBoost: true, cover: 1, movementCostModifier: 1.4 }),
  water: () => tileOf('water', { passable: false, movementCostModifier: 99 }),
  swamp: () => tileOf('swamp', { cover: 0, movementCostModifier: 2.2 }),
  rubble: () => tileOf('structure', { cover: 3, movementCostModifier: 1.6, blocksVision: true, destructible: true, hp: 20 })
};

const inB = (q: number, r: number, w: number, h: number) => q >= 0 && q < w && r >= 0 && r < h;

// Paint a theme's signature terrain feature (a river, a coast, alpine ridges, a rift scar, …) onto the
// grid. Returns nothing; mutates `kind` (a per-tile terrain-key grid) which is turned into tiles after.
function paintFeature(theme: BattlefieldEnvironment, kind: string[][], w: number, h: number, rng: () => number) {
  const set = (q: number, r: number, k: string) => { if (inB(q, r, w, h)) kind[r][q] = k; };
  if (theme === 'river' || theme === 'canal') {
    // a sinuous river/canal crossing top-to-bottom, with one or two bridges (road) over it
    let col = Math.floor(w * (0.35 + rng() * 0.3));
    const bridges = new Set<number>([Math.floor(h * 0.35), Math.floor(h * 0.7)].slice(0, theme === 'canal' ? 2 : 1));
    for (let r = 0; r < h; r++) {
      col += Math.round(rng() * 2 - 1);
      col = Math.max(2, Math.min(w - 3, col));
      const span = theme === 'canal' ? 1 : 1 + (rng() < 0.4 ? 1 : 0);
      for (let d = 0; d <= span; d++) set(col + d, r, bridges.has(r) ? 'road' : 'water');
      if (bridges.has(r)) { set(col - 1, r, 'road'); set(col + span + 1, r, 'road'); }
    }
  } else if (theme === 'coast') {
    // sea fills one long edge; a strip of swamp marks the shoreline
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      if (r >= h - 2) set(q, r, 'water');
      else if (r === h - 3) set(q, r, rng() < 0.6 ? 'swamp' : 'plain');
    }
  } else if (theme === 'alpine') {
    // two ridge lines forcing a central pass
    for (let q = 0; q < w; q++) {
      if (rng() < 0.7) set(q, 1, 'hill');
      if (rng() < 0.7) set(q, h - 2, 'hill');
    }
    const passR = Math.floor(h / 2);
    for (let q = 0; q < w; q++) set(q, passR, 'road');
  } else if (theme === 'rift') {
    // a scorched rift scar (impassable rubble + swamp) snaking across, leaving flanking lanes
    let col = Math.floor(w / 2);
    for (let r = 1; r < h - 1; r++) {
      col += Math.round(rng() * 2 - 1);
      col = Math.max(2, Math.min(w - 3, col));
      set(col, r, rng() < 0.5 ? 'rubble' : 'swamp');
      if (rng() < 0.5) set(col + 1, r, 'swamp');
    }
  }
}

interface Generated {
  map: BattlefieldMap;
  allianceZone: Coord[];
  otherSideZone: Coord[];
  roadPath: Coord[];
  passable: Coord[]; // all passable tiles (no buildings)
  reachable: Coord[]; // passable tiles reachable from the alliance zone — enemies/objectives go here only
}

// Smooth value-noise field on a coarse lattice (bilinear, smoothstep) → contiguous regions, not
// per-tile salt-and-pepper. `cells` is the feature size in tiles.
function makeNoise(rng: () => number, w: number, h: number, cells: number) {
  const gx = Math.ceil(w / cells) + 2, gy = Math.ceil(h / cells) + 2;
  const lat: number[][] = Array.from({ length: gy }, () => Array.from({ length: gx }, () => rng()));
  const ss = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = x / cells, fy = y / cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = ss(fx - x0), ty = ss(fy - y0);
    const a = lat[y0][x0], b = lat[y0][x0 + 1], c = lat[y0 + 1][x0], d = lat[y0 + 1][x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// Map a noise value to a coherent biome per theme (regions, not noise). Returns a terrain key.
function biomeFor(theme: BattlefieldEnvironment, n: number, n2: number): string {
  switch (theme) {
    case 'forest': return n > 0.58 ? 'forest' : n2 > 0.82 ? 'hill' : 'plain';
    case 'alpine': return n2 > 0.7 ? 'hill' : n > 0.62 ? 'forest' : 'plain';
    case 'urban': return n > 0.62 ? 'urban' : 'plain';
    case 'industrial': return n > 0.6 ? 'urban' : n2 > 0.7 ? 'urban' : 'plain';
    case 'oldtown': return n > 0.55 ? 'urban' : 'plain';
    case 'ruins': return n > 0.62 ? 'rubble' : n > 0.42 ? 'urban' : 'plain';
    case 'rift': return n > 0.6 ? 'swamp' : n > 0.46 ? 'rubble' : 'plain';
    case 'river': return n > 0.66 ? 'forest' : 'plain';
    case 'canal': return n > 0.66 ? 'urban' : 'plain';
    case 'coast': return n > 0.66 ? 'forest' : n < 0.3 ? 'swamp' : 'plain';
    default: return 'plain';
  }
}

function generate(cfg: CityConfig): Generated {
  const { width: w, height: h, theme } = cfg;
  const scaleProfile = cfg.scaleBand ? TACTICAL_MAP_SCALE_BANDS[cfg.scaleBand] : undefined;
  const rng = makeRng(`${cfg.territoryId}:${theme}:${w}x${h}`);
  const kind: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => 'ground'));

  // 1) coherent biome regions from smooth noise (contiguous forests, urban districts, ridges, …)
  const noiseA = makeNoise(rng, w, h, 4);
  const noiseB = makeNoise(rng, w, h, 5);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    kind[r][q] = biomeFor(theme, noiseA(q, r), noiseB(q, r));
  }
  // 2) signature feature carved over the biomes (river+bridge, coastline, alpine pass, rift scar)
  paintFeature(theme, kind, w, h, rng);
  // 3) framing ridge of hills along the long edges (vision + a contained arena)
  for (let q = 0; q < w; q++) {
    if (kind[0][q] !== 'water' && noiseB(q, 0) > 0.3) kind[0][q] = 'hill';
    if (kind[h - 1][q] !== 'water' && noiseB(q, h - 1) > 0.3) kind[h - 1][q] = 'hill';
  }
  // 4) a coherent road spine from the player edge to the enemy edge, wandering past the centre — gives
  //    the map intent (a route to fight over) and guarantees a passable corridor between the deploy zones.
  const roadPath: Coord[] = [];
  {
    let cq = 2, cr = h - 3;
    const tq = w - 3, tr = 2;
    let guard = 0;
    while ((cq !== tq || cr !== tr) && guard++ < w * h) {
      roadPath.push({ q: cq, r: cr });
      const dq = Math.sign(tq - cq), dr = Math.sign(tr - cr);
      // bias toward the target but wander a little for a natural curve
      if (rng() < 0.7 && dq !== 0) cq += dq; else if (dr !== 0) cr += dr; else cq += dq;
    }
    roadPath.push({ q: tq, r: tr });
    for (const c of roadPath) if (inB(c.q, c.r, w, h)) kind[c.r][c.q] = 'road';
  }

  // build tiles
  const tiles: MapTile[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const mk = TERRAIN_TILE[kind[r][q]] ?? TERRAIN_TILE.plain;
    tiles.push(mk(rng));
  }
  const tileAt = (q: number, r: number) => tiles[r * w + q];

  // 5) home corners: player deploys SW (low q, high r), enemy holds NE (high q, low r). Force those
  // clusters to clean open ground so deployment and spawns are always valid.
  const homeCells: Coord[] = [];
  const enemyCells: Coord[] = [];
  const deploymentWidth = scaleProfile?.deploymentWidth ?? 4;
  const deploymentDepth = scaleProfile?.deploymentDepth ?? 3;
  for (let r = h - 2; r >= h - 1 - deploymentDepth; r--) for (let q = 0; q < deploymentWidth; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); homeCells.push({ q, r }); }
  }
  for (let r = 1; r <= deploymentDepth; r++) for (let q = w - deploymentWidth; q < w; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); enemyCells.push({ q, r }); }
  }

  // The deploy footprint itself stays clear, but its first visible approach should immediately identify
  // the battlefield. Without this strip every scenario opened on the same empty grass corner and its
  // city/forest/coast identity remained hidden behind fog until several turns into the mission.
  const approachRng = makeRng(`${cfg.territoryId}:home-approach`);
  const approachTerrain = (): keyof typeof TERRAIN_TILE => {
    const roll = approachRng();
    switch (theme) {
      case 'urban':
      case 'industrial':
      case 'oldtown':
      case 'canal':
        return roll < 0.78 ? 'urban' : 'plain';
      case 'ruins':
        return roll < 0.28 ? 'rubble' : roll < 0.82 ? 'urban' : 'plain';
      case 'forest':
      case 'river':
        return roll < 0.68 ? 'forest' : 'plain';
      case 'alpine':
        return roll < 0.66 ? 'hill' : 'plain';
      case 'coast':
        return roll < 0.5 ? 'swamp' : roll < 0.72 ? 'forest' : 'plain';
      case 'rift':
        return roll < 0.42 ? 'swamp' : roll < 0.72 ? 'rubble' : 'plain';
      default:
        return 'plain';
    }
  };
  const approachRoadKeys = new Set(roadPath.map((coordinate) => `${coordinate.q},${coordinate.r}`));
  for (let r = Math.max(1, h - deploymentDepth - 5); r < h - 1; r++) {
    for (let q = deploymentWidth; q < Math.min(w - 1, deploymentWidth + 5); q++) {
      if (approachRoadKeys.has(`${q},${r}`)) continue;
      const terrain = approachTerrain();
      tiles[r * w + q] = TERRAIN_TILE[terrain](approachRng);
    }
  }

  const props: MapProp[] = [];
  const occupied = new Set<string>(); // tiles taken by a building footprint
  const key = (q: number, r: number) => `${q},${r}`;
  const isReserved = (q: number, r: number) =>
    (q < deploymentWidth && r > h - deploymentDepth - 2)
    || (q >= w - deploymentWidth && r < deploymentDepth + 1); // keep home corners clear of buildings
  const isRoad = new Set(roadPath.map((c) => key(c.q, c.r)));

  const placeBuilding = (q: number, r: number, bw: number, bh: number, opt: Partial<MapProp> = {}) => {
    for (let dr = 0; dr < bh; dr++) for (let dq = 0; dq < bw; dq++) {
      const cq = q + dq, cr = r + dr;
      if (!inB(cq, cr, w, h) || occupied.has(key(cq, cr)) || isReserved(cq, cr)) return false;
      if (isRoad.has(key(cq, cr))) return false;          // keep the road clear
      if (!tileAt(cq, cr).passable) return false;          // don't build on water
    }
    for (let dr = 0; dr < bh; dr++) for (let dq = 0; dq < bw; dq++) {
      const cq = q + dq, cr = r + dr;
      occupied.add(key(cq, cr));
      const t = tileAt(cq, cr);
      t.terrain = 'structure'; t.passable = false; t.cover = 3; t.movementCostModifier = 99;
      t.destructible = true; t.hp = 40;
    }
    props.push({ id: `${cfg.territoryId}-bld-${props.length}`, kind: 'proc-building', coordinate: { q, r }, w: bw, h: bh, levels: opt.levels ?? 1, roof: { kind: 'flat' }, ...opt });
    buildingCenters.push({ q: q + (bw - 1) / 2, r: r + (bh - 1) / 2 });
    return true;
  };

  // Each building is a free-standing sprite whose diorama base is ~1.2 tiles wide, so a one-empty-tile
  // gap still lets two bases overlap and look glued. Instead we enforce a minimum ON-SCREEN distance
  // between building centres. The 28/14 are the renderer's half-tile pixels (ISO_TILE_W/2, ISO_TILE_H/2);
  // MIN_SEP is just over the widest base so neighbours always show a sliver of ground between them.
  const buildingCenters: Array<{ q: number; r: number }> = [];
  const MIN_SEP = 74;
  const tooClose = (q: number, r: number, bw: number, bh: number) => {
    const cq = q + (bw - 1) / 2, cr = r + (bh - 1) / 2;
    return buildingCenters.some((a) => {
      const dx = ((cq - cr) - (a.q - a.r)) * 28;
      const dy = ((cq + cr) - (a.q + a.r)) * 14;
      return dx * dx + dy * dy < MIN_SEP * MIN_SEP;
    });
  };

  // 6) landmark near the centre (tall, multi-tile) — the visual signature of the city
  const lcq = Math.floor(w / 2) + (rng() < 0.5 ? -1 : 0);
  const lcr = Math.floor(h / 2);
  const landmarkSize = cfg.difficulty >= 4 ? { bw: 2, bh: 2, levels: 4 } : { bw: 2, bh: 2, levels: 3 };
  // Keep the landmark's PIXEL DENSITY close to a normal building (regular = 0.07) so it doesn't read as
  // a zoomed-in blowup next to the rest of the city. It still stands out by being the tallest sprite and
  // sitting on a 2x2 footprint — but only ~1.2x the scale, not the old 0.2 (~2.85x) that towered.
  placeBuilding(lcq, lcr, landmarkSize.bw, landmarkSize.bh, { levels: landmarkSize.levels, scale: 0.085, wallColor: 0x4b5563, roofColor: 0x1f2937 });

  // 7) a coherent settlement: a short row of buildings strung ALONG the road (a district/hamlet) rather
  //    than scattered boxes, plus a few satellites. Denser for built-up themes.
  const builtUp = theme === 'urban' || theme === 'oldtown' || theme === 'ruins' || theme === 'industrial' || theme === 'canal';
  const clusterCount = builtUp ? 9 : 5;
  let placed = 0;
  for (let i = 0; i < roadPath.length && placed < clusterCount; i += 2) {
    const base = roadPath[i];
    for (const side of [-1, 1]) {
      if (placed >= clusterCount) break;
      const q = base.q + side, r = base.r;
      if (rng() < (builtUp ? 0.7 : 0.4) && !tooClose(q, r, 1, 1) && placeBuilding(q, r, 1, 1, { levels: 1 + (rng() < 0.45 ? 1 : 0) })) placed++;
    }
  }

  // 7b) Fill the urban / ruined districts with real building blocks laid on a street lattice, so a
  //     "city" actually reads as one — dense blocks with streets between them — instead of a bare grey
  //     plain. Streets fall on every third row/col, which (with the road spine and the cleared home
  //     corners) keeps the two deploy zones connected; the connectivity unit test guards this.
  if (builtUp) {
    const districtTerrain = theme === 'ruins' ? 'structure' : 'urban';
    // Greedy spaced fill: drop a free-standing building wherever its one-tile ring is still clear, so
    // the district packs in densely yet every building keeps an empty alley tile around it (no glued
    // bases). The empty gaps double as the street grid; connectivity is asserted by the unit tests.
    for (let r = 1; r < h - 1; r++) for (let q = 1; q < w - 1; q++) {
      if (tileAt(q, r).terrain !== districtTerrain) continue; // only inside the district biome
      if (occupied.has(key(q, r)) || isReserved(q, r) || isRoad.has(key(q, r))) continue;
      if (tooClose(q, r, 1, 1)) continue;                    // keep a real on-screen gap to every building
      if (rng() < 0.18) continue;                            // organic courtyards / missing teeth
      const levels = theme === 'oldtown'
        ? 2 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.15 ? 1 : 0)
        : theme === 'ruins'
          ? 1
          : 1 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.12 ? 1 : 0);
      placeBuilding(q, r, 1, 1, theme === 'ruins'
        ? { levels, wallColor: 0x3b352f, roofColor: 0x23201c }
        : { levels });
    }
  }

  // 8) decorative props that FOLLOW the terrain (groves on forest, rocks on hills/rubble, bushes at
  //    forest edges) so the map reads as designed, not as random scatter.
  const isForestNear = (q: number, r: number) => {
    for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
      const t = inB(q + dq, r + dr, w, h) ? tileAt(q + dq, r + dr) : null;
      if (t && t.terrain === 'forest') return true;
    }
    return false;
  };
  const addProp = (q: number, r: number, kindProp: MapProp['kind']) => {
    occupied.add(key(q, r));
    props.push({
      id: `${cfg.territoryId}-deco-${props.length}`,
      kind: kindProp,
      coordinate: { q, r },
      u: 0.32 + rng() * 0.36, v: 0.32 + rng() * 0.36,
      scale: 0.55 + rng() * 0.5,
      ...(kindProp === 'tree' ? { texture: '/props/tree1.png' } : {})
    });
  };
  const sceneryDensity = scaleProfile?.sceneryDensity ?? 1;
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (occupied.has(key(q, r)) || isReserved(q, r) || isRoad.has(key(q, r))) continue;
    const t = tileAt(q, r);
    if (!t.passable || t.terrain === 'water') continue;
    if (t.terrain === 'forest') { if (rng() < 0.78 * sceneryDensity) addProp(q, r, 'tree'); }
    else if (t.terrain === 'hill') { if (rng() < 0.4 * sceneryDensity) addProp(q, r, 'rock'); }
    else if (t.terrain === 'structure' || t.terrain === 'swamp') { if (rng() < 0.34 * sceneryDensity) addProp(q, r, 'rock'); }
    else if (t.terrain === 'plain' && isForestNear(q, r)) {
      const x = rng();
      if (x < 0.52 * sceneryDensity) addProp(q, r, x / sceneryDensity < 0.18 ? 'tree' : 'bush');
    } else if (t.terrain === 'plain') {
      const x = rng();
      const normalized = x / sceneryDensity;
      if (x < 0.16 * sceneryDensity) {
        addProp(q, r, normalized < 0.05 ? 'tree' : normalized < 0.11 ? 'bush' : 'rock');
      }
    }
  }

  // 9) collect passable, building-free tiles for choosing zones/objectives/spawns
  const passable: Coord[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (tileAt(q, r).passable && !occupied.has(key(q, r))) passable.push({ q, r });
  }
  const free = (c: Coord) => tileAt(c.q, c.r).passable && !occupied.has(key(c.q, c.r));
  const allianceZone = homeCells.filter(free);
  const otherSideZone = enemyCells.filter(free);

  // reachable component from the alliance zone (8-neighbour BFS over passable, building-free tiles), so
  // enemies/objectives are never stranded on an isolated pocket the player can't get to.
  const reachable: Coord[] = [];
  {
    const okTile = (q: number, r: number) => inB(q, r, w, h) && tileAt(q, r).passable && !occupied.has(key(q, r));
    const seen = new Set<string>();
    const queue: Coord[] = allianceZone.length ? allianceZone.slice() : [{ q: 0, r: h - 2 }];
    queue.forEach((c) => seen.add(key(c.q, c.r)));
    while (queue.length) {
      const cur = queue.shift()!;
      reachable.push(cur);
      for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
        if (dq === 0 && dr === 0) continue;
        const nq = cur.q + dq, nr = cur.r + dr, k = key(nq, nr);
        if (!seen.has(k) && okTile(nq, nr)) { seen.add(k); queue.push({ q: nq, r: nr }); }
      }
    }
  }

  const map: BattlefieldMap = {
    id: `city-${cfg.territoryId}`,
    environment: cfg.theme,
    width: w,
    height: h,
    tiles,
    props
  };
  return { map, allianceZone, otherSideZone, roadPath, passable, reachable };
}

// --- enemy rosters: scale composition with difficulty, and finally put the four otherwise-unused
// enemy units (wolf-rider, hell-rider, skeleton-horde, arrow-tower) into play on the hard sectors. ---
const ROSTER_BY_DIFFICULTY: Record<number, string[]> = {
  1: ['orc-warband', 'ghoul-pack', 'skeleton-horde'],
  2: [
    'orc-warband', 'ghoul-pack', 'wolf-rider', 'necromancer', 'ka-orc', 'war-orc',
    'dark-elf-archers', 'dire-wolves', 'razorwing-flock', 'rift-predator', 'thorn-elf-master'
  ],
  3: [
    'ogre-brute', 'wolf-rider', 'necromancer', 'specter', 'arrow-tower', 'antitank-orc',
    'harpy-swarm', 'arachnoid', 'gloom-balloon', 'bone-ballista', 'slime-harvester'
  ],
  4: [
    'ogre-brute', 'hell-rider', 'warlock', 'salamander', 'arrow-tower', 'skeleton-horde',
    'death-knight', 'stone-golem', 'antitank-orc', 'ironroot-colossus', 'resonance-cannon',
    'veil-magus', 'gate-conjurer', 'renegade-cell'
  ],
  5: [
    'demon-engine', 'hell-rider', 'lich-lord', 'void-drake', 'warlock', 'salamander',
    'arrow-tower', 'skeleton-horde', 'specter', 'breorn-titan', 'black-angel',
    'death-knight', 'stone-golem', 'ash-mammoth', 'dread-fortress'
  ]
};

interface SignatureEventDefinition {
  messageKey: TacticalScenarioEvent['messageKey'];
  reinforcements: Array<{ id: string; definitionId: string }>;
}

const SIGNATURE_EVENTS: Partial<Record<string, SignatureEventDefinition>> = {
  'sector-berlin': {
    messageKey: 'signalEaterAwakes',
    reinforcements: [
      { id: 'signal-eater', definitionId: 'signal-eater' },
      { id: 'hush-knight', definitionId: 'death-knight' },
      { id: 'static-witch', definitionId: 'warlock' },
      { id: 'echo-rider', definitionId: 'hell-rider' }
    ]
  },
  'sector-krakow': {
    messageKey: 'glassChoirMarches',
    reinforcements: [
      { id: 'glass-regent', definitionId: 'glass-regent' },
      { id: 'choir-cantor', definitionId: 'warlock' },
      { id: 'cinder-voice', definitionId: 'salamander' },
      { id: 'mirror-guard', definitionId: 'death-knight' }
    ]
  },
  'sector-rift': {
    messageKey: 'ashCrownDescends',
    reinforcements: [
      { id: 'ash-crown', definitionId: 'ash-crown-sovereign' },
      { id: 'crown-wing', definitionId: 'black-angel' },
      { id: 'rift-harrower', definitionId: 'void-drake' },
      { id: 'ember-seer', definitionId: 'lich-lord' }
    ]
  },
  'sector-veil-heart': {
    messageKey: 'veilHeartManifests',
    reinforcements: [
      { id: 'heart-shadow', definitionId: 'black-angel' },
      { id: 'horizon-drake', definitionId: 'void-drake' },
      { id: 'memory-mammoth', definitionId: 'ash-mammoth' },
      { id: 'last-bastion', definitionId: 'dread-fortress' }
    ]
  }
};

function pickSpread(pool: Coord[], n: number, rng: () => number): Coord[] {
  // deterministic spread: shuffle a copy and take n, preferring tiles that aren't adjacent
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  const out: Coord[] = [];
  for (const c of copy) {
    if (out.length >= n) break;
    if (out.every((o) => Math.abs(o.q - c.q) + Math.abs(o.r - c.r) > 1)) out.push(c);
  }
  // fallback if spread couldn't fill: add remaining UNIQUE tiles (never re-select, or two enemies share
  // a coordinate and createBattleState throws on the collision — battle never starts).
  for (const c of copy) {
    if (out.length >= n) break;
    if (!out.some((o) => o.q === c.q && o.r === c.r)) out.push(c);
  }
  return out.slice(0, n);
}

function pickPatrolLine(
  cfg: CityConfig,
  pool: Coord[],
  n: number,
  occupied: Set<string>,
  rng: () => number
): Coord[] {
  if (!cfg.scaleBand) return pickSpread(pool, n, rng);
  const profile = TACTICAL_MAP_SCALE_BANDS[cfg.scaleBand];
  const candidates = pool
    .filter((coordinate) => !occupied.has(`${coordinate.q},${coordinate.r}`))
    .map((coordinate) => ({ coordinate, tieBreak: rng() }));
  const progress = (coordinate: Coord) => (
    coordinate.q / Math.max(1, cfg.width - 1)
    + 1 - coordinate.r / Math.max(1, cfg.height - 1)
  ) / 2;
  const selected: Coord[] = [];

  for (let index = 0; index < n; index += 1) {
    const patrolIndex = Math.min(
      profile.patrolProgress.length - 1,
      Math.floor(index * profile.patrolProgress.length / n)
    );
    const targetProgress = profile.patrolProgress[patrolIndex];
    const candidate = candidates
      .filter(({ coordinate }) => !selected.some((chosen) => (
        Math.max(
          Math.abs(chosen.q - coordinate.q),
          Math.abs(chosen.r - coordinate.r)
        ) <= 1
      )))
      .sort((left, right) => (
        Math.abs(progress(left.coordinate) - targetProgress)
        - Math.abs(progress(right.coordinate) - targetProgress)
        || left.tieBreak - right.tieBreak
      ))[0];
    if (!candidate) break;
    selected.push(candidate.coordinate);
    candidates.splice(candidates.indexOf(candidate), 1);
  }

  if (selected.length < n) {
    const fallback = pickSpread(
      pool.filter((coordinate) => (
        !occupied.has(`${coordinate.q},${coordinate.r}`)
        && !selected.some((chosen) => chosen.q === coordinate.q && chosen.r === coordinate.r)
      )),
      n - selected.length,
      rng
    );
    selected.push(...fallback);
  }
  return selected.slice(0, n);
}

interface MissionDefinition {
  objectives: TacticalObjective[];
  allianceForces?: ScenarioUnit[];
  weather?: 'clear' | 'night' | 'fog';
}

interface AuthoredReserveEvent {
  messageKey: TacticalScenarioEvent['messageKey'];
  effects: TacticalScenarioEventEffect[];
}

function specialistStaging(g: Generated, cfg: CityConfig, lane = 0): Coord {
  const startZone = new Set(g.allianceZone.map((coordinate) => `${coordinate.q},${coordinate.r}`));
  const target = {
    q: cfg.width * (0.2 + lane * 0.04),
    r: cfg.height * (0.7 - lane * 0.05)
  };
  return g.reachable
    .filter((coordinate) => !startZone.has(`${coordinate.q},${coordinate.r}`))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.q - target.q) + Math.abs(left.r - target.r);
      const rightDistance = Math.abs(right.q - target.q) + Math.abs(right.r - target.r);
      return leftDistance - rightDistance || left.r - right.r || left.q - right.q;
    })[0] ?? g.allianceZone[0] ?? { q: 1, r: cfg.height - 2 };
}

function buildMission(cfg: CityConfig, g: Generated, rng: () => number): MissionDefinition {
  const id = cfg.territoryId;
  const scaleProfile = cfg.scaleBand ? TACTICAL_MAP_SCALE_BANDS[cfg.scaleBand] : undefined;
  // objective anchor: a REACHABLE tile deep in enemy territory (top-right region)
  const deep = g.reachable.filter((c) => c.r <= cfg.height * 0.4 && c.q >= cfg.width * 0.45);
  const evacuationDestination = cfg.gameplay === 'evac' && scaleProfile
    ? nearestCoordinates(
        g.reachable.filter((coordinate) => (
          g.map.tiles[coordinate.r * cfg.width + coordinate.q].cover >= 2
        )),
        { q: cfg.width * 0.77, r: cfg.height * 0.81 },
        1
      )[0]
    : undefined;
  if (evacuationDestination) {
    const evacuationClearing = new Set<string>();
    for (let r = evacuationDestination.r - 1; r <= evacuationDestination.r + 1; r += 1) {
      for (let q = evacuationDestination.q - 1; q <= evacuationDestination.q + 1; q += 1) {
        evacuationClearing.add(`${q},${r}`);
      }
    }
    for (let offset = 2; offset <= 6; offset += 1) {
      evacuationClearing.add(`${evacuationDestination.q - offset},${evacuationDestination.r - offset}`);
      evacuationClearing.add(`${evacuationDestination.q - offset + 1},${evacuationDestination.r - offset}`);
    }
    for (const key of evacuationClearing) {
      const [q, r] = key.split(',').map(Number);
      if (!inB(q, r, cfg.width, cfg.height)) continue;
      const index = r * cfg.width + q;
      g.map.tiles[index] = {
        ...g.map.tiles[index],
        terrain: 'road',
        cover: q === evacuationDestination.q && r === evacuationDestination.r ? 2 : 1,
        movementCostModifier: 0.8,
        passable: true,
        blocksVision: false,
        destructible: false
      };
    }
    g.map.props = g.map.props?.filter((prop) => (
      (prop.tiles?.length ? prop.tiles : [prop.coordinate]).every((coordinate) => (
        !evacuationClearing.has(`${coordinate.q},${coordinate.r}`)
      ))
    ));
  }
  const routeDestination = evacuationDestination
    ?? (
      (cfg.gameplay === 'convoy' || cfg.gameplay === 'bridgehead')
      && scaleProfile
        ? g.roadPath[Math.floor(g.roadPath.length * 0.86)]
        : undefined
    );
  const anchor = routeDestination
    ?? (deep.length ? pickSpread(deep, 1, rng)[0] : g.otherSideZone[0])
    ?? { q: cfg.width - 2, r: 1 };
  // hold tile: the reachable tile nearest map centre (the centre itself is the impassable landmark).
  const cx = cfg.width / 2, cy = cfg.height / 2;
  const hold = g.reachable.slice().sort((a, b) =>
    (Math.abs(a.q - cx) + Math.abs(a.r - cy)) - (Math.abs(b.q - cx) + Math.abs(b.r - cy))
  )[0] ?? { q: Math.floor(cx), r: Math.floor(cy) };
  if (id === 'sector-mnemonic-orchard' && scaleProfile) {
    const latticeClearing = new Set<string>();
    for (let r = hold.r - 1; r <= hold.r + 1; r += 1) {
      for (let q = hold.q - 1; q <= hold.q + 1; q += 1) {
        if (inB(q, r, cfg.width, cfg.height)) latticeClearing.add(`${q},${r}`);
      }
    }
    for (const key of latticeClearing) {
      const [q, r] = key.split(',').map(Number);
      const index = r * cfg.width + q;
      g.map.tiles[index] = {
        ...g.map.tiles[index],
        terrain: 'plain',
        cover: q === hold.q && r === hold.r ? 2 : 1,
        movementCostModifier: 1,
        passable: true,
        providesVisionBoost: false,
        blocksVision: false,
        destructible: false
      };
    }
    g.map.props = g.map.props?.filter((prop) => (
      (prop.tiles?.length ? prop.tiles : [prop.coordinate]).every((coordinate) => (
        !latticeClearing.has(`${coordinate.q},${coordinate.r}`)
      ))
    ));
  }
  const objs: TacticalObjective[] = [];
  let allianceForces: ScenarioUnit[] | undefined;
  switch (cfg.gameplay) {
    case 'evac':
      objs.push({
        id: `${id}-reach`,
        kind: 'reach',
        description: 'Escort Captain Alexander to the extraction flare.',
        target: anchor,
        unitIds: ['captain']
      });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Do not lose Captain Alexander.', unitIds: ['captain'] });
      break;
    case 'rescue': {
      const rescueId = `${id}-pilot`;
      const rescuePool = g.reachable.filter((c) => (
        c.q >= cfg.width * 0.32 && c.q <= cfg.width * 0.62
        && c.r >= cfg.height * 0.3 && c.r <= cfg.height * 0.7
      ));
      const authoredRescueTarget = id === 'sector-brussels' && scaleProfile
        ? { q: cfg.width * 0.5, r: cfg.height * 0.56 }
        : id === 'sector-lantern-vault' && scaleProfile
          ? { q: cfg.width * 0.4, r: cfg.height * 0.6 }
          : undefined;
      const authoredRescueTile = authoredRescueTarget
        ? nearestCoordinates(rescuePool, authoredRescueTarget, 1)[0]
        : undefined;
      const rescueTile = authoredRescueTile
        ?? (rescuePool.length ? pickSpread(rescuePool, 1, rng)[0] : hold)
        ?? hold;
      const extract = g.allianceZone[0] ?? { q: 1, r: cfg.height - 2 };
      allianceForces = [{ id: rescueId, definitionId: 'rangers', coordinate: rescueTile, isKey: true }];
      objs.push({
        id: `${id}-reach`,
        kind: 'reach',
        description: 'Bring the isolated reconnaissance team back to the extraction zone.',
        target: extract,
        unitIds: [rescueId]
      });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Keep the reconnaissance team alive.', unitIds: [rescueId] });
      break;
    }
    case 'hold':
      objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the central strongpoint for 3 rounds.', target: hold, turnLimit: 3 });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Keep Captain Alexander alive.', unitIds: ['captain'] });
      break;
    case 'bridgehead':
      objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Destroy or rout the defenders.' });
      // No hard turn limit on the far objective: a timed reach across the enlarged maps defeated the
      // player even while they were winning by elimination (army intact, foes nearly cleared, lost on
      // the deadline). Win by reaching the charge point OR routing the defenders — reach is the fast lane.
      objs.push({
        id: `${id}-reach`,
        kind: 'interact',
        description: 'Plant charges at the far objective.',
        target: anchor,
        actionKey: 'plantCharges',
        actionPoints: 2
      });
      break;
    case 'convoy': {
      const convoyId = `${id}-convoy`;
      const allianceZoneKeys = new Set(g.allianceZone.map((c) => `${c.q},${c.r}`));
      const stagingPool = g.reachable.filter((c) => (
        c.q <= cfg.width * 0.3 && c.r >= cfg.height * 0.52
        && !allianceZoneKeys.has(`${c.q},${c.r}`)
      ));
      const convoyRouteStaging = scaleProfile
        ? g.roadPath.find((coordinate, index) => (
            index >= Math.floor(g.roadPath.length * 0.08)
            && !allianceZoneKeys.has(`${coordinate.q},${coordinate.r}`)
          ))
        : undefined;
      const staging = convoyRouteStaging
        ?? (stagingPool.length ? pickSpread(stagingPool, 1, rng)[0] : hold)
        ?? hold;
      allianceForces = [{ id: convoyId, definitionId: 'supply-truck', coordinate: staging, isKey: true }];
      objs.push({
        id: `${id}-reach`,
        kind: 'reach',
        description: 'Escort the supply convoy to the forward delivery zone.',
        target: anchor,
        unitIds: [convoyId],
        ...(scaleProfile ? { turnLimit: scaleProfile.travelDeadlineRound } : {})
      });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Keep the convoy operational.', unitIds: [convoyId] });
      if (id === 'sector-ashen-confluence') {
        objs.push({
          id: `${id}-align-beacon`,
          kind: 'interact',
          description: 'Align the echo beacon to guide Alliance fire support through the fault.',
          target: hold,
          optional: true,
          actionKey: 'alignEchoBeacon',
          actionPoints: 3
        });
      }
      break;
    }
    case 'raid-night':
      objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Silence the enemy coven leaders.' });
      objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Secure the relay for 3 rounds.', target: hold, turnLimit: 3 });
      break;
    case 'spire':
      if (id === 'sector-berlin') {
        objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Silence the relay guard feeding the Signal-Eater.' });
        objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the dead-frequency transmitter for 3 rounds.', target: hold, turnLimit: 3 });
      } else if (id === 'sector-krakow') {
        objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Shatter the resonant guardians of the Glass Choir.' });
        objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the silent courtyard for 3 rounds.', target: hold, turnLimit: 3 });
      } else if (id === 'sector-rift') {
        objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Bring down the wardens of the Ash Crown.' });
        objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Anchor the seal inside the burning scar for 3 rounds.', target: hold, turnLimit: 3 });
        objs.push({
          id: `${id}-disrupt-ward`,
          kind: 'interact',
          description: 'Disrupt the outer ward to open a reserve corridor.',
          target: anchor,
          optional: true,
          actionKey: 'disruptWard',
          actionPoints: 2
        });
      } else {
        objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Destroy the ritual guardians.' });
        objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the spire grounds for 3 rounds.', target: hold, turnLimit: 3 });
      }
      break;
  }

  if (id === 'sector-lantern-vault') {
    const specialistId = `${id}-pilot`;
    objs.push({
      id: `${id}-calibrate-prism`,
      kind: 'interact',
      description: 'Calibrate the recovered survey prism against the living archive.',
      target: hold,
      unitIds: [specialistId],
      essential: true,
      deadlineRound: cfg.specialistDeadlineRound ?? 7,
      actionKey: 'calibratePrism',
      actionPoints: 2
    });
  }

  if (id === 'sector-sable-causeway') {
    const specialistId = `${id}-wardbreaker`;
    const objective = objs.find((candidate) => candidate.id === `${id}-reach`);
    if (!objective) throw new Error(`missing sabotage objective for ${id}`);
    objective.unitIds = [specialistId];
    objective.essential = true;
    objective.deadlineRound = cfg.specialistDeadlineRound ?? 10;
    allianceForces = [
      ...(allianceForces ?? []),
      {
        id: specialistId,
        definitionId: 'commando-team',
        coordinate: specialistStaging(g, cfg),
        isKey: true
      }
    ];
    objs.push({
      id: `${id}-protect-wardbreaker`,
      kind: 'protect',
      description: 'Keep the wardbreaker team alive.',
      unitIds: [specialistId]
    });
  }

  if (id === 'sector-mnemonic-orchard') {
    const specialistId = `${id}-psi-specialist`;
    allianceForces = [
      ...(allianceForces ?? []),
      {
        id: specialistId,
        definitionId: 'psi-corps',
        coordinate: specialistStaging(g, cfg, 1),
        isKey: true
      }
    ];
    objs.push({
      id: `${id}-ground-lattice`,
      kind: 'interact',
      description: 'Ground the root-memory lattice before it fixes the strike force in place.',
      target: hold,
      unitIds: [specialistId],
      essential: true,
      deadlineRound: 9,
      actionKey: 'groundMemoryLattice',
      actionPoints: 3
    });
    objs.push({
      id: `${id}-protect-psi-specialist`,
      kind: 'protect',
      description: 'Keep the PSI grounding team alive.',
      unitIds: [specialistId]
    });
  }

  return { objectives: objs, allianceForces, weather: cfg.weather };
}

function nearestCoordinates(candidates: Coord[], target: Coord, count: number) {
  return candidates.slice().sort((left, right) => {
    const leftDistance = Math.abs(left.q - target.q) + Math.abs(left.r - target.r);
    const rightDistance = Math.abs(right.q - target.q) + Math.abs(right.r - target.r);
    return leftDistance - rightDistance || left.r - right.r || left.q - right.q;
  }).slice(0, count);
}

function openedTerrainTile(tile: MapTile): MapTile {
  return {
    terrain: 'road',
    elevation: tile.elevation,
    cover: 1,
    movementCostModifier: 0.8,
    passable: true,
    providesVisionBoost: false,
    blocksVision: false,
    destructible: false
  };
}

function terrainOpening(
  g: Generated,
  target: Coord,
  count: number
): NonNullable<TacticalScenarioEvent['effects']>[number] & { kind: 'transformTerrain' } {
  const propTiles = new Set((g.map.props ?? []).flatMap((prop) => (
    prop.tiles?.length ? prop.tiles : [prop.coordinate]
  )).map((coordinate) => `${coordinate.q},${coordinate.r}`));
  const reachableKeys = new Set(g.reachable.map((coordinate) => `${coordinate.q},${coordinate.r}`));
  const candidates: Coord[] = [];
  for (let r = 0; r < g.map.height; r += 1) {
    for (let q = 0; q < g.map.width; q += 1) {
      const tile = g.map.tiles[r * g.map.width + q];
      if (!tile || propTiles.has(`${q},${r}`)) continue;
      const touchesReachable = [
        `${q - 1},${r}`, `${q + 1},${r}`, `${q},${r - 1}`, `${q},${r + 1}`,
        `${q - 1},${r - 1}`, `${q + 1},${r + 1}`
      ].some((candidate) => reachableKeys.has(candidate));
      if (tile.terrain === 'structure' && !tile.passable && touchesReachable) candidates.push({ q, r });
    }
  }
  const fallback = g.reachable.filter((coordinate) => {
    const tile = g.map.tiles[coordinate.r * g.map.width + coordinate.q];
    return tile?.blocksVision && !propTiles.has(`${coordinate.q},${coordinate.r}`);
  });
  const coordinates = nearestCoordinates(candidates.length ? candidates : fallback, target, count);
  return {
    kind: 'transformTerrain',
    tiles: coordinates.map((coordinate) => ({
      coordinate,
      tile: openedTerrainTile(g.map.tiles[coordinate.r * g.map.width + coordinate.q])
    }))
  };
}

function authoredReserveEvent(
  cfg: CityConfig,
  g: Generated,
  mission: MissionDefinition,
  occupied: Set<string>
): AuthoredReserveEvent | undefined {
  const target = mission.objectives.find((objective) => objective.target)?.target
    ?? { q: Math.floor(cfg.width / 2), r: Math.floor(cfg.height / 2) };
  if (cfg.territoryId === 'sector-lantern-vault') {
    const chartTarget = nearestCoordinates(g.reachable.filter((coordinate) => (
      !occupied.has(`${coordinate.q},${coordinate.r}`)
      && coordinate.q >= cfg.width * 0.45
      && coordinate.r <= cfg.height * 0.52
    )), { q: cfg.width * 0.58, r: cfg.height * 0.34 }, 1)[0] ?? target;
    return {
      messageKey: 'lanternArchiveRevealed',
      effects: [{
        kind: 'revealObjective',
        objective: {
          id: `${cfg.territoryId}-chart-cache`,
          kind: 'reach',
          description: 'Recover the survey team’s prism charts from the newly opened archive.',
          target: chartTarget,
          optional: true
        }
      }]
    };
  }
  if (cfg.territoryId === 'sector-mnemonic-orchard') {
    const pulseCoordinates = nearestCoordinates(g.reachable, target, 6);
    return {
      messageKey: 'orchardMemoryPulse',
      effects: [{
        kind: 'pressurePulse',
        coordinates: pulseCoordinates,
        targetFaction: 'alliance',
        healthDamage: 12,
        moraleDamage: 18
      }]
    };
  }
  if (cfg.territoryId === 'sector-thorn-engine') {
    const opening = terrainOpening(g, target, 2);
    const regulatorTarget = opening.tiles[0]?.coordinate
      ?? nearestCoordinates(g.reachable, target, 1)[0]
      ?? target;
    return {
      messageKey: 'thornRegulatorOpens',
      effects: [
        opening,
        {
          kind: 'revealObjective',
          objective: {
            id: `${cfg.territoryId}-stabilize-regulator`,
            kind: 'reach',
            description: 'Secure the exposed regulator before the next contraction.',
            target: regulatorTarget,
            optional: true
          }
        }
      ]
    };
  }
  return undefined;
}

function buildEvents(
  cfg: CityConfig,
  g: Generated,
  roster: string[],
  otherSideForces: ScenarioUnit[],
  allianceForces: ScenarioUnit[] | undefined,
  mission: MissionDefinition,
  rng: () => number
): TacticalScenarioEvent[] {
  const occupied = new Set(
    [...otherSideForces, ...(allianceForces ?? [])].map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`)
  );
  const protectedReserveStarts = cfg.gameplay === 'evac'
    ? [
        ...g.allianceZone,
        ...mission.objectives.flatMap((objective) => objective.target ? [objective.target] : [])
      ]
    : [];
  const edgePool = [
    ...g.otherSideZone,
    ...g.reachable.filter((c) => c.q >= cfg.width * 0.68 || c.r <= cfg.height * 0.24)
  ].filter((c, index, all) => (
    !occupied.has(`${c.q},${c.r}`)
    && protectedReserveStarts.every((start) => (
      Math.max(Math.abs(start.q - c.q), Math.abs(start.r - c.r)) > 10
    ))
    && all.findIndex((candidate) => candidate.q === c.q && candidate.r === c.r) === index
  ));
  const signature = SIGNATURE_EVENTS[cfg.territoryId];
  const reservePool = edgePool.length
    ? edgePool
    : g.reachable.filter((coordinate) => (
        protectedReserveStarts.every((start) => (
          Math.max(
            Math.abs(start.q - coordinate.q),
            Math.abs(start.r - coordinate.r)
          ) > 10
        ))
      ));
  const spots = pickSpread(reservePool, 4 + (signature?.reinforcements.length ?? 0), rng);
  const reserveSpots = spots.slice(0, 4);
  const reserveOffset = Math.ceil(roster.length / 2);
  const reinforcements: ScenarioUnit[] = reserveSpots.map((coordinate, index) => ({
    id: `${cfg.territoryId}-reserve-${index}`,
    definitionId: roster[(reserveOffset + index) % roster.length],
    coordinate
  }));
  if (cfg.territoryId === 'sector-berlin' && reinforcements[1]) {
    // The generated rotation puts hell-rider here. Winged-fiend is comparable and must stay inside
    // Commander's two-unit window; hell-rider remains in Berlin's initial/signature forces and four other sectors.
    reinforcements[1].definitionId = 'winged-fiend';
  }
  const messageByGameplay: Record<GameplayType, TacticalScenarioEvent['messageKey']> = {
    evac: 'evacPursuit',
    rescue: 'rescueHunters',
    hold: 'holdAssault',
    bridgehead: 'bridgeReserves',
    convoy: 'convoyIntercept',
    'raid-night': 'nightAmbush',
    spire: 'portalSurge'
  };
  const roundByGameplay: Record<GameplayType, number> = {
    evac: 3,
    rescue: 3,
    hold: 3,
    bridgehead: 4,
    convoy: 3,
    'raid-night': 2,
    spire: 3
  };
  const reserveRound = cfg.scaleBand
    ? TACTICAL_MAP_SCALE_BANDS[cfg.scaleBand].reserveRound
    : roundByGameplay[cfg.gameplay];
  const authoredReserve = authoredReserveEvent(cfg, g, mission, occupied);
  const reserveEvent: TacticalScenarioEvent = {
    id: `${cfg.territoryId}-reserve-wave`,
    triggerRound: reserveRound,
    triggerEnemyRemaining: Math.max(1, Math.floor(otherSideForces.length / 3)),
    messageKey: authoredReserve?.messageKey ?? messageByGameplay[cfg.gameplay],
    faction: 'otherSide',
    reinforcements,
    effects: authoredReserve?.effects
  };
  const sabotageEvent: TacticalScenarioEvent | undefined = cfg.territoryId === 'sector-sable-causeway'
    ? {
        id: `${cfg.territoryId}-ward-collapse`,
        triggerObjectiveId: `${cfg.territoryId}-reach`,
        messageKey: 'causewayWardBreaks',
        faction: 'alliance',
        reinforcements: [],
        effects: [terrainOpening(g, mission.objectives.find((objective) => (
          objective.id === `${cfg.territoryId}-reach`
        ))?.target ?? g.reachable[0], 3)]
      }
    : undefined;
  const confluenceReward: TacticalScenarioEvent | undefined = cfg.territoryId === 'sector-ashen-confluence'
    ? {
        id: `${cfg.territoryId}-echo-battery`,
        triggerObjectiveId: `${cfg.territoryId}-align-beacon`,
        messageKey: 'echoBatteryArrives',
        faction: 'alliance',
        reinforcements: [{
          id: `${cfg.territoryId}-thunderhead`,
          definitionId: 'thunderhead-155',
          coordinate: g.allianceZone[0] ?? g.reachable[0]
        }]
      }
    : undefined;
  const primaryEvents = [
    reserveEvent,
    ...(sabotageEvent ? [sabotageEvent] : []),
    ...(confluenceReward ? [confluenceReward] : [])
  ];
  if (!signature) return primaryEvents;

  const signatureReinforcements = signature.reinforcements.map((reinforcement, index) => ({
    id: `${cfg.territoryId}-${reinforcement.id}`,
    definitionId: reinforcement.definitionId,
    coordinate: spots[4 + index]
  }));
  const signatureEvent: TacticalScenarioEvent = {
    id: `${cfg.territoryId}-signature-wave`,
    triggerRound: reserveRound + 2,
    triggerEnemyRemaining: 0,
    triggerAfterEventId: reserveEvent.id,
    messageKey: signature.messageKey,
    faction: 'otherSide',
    reinforcements: signatureReinforcements
  };
  if (cfg.territoryId !== 'sector-rift') return [...primaryEvents, signatureEvent];

  return [...primaryEvents, signatureEvent, {
    id: `${cfg.territoryId}-ward-corridor-reserve`,
    triggerObjectiveId: `${cfg.territoryId}-disrupt-ward`,
    messageKey: 'wardBeaconSecured',
    faction: 'alliance',
    reinforcements: [{
      id: `${cfg.territoryId}-ward-rangers`,
      definitionId: 'rangers',
      coordinate: g.allianceZone[0] ?? g.reachable[0]
    }]
  }];
}

function buildScenario(cfg: CityConfig): TacticalScenario {
  const rng = makeRng(`${cfg.territoryId}:forces`);
  const g = generate(cfg);
  const mission = buildMission(cfg, g, rng);

  // enemies: count scales with difficulty (the starter army of 6 stomped the old 3-4), placed spread
  // across the REACHABLE enemy half so the player can engage every one (no forced timeouts). Units cycle
  // through the roster so a count above the roster size still fields varied foes.
  const tierRoster = ROSTER_BY_DIFFICULTY[cfg.difficulty] ?? ROSTER_BY_DIFFICULTY[3];
  // Each city starts at a deterministic point in its tier roster. Without rotation, every city
  // deployed only the first handful of definitions and the back half existed in data but never
  // appeared on a battlefield.
  const rosterOffset = cfg.rosterOffset
    ?? Array.from(cfg.territoryId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % tierRoster.length;
  const roster = tierRoster.map((_, index) => tierRoster[(index + rosterOffset) % tierRoster.length]);
  // scale with both difficulty and map area so the enlarged battlefields don't feel empty (diff1 ~7 … diff5 ~13)
  // Cap the area term so big Rift maps no longer stack both a swarm of bodies AND the heavies on top.
  const scaleProfile = cfg.scaleBand ? TACTICAL_MAP_SCALE_BANDS[cfg.scaleBand] : undefined;
  const defaultEnemyCount = 3
    + cfg.difficulty
    + Math.min(3, Math.floor((cfg.width * cfg.height) / 320));
  const enemyCount = scaleProfile
    ? Math.ceil((cfg.width * cfg.height) / scaleProfile.maxCellsPerEnemy)
    : defaultEnemyCount;
  const alliedCoordinates = new Set((mission.allianceForces ?? []).map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`));
  const enemyArea = g.reachable.filter((c) => c.r <= cfg.height * 0.6 && !alliedCoordinates.has(`${c.q},${c.r}`));
  const fallbackEnemyArea = g.reachable.filter((c) => !alliedCoordinates.has(`${c.q},${c.r}`));
  const protectedStart = [
    ...(
      cfg.gameplay === 'bridgehead'
      || cfg.gameplay === 'hold'
      || cfg.gameplay === 'raid-night'
      || cfg.gameplay === 'spire'
      || cfg.gameplay === 'rescue'
      || cfg.gameplay === 'evac'
        ? g.allianceZone
        : []
    ),
    ...(mission.allianceForces ?? []).map((unit) => unit.coordinate),
    ...(cfg.gameplay === 'evac'
      ? mission.objectives.flatMap((objective) => objective.target ? [objective.target] : [])
      : [])
  ];
  const protectedStartDistance = cfg.gameplay === 'evac' ? 10 : 6;
  const patrolArea = scaleProfile
    ? fallbackEnemyArea.filter((coordinate) => (
        protectedStart.every((start) => (
          Math.max(
            Math.abs(start.q - coordinate.q),
            Math.abs(start.r - coordinate.r)
          ) > protectedStartDistance
        ))
      ))
    : [];
  const pool = patrolArea.length >= enemyCount
    ? patrolArea
    : enemyArea.length >= enemyCount ? enemyArea : fallbackEnemyArea;
  const spots = scaleProfile
    ? pickPatrolLine(cfg, pool, enemyCount, alliedCoordinates, rng)
    : pickSpread(pool, enemyCount, rng);
  const otherSideForces: ScenarioUnit[] = spots.map((c, i) => ({
    id: `${cfg.territoryId}-foe-${i}`,
    definitionId: roster[i % roster.length],
    coordinate: c
  }));

  const events = buildEvents(cfg, g, roster, otherSideForces, mission.allianceForces, mission, rng);

  return {
    id: `city-${cfg.territoryId}`,
    name: cfg.name,
    brief: cfg.brief,
    weather: mission.weather,
    map: g.map,
    startZones: { alliance: g.allianceZone, otherSide: g.otherSideZone },
    allianceForces: mission.allianceForces,
    otherSideForces,
    objectives: mission.objectives,
    events
  };
}

// Each sector has a distinct theme, size, weather and mission profile tuned to its role.
const CITY_CONFIGS: CityConfig[] = [
  { territoryId: 'sector-paris', name: 'Paris Outskirts', brief: 'Cover the civilian evacuation and reach the extraction flare before the perimeter collapses.', theme: 'urban', gameplay: 'evac', width: 30, height: 54, weather: 'clear', difficulty: 1, scaleBand: 'early' },
  { territoryId: 'sector-lyon', name: 'Lyon Industrial Zone', brief: 'Hold the factory strongpoint against the demonic raid on the arms works.', theme: 'industrial', gameplay: 'hold', width: 30, height: 54, weather: 'clear', difficulty: 1, scaleBand: 'early' },
  { territoryId: 'sector-strasbourg', name: 'Strasbourg Crossing', brief: 'Force the Rhine: rout the bridge guard or plant charges before the assault window closes.', theme: 'river', gameplay: 'bridgehead', width: 30, height: 54, weather: 'clear', difficulty: 2, scaleBand: 'early' },
  { territoryId: 'sector-munich', name: 'Munich Defensive Line', brief: 'Raid the forward line under cover of darkness and silence the enemy sorcery.', theme: 'forest', gameplay: 'raid-night', width: 30, height: 54, weather: 'night', difficulty: 2, scaleBand: 'early' },
  { territoryId: 'sector-zurich', name: 'Alpine Fortress', brief: 'Hold the mountain pass strongpoint while the bunkers are cleared.', theme: 'alpine', gameplay: 'hold', width: 30, height: 54, weather: 'clear', difficulty: 2, scaleBand: 'early' },
  { territoryId: 'sector-vienna', name: 'Vienna Siege', brief: 'Break the siege of the old city: rout the besiegers and breach to the inner ring.', theme: 'oldtown', gameplay: 'bridgehead', width: 30, height: 54, weather: 'clear', difficulty: 3, scaleBand: 'early' },
  { territoryId: 'sector-brussels', name: 'Brussels Command', brief: 'Reach the isolated reconnaissance team and bring it back before the headquarters perimeter falls.', theme: 'urban', gameplay: 'rescue', width: 30, height: 54, weather: 'clear', difficulty: 1, scaleBand: 'early' },
  { territoryId: 'sector-amsterdam', name: 'Amsterdam Harbor', brief: 'Escort a supply convoy through the fog-bound canals to the forward quay.', theme: 'canal', gameplay: 'convoy', width: 30, height: 54, weather: 'fog', difficulty: 2, scaleBand: 'early' },
  { territoryId: 'sector-copenhagen', name: 'Copenhagen Strait', brief: 'Hold the coastal strongpoint and deny the Baltic flanking approach.', theme: 'coast', gameplay: 'hold', width: 30, height: 54, weather: 'clear', difficulty: 2, scaleBand: 'early' },
  { territoryId: 'sector-prague', name: 'Prague Old Town', brief: 'Raid the old-town warren by night and disrupt the dark ritual.', theme: 'oldtown', gameplay: 'raid-night', width: 30, height: 54, weather: 'night', difficulty: 3, scaleBand: 'early' },
  { territoryId: 'sector-berlin', name: 'Dead Air Protocol', brief: 'Trace a phantom distress network through the ruins and silence the presence speaking through every abandoned radio.', theme: 'ruins', gameplay: 'spire', width: 40, height: 54, weather: 'fog', difficulty: 4, scaleBand: 'mid' },
  { territoryId: 'sector-warsaw', name: 'Warsaw Front', brief: 'Break the eastern line through the rubble and seize the far strongpoint.', theme: 'ruins', gameplay: 'bridgehead', width: 40, height: 54, weather: 'clear', difficulty: 4, scaleBand: 'mid' },
  { territoryId: 'sector-krakow', name: 'The Glass Choir', brief: 'Enter the mirrored citadel, break its resonant ward, and hold the courtyard when the silent choir answers.', theme: 'oldtown', gameplay: 'spire', width: 40, height: 54, weather: 'fog', difficulty: 4, scaleBand: 'mid' },
  { territoryId: 'sector-kyiv', name: 'Kyiv Siege', brief: 'Night raid through the ruined metropolis to silence the coven and hold the relay.', theme: 'ruins', gameplay: 'raid-night', width: 40, height: 54, weather: 'night', difficulty: 5, scaleBand: 'mid' },
  { territoryId: 'sector-carpathian', name: 'Carpathian Pass', brief: 'Hold the high pass strongpoint and clear the patrol-ridden ridges.', theme: 'alpine', gameplay: 'hold', width: 40, height: 54, weather: 'clear', difficulty: 4, scaleBand: 'mid' },
  { territoryId: 'sector-blacksea', name: 'Black Sea Coast', brief: 'Push along the foggy coast, rout the shore-spawn and seize the far cape.', theme: 'coast', gameplay: 'bridgehead', width: 40, height: 54, weather: 'fog', difficulty: 4, scaleBand: 'mid' },
  { territoryId: 'sector-rift', name: 'Operation Ash Crown', brief: 'Cross the burning scar, anchor the seal, and survive the self-crowned warden that rises from its final breach.', theme: 'rift', gameplay: 'spire', width: 40, height: 54, weather: 'fog', difficulty: 5, scaleBand: 'mid' },
  { territoryId: 'sector-cinder-gate', name: 'Cinder Gate', brief: 'Cross the unstable passage, break the heat-scarred pylon ring, and anchor the first Shatterline foothold.', theme: 'rift', gameplay: 'spire', width: 40, height: 54, weather: 'fog', difficulty: 5, rosterOffset: 11, scaleBand: 'mid' },
  { territoryId: 'sector-lantern-vault', name: 'Lantern Vault', brief: 'Reach the trapped survey team and escort its star charts out through the collapsing observatory galleries.', theme: 'ruins', gameplay: 'rescue', width: 40, height: 54, weather: 'clear', difficulty: 5, rosterOffset: 12, scaleBand: 'mid', specialistDeadlineRound: 7 },
  { territoryId: 'sector-hollow-tide', name: 'Hollow Tide', brief: 'Raid the black shoreline, silence the tide-callers, and hold the stranded vanguard beacon through the mist.', theme: 'coast', gameplay: 'raid-night', width: 40, height: 54, weather: 'night', difficulty: 5, rosterOffset: 13, scaleBand: 'mid' },
  { territoryId: 'sector-ashen-confluence', name: 'Ashen Confluence', brief: 'Escort the survey convoy across the joined fault line and align the echo beacon for optional fire support.', theme: 'rift', gameplay: 'convoy', width: 40, height: 54, weather: 'fog', difficulty: 5, rosterOffset: 11, scaleBand: 'mid' },
  { territoryId: 'sector-sable-causeway', name: 'Sable Causeway', brief: 'Break the causeway guard, arm the ward towers, and keep the northern road from folding into the sea.', theme: 'coast', gameplay: 'bridgehead', width: 60, height: 70, weather: 'clear', difficulty: 5, rosterOffset: 12, scaleBand: 'late', specialistDeadlineRound: 14 },
  { territoryId: 'sector-mnemonic-orchard', name: 'Mnemonic Orchard', brief: 'Raid the echoing forest by night, silence the signal mimics, and hold the root relay through their answer.', theme: 'forest', gameplay: 'raid-night', width: 40, height: 54, weather: 'night', difficulty: 5, rosterOffset: 13, scaleBand: 'mid' },
  { territoryId: 'sector-thorn-engine', name: 'Thorn Engine', brief: 'Hold the regulator control ring while the field teams reverse the contraction pulling both fronts together.', theme: 'industrial', gameplay: 'hold', width: 60, height: 70, weather: 'fog', difficulty: 5, rosterOffset: 11, scaleBand: 'lateHold' },
  { territoryId: 'sector-veil-heart', name: 'Veil Heart', brief: 'Enter the buried core, break its ritual guard, and survive the last horizon taking form around the heart.', theme: 'rift', gameplay: 'spire', width: 40, height: 54, weather: 'fog', difficulty: 5, rosterOffset: 12, scaleBand: 'mid' },
  { territoryId: 'sector-quiet-meridian', name: 'Quiet Meridian', brief: 'Reach the stranded survey team and guide it through ruins collapsing behind the broken horizon.', theme: 'ruins', gameplay: 'rescue', width: 40, height: 54, weather: 'clear', difficulty: 5, rosterOffset: 13, scaleBand: 'mid' },
  { territoryId: 'sector-glass-wake', name: 'Glass Wake', brief: 'Break the shore guard and seize the last stable crossing before the reflected tide returns.', theme: 'coast', gameplay: 'bridgehead', width: 60, height: 70, weather: 'fog', difficulty: 5, rosterOffset: 11, scaleBand: 'late' },
  { territoryId: 'sector-ash-compass', name: 'Ash Compass', brief: 'Escort the stabilizer convoy through a displaced forest whose paths turn with every signal pulse.', theme: 'forest', gameplay: 'convoy', width: 60, height: 70, weather: 'night', difficulty: 5, rosterOffset: 12, scaleBand: 'late' },
  { territoryId: 'sector-dawn-anchor', name: 'Dawn Anchor', brief: 'Hold the final anchor while the return passage seals and the surviving Shatterline guard makes its last assault.', theme: 'rift', gameplay: 'hold', width: 60, height: 70, weather: 'clear', difficulty: 5, rosterOffset: 13, scaleBand: 'lateHold' }
];

export const cityScenarios: TacticalScenario[] = CITY_CONFIGS.map(buildScenario);

export const cityScenarioIdByTerritory: Record<string, string> = Object.fromEntries(
  CITY_CONFIGS.map((c) => [c.territoryId, `city-${c.territoryId}`])
);
