// Per-city battlefield generator. Each of the campaign's 17 sectors gets its own unique, deterministic
// map themed to the city (river crossings, alpine passes, ruined metropolises, the demonic rift, …),
// instead of reusing 5 shared layouts. Generation is seeded by the sector id, so a city always looks the
// same, and every start zone / spawn / objective is chosen from known-passable tiles — valid by
// construction (a unit test additionally asserts bounds, passability and zone-to-zone connectivity).

import type {
  BattlefieldMap,
  MapProp,
  MapTile,
  TacticalObjective,
  TacticalScenario,
  ScenarioUnit,
  TerrainType
} from './index.js';

type Coord = { q: number; r: number };
type GameplayType = 'evac' | 'hold' | 'bridgehead' | 'raid-night' | 'spire';
type Theme = 'urban' | 'industrial' | 'river' | 'forest' | 'alpine' | 'canal' | 'coast' | 'oldtown' | 'ruins' | 'rift';

interface CityConfig {
  territoryId: string;
  name: string;
  brief: string;
  theme: Theme;
  gameplay: GameplayType;
  width: number;
  height: number;
  weather?: 'clear' | 'night' | 'fog';
  difficulty: number; // 1-5, scales enemy roster
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
  plain: () => tileOf('plain'),
  road: () => tileOf('road', { cover: 0, movementCostModifier: 0.8 }),
  forest: () => tileOf('forest', { cover: 2, movementCostModifier: 2 }),
  urban: () => tileOf('urban', { cover: 1, movementCostModifier: 1.1 }),
  hill: () => tileOf('hill', { elevation: 1, providesVisionBoost: true, cover: 1, movementCostModifier: 1.2 }),
  water: () => tileOf('water', { passable: false, movementCostModifier: 99 }),
  swamp: () => tileOf('swamp', { cover: 1, movementCostModifier: 2 }),
  rubble: () => tileOf('structure', { cover: 2, movementCostModifier: 1.6, destructible: true, hp: 20 })
};

const inB = (q: number, r: number, w: number, h: number) => q >= 0 && q < w && r >= 0 && r < h;

// Paint a theme's signature terrain feature (a river, a coast, alpine ridges, a rift scar, …) onto the
// grid. Returns nothing; mutates `kind` (a per-tile terrain-key grid) which is turned into tiles after.
function paintFeature(theme: Theme, kind: string[][], w: number, h: number, rng: () => number) {
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
  passable: Coord[]; // all passable tiles (no buildings), for picking objective/spawn anchors
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
function biomeFor(theme: Theme, n: number, n2: number): string {
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
    for (const c of roadPath) if (inB(c.q, c.r, w, h)) kind[c.r][c.q] = kind[c.r][c.q] === 'water' ? 'road' : 'road';
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
  for (let r = h - 2; r >= h - 4; r--) for (let q = 0; q < 4; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); homeCells.push({ q, r }); }
  }
  for (let r = 1; r <= 3; r++) for (let q = w - 4; q < w; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); enemyCells.push({ q, r }); }
  }

  const props: MapProp[] = [];
  const occupied = new Set<string>(); // tiles taken by a building footprint
  const key = (q: number, r: number) => `${q},${r}`;
  const isReserved = (q: number, r: number) =>
    (q < 4 && r > h - 5) || (q > w - 5 && r < 4); // keep home corners clear of buildings
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
    return true;
  };

  // 6) landmark near the centre (tall, multi-tile) — the visual signature of the city
  const lcq = Math.floor(w / 2) + (rng() < 0.5 ? -1 : 0);
  const lcr = Math.floor(h / 2);
  const landmarkSize = cfg.difficulty >= 4 ? { bw: 2, bh: 2, levels: 4 } : { bw: 2, bh: 2, levels: 3 };
  placeBuilding(lcq, lcr, landmarkSize.bw, landmarkSize.bh, { levels: landmarkSize.levels, scale: 0.2, wallColor: 0x4b5563, roofColor: 0x1f2937 });

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
      const bw = rng() < 0.3 ? 2 : 1;
      const bh = rng() < 0.3 ? 2 : 1;
      if (rng() < (builtUp ? 0.7 : 0.4) && placeBuilding(q, r, bw, bh, { levels: 1 + (rng() < 0.45 ? 1 : 0) })) placed++;
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
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (occupied.has(key(q, r)) || isReserved(q, r) || isRoad.has(key(q, r))) continue;
    const t = tileAt(q, r);
    if (!t.passable || t.terrain === 'water') continue;
    if (t.terrain === 'forest') { if (rng() < 0.55) addProp(q, r, 'tree'); }
    else if (t.terrain === 'hill') { if (rng() < 0.3) addProp(q, r, 'rock'); }
    else if (t.terrain === 'structure' || t.terrain === 'swamp') { if (rng() < 0.28) addProp(q, r, 'rock'); }
    else if (t.terrain === 'plain' && isForestNear(q, r)) { if (rng() < 0.35) addProp(q, r, 'bush'); }
    else if (t.terrain === 'plain' && rng() < 0.06) addProp(q, r, rng() < 0.5 ? 'bush' : 'rock');
  }

  // 9) collect passable, building-free tiles for choosing zones/objectives/spawns
  const passable: Coord[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (tileAt(q, r).passable && !occupied.has(key(q, r))) passable.push({ q, r });
  }
  const free = (c: Coord) => tileAt(c.q, c.r).passable && !occupied.has(key(c.q, c.r));
  const allianceZone = homeCells.filter(free);
  const otherSideZone = enemyCells.filter(free);

  const map: BattlefieldMap = { id: `city-${cfg.territoryId}`, width: w, height: h, tiles, props };
  return { map, allianceZone, otherSideZone, passable };
}

