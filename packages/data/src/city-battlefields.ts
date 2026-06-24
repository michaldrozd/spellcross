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

// Per-theme weighting of the open (non-feature) ground so each city reads differently underfoot.
const GROUND_BY_THEME: Record<Theme, Array<[string, number]>> = {
  urban: [['plain', 6], ['urban', 3], ['road', 1]],
  industrial: [['plain', 6], ['urban', 2], ['road', 2]],
  river: [['plain', 8], ['forest', 2]],
  forest: [['forest', 5], ['plain', 4], ['hill', 1]],
  alpine: [['hill', 5], ['plain', 4], ['forest', 1]],
  canal: [['plain', 7], ['urban', 3]],
  coast: [['plain', 6], ['swamp', 2], ['forest', 2]],
  oldtown: [['urban', 5], ['plain', 3], ['road', 2]],
  ruins: [['plain', 5], ['urban', 3], ['rubble', 2]],
  rift: [['swamp', 5], ['plain', 3], ['rubble', 2]]
};

function weightedPick(rng: () => number, weights: Array<[string, number]>): string {
  const total = weights.reduce((s, w) => s + w[1], 0);
  let x = rng() * total;
  for (const [k, w] of weights) { if ((x -= w) <= 0) return k; }
  return weights[0][0];
}

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

function generate(cfg: CityConfig): Generated {
  const { width: w, height: h, theme } = cfg;
  const rng = makeRng(`${cfg.territoryId}:${theme}:${w}x${h}`);
  const kind: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => 'ground'));

  // 1) signature feature
  paintFeature(theme, kind, w, h, rng);
  // 2) framing border of hills (vision + a contained arena), but never on the player/enemy home rows
  for (let q = 0; q < w; q++) {
    if (kind[0][q] === 'ground' && rng() < 0.85) kind[0][q] = 'hill';
    if (kind[h - 1][q] === 'ground' && rng() < 0.85) kind[h - 1][q] = 'hill';
  }
  // 3) fill remaining ground from the theme palette
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (kind[r][q] === 'ground') kind[r][q] = weightedPick(rng, GROUND_BY_THEME[theme]);
  }

  // build tiles
  const tiles: MapTile[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const mk = TERRAIN_TILE[kind[r][q]] ?? TERRAIN_TILE.plain;
    tiles.push(mk(rng));
  }
  const tileAt = (q: number, r: number) => tiles[r * w + q];

  // 4) home corners: the player deploys SW (low q, high r), the enemy holds NE (high q, low r). Force
  // those clusters to clean open ground so deployment and spawns are always valid.
  const homeCells: Coord[] = [];
  const enemyCells: Coord[] = [];
  for (let r = h - 2; r >= h - 4; r--) for (let q = 0; q < 4; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); homeCells.push({ q, r }); }
  }
  for (let r = 1; r <= 3; r++) for (let q = w - 4; q < w; q++) {
    if (inB(q, r, w, h)) { tiles[r * w + q] = TERRAIN_TILE.plain(rng); enemyCells.push({ q, r }); }
  }

  // 5) buildings: a themed landmark plus a scatter of structures (footprints become impassable)
  const props: MapProp[] = [];
  const occupied = new Set<string>(); // tiles taken by a building footprint
  const key = (q: number, r: number) => `${q},${r}`;
  const homeR = h - 1;
  const isReserved = (q: number, r: number) =>
    (q < 4 && r > h - 5) || (q > w - 5 && r < 4); // keep home corners clear of buildings

  const placeBuilding = (q: number, r: number, bw: number, bh: number, opt: Partial<MapProp> = {}) => {
    for (let dr = 0; dr < bh; dr++) for (let dq = 0; dq < bw; dq++) {
      const cq = q + dq, cr = r + dr;
      if (!inB(cq, cr, w, h) || occupied.has(key(cq, cr)) || isReserved(cq, cr)) return false;
      if (!tileAt(cq, cr).passable) return false; // don't build on water
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

  // landmark near the centre (tall, multi-tile) — the visual signature of the city
  const lcq = Math.floor(w / 2) + (rng() < 0.5 ? -1 : 0);
  const lcr = Math.floor(h / 2);
  const landmarkSize = cfg.difficulty >= 4 ? { bw: 2, bh: 2, levels: 4 } : { bw: 1, bh: 2, levels: 3 };
  placeBuilding(lcq, lcr, landmarkSize.bw, landmarkSize.bh, { levels: landmarkSize.levels, scale: 0.16, wallColor: 0x4b5563, roofColor: 0x1f2937 });

  // scattered smaller structures, more for urban/oldtown/ruins themes
  const structureBudget = { urban: 7, oldtown: 8, ruins: 7, industrial: 6, rift: 4, river: 4, canal: 5, forest: 3, alpine: 3, coast: 4 }[theme];
  for (let i = 0, tries = 0; i < structureBudget && tries < 80; tries++) {
    const q = 1 + Math.floor(rng() * (w - 2));
    const r = 2 + Math.floor(rng() * (h - 4));
    const bw = rng() < 0.3 ? 2 : 1;
    const bh = rng() < 0.4 ? 2 : 1;
    if (placeBuilding(q, r, bw, bh, { levels: 1 + (rng() < 0.4 ? 1 : 0) })) i++;
  }

  // 6) decorative props (trees/rocks/bushes) on open passable tiles — density tuned per theme so maps
  // never feel bare. Themed mix: forest/alpine lean trees, ruins/rift lean rocks.
  const decoBudget = Math.round(w * h * 0.22);
  const treeBias = { forest: 0.7, alpine: 0.55, coast: 0.4, river: 0.4, canal: 0.35, urban: 0.18, industrial: 0.2, oldtown: 0.2, ruins: 0.25, rift: 0.2 }[theme];
  for (let i = 0, tries = 0; i < decoBudget && tries < decoBudget * 4; tries++) {
    const q = Math.floor(rng() * w);
    const r = Math.floor(rng() * h);
    if (occupied.has(key(q, r)) || isReserved(q, r)) continue;
    const t = tileAt(q, r);
    if (!t.passable || t.terrain === 'water') continue;
    const roll = rng();
    const kindProp: MapProp['kind'] = roll < treeBias ? 'tree' : roll < treeBias + 0.45 * (1 - treeBias) + 0.2 ? 'bush' : 'rock';
    props.push({
      id: `${cfg.territoryId}-deco-${i}`,
      kind: kindProp,
      coordinate: { q, r },
      u: 0.3 + rng() * 0.4, v: 0.3 + rng() * 0.4,
      scale: 0.5 + rng() * 0.5,
      ...(kindProp === 'tree' ? { texture: '/props/tree1.png' } : {})
    });
    occupied.add(key(q, r)); // one decorative prop per tile
    i++;
  }

  // 7) collect passable, building-free tiles for choosing zones/objectives/spawns
  const passable: Coord[] = [];
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    if (tileAt(q, r).passable && !occupied.has(key(q, r))) passable.push({ q, r });
  }

  // home / enemy zones = the cleared corner cells, filtered to anything not later blocked
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
  { territoryId: 'sector-paris', name: 'Paris Outskirts', brief: 'Cover the civilian evacuation and reach the extraction flare before the perimeter collapses.', theme: 'urban', gameplay: 'evac', width: 14, height: 10, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-lyon', name: 'Lyon Industrial Zone', brief: 'Hold the factory strongpoint against the demonic raid on the arms works.', theme: 'industrial', gameplay: 'hold', width: 13, height: 10, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-strasbourg', name: 'Strasbourg Crossing', brief: 'Force the Rhine: rout the bridge guard or plant charges before the assault window closes.', theme: 'river', gameplay: 'bridgehead', width: 14, height: 10, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-munich', name: 'Munich Defensive Line', brief: 'Raid the forward line under cover of darkness and silence the enemy sorcery.', theme: 'forest', gameplay: 'raid-night', width: 13, height: 10, weather: 'night', difficulty: 2 },
  { territoryId: 'sector-zurich', name: 'Alpine Fortress', brief: 'Hold the mountain pass strongpoint while the bunkers are cleared.', theme: 'alpine', gameplay: 'hold', width: 13, height: 11, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-vienna', name: 'Vienna Siege', brief: 'Break the siege of the old city: rout the besiegers and breach to the inner ring.', theme: 'oldtown', gameplay: 'bridgehead', width: 15, height: 11, weather: 'clear', difficulty: 3 },
  { territoryId: 'sector-brussels', name: 'Brussels Command', brief: 'Extract the classified intel to the evac point before the HQ falls.', theme: 'urban', gameplay: 'evac', width: 14, height: 10, weather: 'clear', difficulty: 1 },
  { territoryId: 'sector-amsterdam', name: 'Amsterdam Harbor', brief: 'Fight across the canals and seize the far quay through the harbor fog.', theme: 'canal', gameplay: 'bridgehead', width: 14, height: 11, weather: 'fog', difficulty: 2 },
  { territoryId: 'sector-copenhagen', name: 'Copenhagen Strait', brief: 'Hold the coastal strongpoint and deny the Baltic flanking approach.', theme: 'coast', gameplay: 'hold', width: 14, height: 11, weather: 'clear', difficulty: 2 },
  { territoryId: 'sector-prague', name: 'Prague Old Town', brief: 'Raid the old-town warren by night and disrupt the dark ritual.', theme: 'oldtown', gameplay: 'raid-night', width: 14, height: 11, weather: 'night', difficulty: 3 },
  { territoryId: 'sector-berlin', name: 'Berlin Ruins', brief: 'Storm the ruined capital through the fog and break the ritual guardians.', theme: 'ruins', gameplay: 'spire', width: 15, height: 12, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-warsaw', name: 'Warsaw Front', brief: 'Break the eastern line through the rubble and seize the far strongpoint.', theme: 'ruins', gameplay: 'bridgehead', width: 15, height: 11, weather: 'clear', difficulty: 4 },
  { territoryId: 'sector-krakow', name: 'Krakow Citadel', brief: 'Assault the citadel turned portal-nexus and hold its grounds to seal it.', theme: 'oldtown', gameplay: 'spire', width: 15, height: 12, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-kyiv', name: 'Kyiv Siege', brief: 'Night raid through the ruined metropolis to silence the coven and hold the relay.', theme: 'ruins', gameplay: 'raid-night', width: 17, height: 13, weather: 'night', difficulty: 5 },
  { territoryId: 'sector-carpathian', name: 'Carpathian Pass', brief: 'Hold the high pass strongpoint and clear the patrol-ridden ridges.', theme: 'alpine', gameplay: 'hold', width: 15, height: 12, weather: 'clear', difficulty: 4 },
  { territoryId: 'sector-blacksea', name: 'Black Sea Coast', brief: 'Push along the foggy coast, rout the shore-spawn and seize the far cape.', theme: 'coast', gameplay: 'bridgehead', width: 15, height: 12, weather: 'fog', difficulty: 4 },
  { territoryId: 'sector-rift', name: 'The Eastern Rift', brief: 'Cross the scorched rift, destroy the guardians and hold the portal grounds.', theme: 'rift', gameplay: 'spire', width: 17, height: 13, weather: 'fog', difficulty: 5 }
];

export const cityScenarios: TacticalScenario[] = CITY_CONFIGS.map(buildScenario);

export const cityScenarioIdByTerritory: Record<string, string> = Object.fromEntries(
  CITY_CONFIGS.map((c) => [c.territoryId, `city-${c.territoryId}`])
);