// --- enemy rosters: scale composition with difficulty, and finally put the four otherwise-unused
// enemy units (wolf-rider, hell-rider, skeleton-horde, arrow-tower) into play on the hard sectors. ---
const ROSTER_BY_DIFFICULTY: Record<number, string[]> = {
  1: ['orc-warband', 'ghoul-pack', 'skeleton-horde'],
  2: ['orc-warband', 'ghoul-pack', 'wolf-rider', 'necromancer'],
  3: ['ogre-brute', 'wolf-rider', 'necromancer', 'specter', 'arrow-tower'],
  4: ['ogre-brute', 'hell-rider', 'warlock', 'salamander', 'arrow-tower', 'skeleton-horde'],
  5: ['demon-engine', 'hell-rider', 'lich-lord', 'void-drake', 'warlock', 'salamander', 'arrow-tower']
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
  while (out.length < n && copy.length) out.push(copy[out.length]); // fallback if spread couldn't fill
  return out.slice(0, n);
}

function buildObjectives(cfg: CityConfig, g: Generated, rng: () => number): { objectives: TacticalObjective[]; weather?: 'clear' | 'night' | 'fog' } {
  const id = cfg.territoryId;
  // objective anchor: a passable tile deep in enemy territory (top-right region)
  const deep = g.passable.filter((c) => c.r <= cfg.height * 0.4 && c.q >= cfg.width * 0.45);
  const anchor = (deep.length ? pickSpread(deep, 1, rng)[0] : g.otherSideZone[0]) ?? { q: cfg.width - 2, r: 1 };
  // hold tile: the passable tile nearest map centre (the centre itself is the impassable landmark).
  const cx = cfg.width / 2, cy = cfg.height / 2;
  const hold = g.passable.slice().sort((a, b) =>
    (Math.abs(a.q - cx) + Math.abs(a.r - cy)) - (Math.abs(b.q - cx) + Math.abs(b.r - cy))
  )[0] ?? { q: Math.floor(cx), r: Math.floor(cy) };
  const objs: TacticalObjective[] = [];
  switch (cfg.gameplay) {
    case 'evac':
      objs.push({ id: `${id}-reach`, kind: 'reach', description: 'Move any unit to the extraction flare.', target: anchor });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Do not lose Captain Alexander.' });
      break;
    case 'hold':
      objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the central strongpoint for 3 rounds.', target: hold, turnLimit: 3 });
      objs.push({ id: `${id}-protect`, kind: 'protect', description: 'Keep Captain Alexander alive.' });
      break;
    case 'bridgehead':
      objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Destroy or rout the defenders.' });
      objs.push({ id: `${id}-reach`, kind: 'reach', description: 'Plant charges at the far objective.', target: anchor, turnLimit: 6 + cfg.difficulty });
      break;
    case 'raid-night':
      objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Silence the enemy coven leaders.' });
      objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Secure the relay for 3 rounds.', target: hold, turnLimit: 3 });
      break;
    case 'spire':
      objs.push({ id: `${id}-eliminate`, kind: 'eliminate', description: 'Destroy the ritual guardians.' });
      objs.push({ id: `${id}-hold`, kind: 'hold', description: 'Hold the spire grounds for 3 rounds.', target: hold, turnLimit: 3 });
      break;
  }
  return { objectives: objs, weather: cfg.weather };
}

function buildScenario(cfg: CityConfig): TacticalScenario {
  const rng = makeRng(`${cfg.territoryId}:forces`);
  const g = generate(cfg);

  // enemies: count scales with difficulty, placed spread across the enemy half (not just the home zone)
  const roster = ROSTER_BY_DIFFICULTY[cfg.difficulty] ?? ROSTER_BY_DIFFICULTY[3];
  const enemyCount = Math.min(roster.length, 3 + Math.floor(cfg.difficulty / 1.5));
  const enemyArea = g.passable.filter((c) => c.r <= cfg.height * 0.55);
  const spots = pickSpread(enemyArea.length >= enemyCount ? enemyArea : g.passable, enemyCount, rng);
  const otherSideForces: ScenarioUnit[] = spots.map((c, i) => ({
    id: `${cfg.territoryId}-foe-${i}`,
    definitionId: roster[i % roster.length],
    coordinate: c
  }));

  const { objectives, weather } = buildObjectives(cfg, g, rng);

  return {
    id: `city-${cfg.territoryId}`,
    name: cfg.name,
    brief: cfg.brief,
    weather,
    map: g.map,
    startZones: { alliance: g.allianceZone, otherSide: g.otherSideZone },
    otherSideForces,
    objectives
  };
}

// === the 17 sectors, each with a distinct theme/size/weather tuned to its lore and difficulty ===
const CITY_CONFIGS: CityConfig[] = [
  { territoryId: 'sector-paris', name: 'Paris Outskirts', brief: 'Cover the civilian evacuation and reach the extraction flare before the perimeter collapses.', theme: 'urban', gameplay: 'evac', width: 18, height: 13, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-lyon', name: 'Lyon Industrial Zone', brief: 'Hold the factory strongpoint against the demonic raid on the arms works.', theme: 'industrial', gameplay: 'hold', width: 18, height: 13, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-strasbourg', name: 'Strasbourg Crossing', brief: 'Force the Rhine: rout the bridge guard or plant charges before the assault window closes.', theme: 'river', gameplay: 'bridgehead', width: 19, height: 14, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-munich', name: 'Munich Defensive Line', brief: 'Raid the forward line under cover of darkness and silence the enemy sorcery.', theme: 'forest', gameplay: 'raid-night', width: 19, height: 14, weather: 'night', difficulty: 2 },
  { territoryId: 'sector-zurich', name: 'Alpine Fortress', brief: 'Hold the mountain pass strongpoint while the bunkers are cleared.', theme: 'alpine', gameplay: 'hold', width: 19, height: 14, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-vienna', name: 'Vienna Siege', brief: 'Break the siege of the old city: rout the besiegers and breach to the inner ring.', theme: 'oldtown', gameplay: 'bridgehead', width: 20, height: 14, weather: 'clear', difficulty: 3 },
  { territoryId: 'sector-brussels', name: 'Brussels Command', brief: 'Extract the classified intel to the evac point before the HQ falls.', theme: 'urban', gameplay: 'evac', width: 18, height: 13, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-amsterdam', name: 'Amsterdam Harbor', brief: 'Fight across the canals and seize the far quay through the harbor fog.', theme: 'canal', gameplay: 'bridgehead', width: 19, height: 14, weather: 'fog', difficulty: 2 },
  { territoryId: 'sector-copenhagen', name: 'Copenhagen Strait', brief: 'Hold the coastal strongpoint and deny the Baltic flanking approach.', theme: 'coast', gameplay: 'hold', width: 19, height: 14, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-prague', name: 'Prague Old Town', brief: 'Raid the old-town warren by night and disrupt the dark ritual.', theme: 'oldtown', gameplay: 'raid-night', width: 20, height: 14, weather: 'night', difficulty: 3 },
  { territoryId: 'sector-berlin', name: 'Berlin Ruins', brief: 'Storm the ruined capital through the fog and break the ritual guardians.', theme: 'ruins', gameplay: 'spire', width: 22, height: 15, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-warsaw', name: 'Warsaw Front', brief: 'Break the eastern line through the rubble and seize the far strongpoint.', theme: 'ruins', gameplay: 'bridgehead', width: 22, height: 15, weather: 'clear', difficulty: 4 },
  { territoryId: 'sector-krakow', name: 'Krakow Citadel', brief: 'Assault the citadel turned portal-nexus and hold its grounds to seal it.', theme: 'oldtown', gameplay: 'spire', width: 22, height: 15, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-kyiv', name: 'Kyiv Siege', brief: 'Night raid through the ruined metropolis to silence the coven and hold the relay.', theme: 'ruins', gameplay: 'raid-night', width: 24, height: 17, weather: 'night', difficulty: 5 },
  { territoryId: 'sector-carpathian', name: 'Carpathian Pass', brief: 'Hold the high pass strongpoint and clear the patrol-ridden ridges.', theme: 'alpine', gameplay: 'hold', width: 22, height: 15, weather: 'clear', difficulty: 4 },
  { territoryId: 'sector-blacksea', name: 'Black Sea Coast', brief: 'Push along the foggy coast, rout the shore-spawn and seize the far cape.', theme: 'coast', gameplay: 'bridgehead', width: 22, height: 15, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-rift', name: 'The Eastern Rift', brief: 'Cross the scorched rift, destroy the guardians and hold the portal grounds.', theme: 'rift', gameplay: 'spire', width: 24, height: 17, weather: 'fog', difficulty: 5 }
];

export const cityScenarios: TacticalScenario[] = CITY_CONFIGS.map(buildScenario);

export const cityScenarioIdByTerritory: Record<string, string> = Object.fromEntries(
  CITY_CONFIGS.map((c) => [c.territoryId, `city-${c.territoryId}`])
);
