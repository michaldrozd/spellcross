export const DIRECTIONAL_UNIT_SPRITES: Record<string, string> = {
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
  m113_apc: {
    ne: 'sw',
    se: 'nw',
    sw: 'ne',
    nw: 'se'
  },
  tank_directional: OPPOSITE_DIRECTION_NAMES,
  artillery_directional: OPPOSITE_DIRECTION_NAMES
};

const VEHICLE_SHEET_DIRECTION_SUBSTITUTES: Record<string, Record<string, string>> = {
  apc_directional: {
    e: 'se',
    w: 'nw'
  }
};

export const UNIT_SHEET_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const UNIT_SHEET_FRAME_SIZE = 128;

export const DIRECTIONAL_UNIT_ASSET_VERSION: Record<string, string> = {
  m113_apc: 'm113-generated-20260503-1'
};

export const DIRECTIONAL_UNIT_FRAME_SIZES: Record<string, { width: number; height: number }> = {
  m113_apc: { width: 128, height: 128 }
};

export const RASTER_UNIT_VISIBLE_HEIGHTS: Record<string, number> = {
  '/assets/generated/apc_m113.png': 525,
  '/assets/generated/artillery_mlrs.png': 870,
  '/assets/generated/helicopter_apache.png': 647,
  '/assets/generated/infantry_squad.png': 767,
  '/assets/generated/ghoul_pack.png': 159,
  '/assets/generated/sniper_team.png': 957,
  '/assets/generated/medic_unit.png': 868,
  '/assets/generated/skeleton_warrior.png': 620,
  '/assets/generated/zombie_horde.png': 994,
  '/assets/generated/ogre_brute.png': 891,
  '/assets/generated/bone_golem.png': 902,
  '/assets/generated/necromancer.png': 858,
  '/assets/generated/death_knight.png': 981,
  '/assets/generated/tank_m1_abrams.png': 572,
  '/assets/generated/light_tank.png': 900,
  '/assets/generated/breorn_titan.png': 1230,
  '/assets/generated/ka_orc.png': 1190,
  '/assets/generated/commando_team.png': 1228,
  '/assets/generated/pyro_squad.png': 1187,
  '/assets/generated/psi_corps.png': 1212,
  '/assets/generated/exo_troopers.png': 1186,
  '/assets/generated/humvee_scout.png': 1059,
  '/assets/generated/bradley_ifv.png': 1130,
  '/assets/generated/railgun_tank.png': 1094,
  '/assets/generated/mlrs_battery.png': 1105,
  '/assets/generated/avenger_aa.png': 1061,
  '/assets/generated/siege_walker.png': 1173,
  '/assets/generated/war_orc.png': 1233,
  '/assets/generated/antitank_orc.png': 1216,
  '/assets/generated/dark_elf_archers.png': 1254,
  '/assets/generated/dire_wolves.png': 1228,
  '/assets/generated/harpy_swarm.png': 1253,
  '/assets/generated/arachnoid.png': 1171,
  '/assets/generated/knights_of_death.png': 1252,
  '/assets/generated/black_angel.png': 1188,
  '/assets/generated/stone_golem.png': 1231,
  '/assets/generated/mortar_team.png': 1139,
  '/assets/generated/supply_truck.png': 1027,
  '/assets/generated/orc_warband.png': 1180,
  '/assets/generated/winged_fiend.png': 1230,
  '/assets/generated/warlock.png': 1187,
  '/assets/generated/salamander.png': 1192,
  '/assets/generated/specter.png': 1172,
  '/assets/generated/lich_lord.png': 1252,
  '/assets/generated/void_drake.png': 1210,
  '/assets/generated/demon_engine.png': 1211,
  '/assets/generated/wolf_rider.png': 1121,
  '/assets/generated/hell_rider.png': 1250
};

export const RASTER_UNIT_ANCHOR_Y: Record<string, number> = {
  '/assets/generated/apc_m113.png': 0.71,
  '/assets/generated/artillery_mlrs.png': 0.9,
  '/assets/generated/bone_golem.png': 0.96,
  '/assets/generated/death_knight.png': 0.99,
  '/assets/generated/ghoul_pack.png': 0.86,
  '/assets/generated/helicopter_apache.png': 0.91,
  '/assets/generated/infantry_squad.png': 0.85,
  '/assets/generated/medic_unit.png': 0.94,
  '/assets/generated/necromancer.png': 0.91,
  '/assets/generated/ogre_brute.png': 0.95,
  '/assets/generated/skeleton_warrior.png': 0.76,
  '/assets/generated/sniper_team.png': 0.98,
  '/assets/generated/tank_m1_abrams.png': 0.65,
  '/assets/generated/watchtower.png': 0.99,
  '/assets/generated/zombie_horde.png': 0.97,
  '/assets/generated/light_tank.png': 0.78,
  '/assets/generated/breorn_titan.png': 0.96,
  '/assets/generated/ka_orc.png': 0.95,
  '/assets/generated/commando_team.png': 0.93,
  '/assets/generated/pyro_squad.png': 0.93,
  '/assets/generated/psi_corps.png': 0.93,
  '/assets/generated/exo_troopers.png': 0.93,
  '/assets/generated/war_orc.png': 0.93,
  '/assets/generated/antitank_orc.png': 0.93,
  '/assets/generated/dark_elf_archers.png': 0.93,
  '/assets/generated/humvee_scout.png': 0.8,
  '/assets/generated/bradley_ifv.png': 0.8,
  '/assets/generated/railgun_tank.png': 0.78,
  '/assets/generated/avenger_aa.png': 0.8,
  '/assets/generated/mlrs_battery.png': 0.82,
  '/assets/generated/siege_walker.png': 0.82,
  '/assets/generated/dire_wolves.png': 0.9,
  '/assets/generated/arachnoid.png': 0.9,
  '/assets/generated/knights_of_death.png': 0.92,
  '/assets/generated/stone_golem.png': 0.95,
  '/assets/generated/harpy_swarm.png': 0.85,
  '/assets/generated/black_angel.png': 0.85,
  '/assets/generated/mortar_team.png': 0.9,
  '/assets/generated/supply_truck.png': 0.82,
  '/assets/generated/orc_warband.png': 0.93,
  '/assets/generated/winged_fiend.png': 0.85,
  '/assets/generated/warlock.png': 0.93,
  '/assets/generated/salamander.png': 0.9,
  '/assets/generated/specter.png': 0.88,
  '/assets/generated/lich_lord.png': 0.93,
  '/assets/generated/void_drake.png': 0.85,
  '/assets/generated/demon_engine.png': 0.8,
  '/assets/generated/wolf_rider.png': 0.9,
  '/assets/generated/hell_rider.png': 0.92
};

// Per-unit raster sprite overrides keyed by a substring of the unit definitionId. Checked after the
// type-branch fallback so each new unit gets its own art; add a line here per generated sprite.
const RASTER_UNIT_OVERRIDES: Array<[string, string]> = [
  ['light-tank', '/assets/generated/light_tank.png'],
  ['breorn', '/assets/generated/breorn_titan.png'],
  ['ka-orc', '/assets/generated/ka_orc.png'],
  ['commando', '/assets/generated/commando_team.png'],
  ['flamethrower', '/assets/generated/pyro_squad.png'],
  ['psi-corps', '/assets/generated/psi_corps.png'],
  ['exo', '/assets/generated/exo_troopers.png'],
  ['humvee', '/assets/generated/humvee_scout.png'],
  ['bradley', '/assets/generated/bradley_ifv.png'],
  ['railgun', '/assets/generated/railgun_tank.png'],
  ['mlrs', '/assets/generated/mlrs_battery.png'],
  ['avenger', '/assets/generated/avenger_aa.png'],
  ['siege-walker', '/assets/generated/siege_walker.png'],
  ['war-orc', '/assets/generated/war_orc.png'],
  ['antitank-orc', '/assets/generated/antitank_orc.png'],
  ['dark-elf', '/assets/generated/dark_elf_archers.png'],
  ['dire', '/assets/generated/dire_wolves.png'],
  ['harpy', '/assets/generated/harpy_swarm.png'],
  ['arachnoid', '/assets/generated/arachnoid.png'],
  ['death-knight', '/assets/generated/knights_of_death.png'],
  ['black-angel', '/assets/generated/black_angel.png'],
  ['stone-golem', '/assets/generated/stone_golem.png'],
  ['mortar', '/assets/generated/mortar_team.png'],
  ['truck', '/assets/generated/supply_truck.png'],
  ['orc-warband', '/assets/generated/orc_warband.png'],
  ['winged-fiend', '/assets/generated/winged_fiend.png'],
  ['warlock', '/assets/generated/warlock.png'],
  ['salamander', '/assets/generated/salamander.png'],
  ['specter', '/assets/generated/specter.png'],
  ['lich', '/assets/generated/lich_lord.png'],
  ['void-drake', '/assets/generated/void_drake.png'],
  ['demon-engine', '/assets/generated/demon_engine.png'],
  ['wolf-rider', '/assets/generated/wolf_rider.png'],
  ['hell-rider', '/assets/generated/hell_rider.png']
];

export function rasterUnitOverride(definitionId: string): string | null {
  for (const [kw, path] of RASTER_UNIT_OVERRIDES) if (definitionId.includes(kw)) return path;
  return null;
}

// A representative static sprite for a unit, for HUD portraits. Hand-authored override wins; otherwise
// fall back to the same base art the battlefield uses for each unit type, so every unit shows real art.
export function unitPortrait(unitType: string, definitionId: string, isFriendly: boolean): string {
  const ov = rasterUnitOverride(definitionId);
  if (ov) return ov;
  const id = definitionId.toLowerCase();
  const g = (f: string) => `/assets/generated/${f}`;
  if (unitType === 'air') return isFriendly ? g('helicopter_apache.png') : g('black_angel.png');
  if (unitType === 'vehicle') {
    if (id.includes('apc') || id.includes('ifv') || id.includes('m113')) return g('apc_m113.png');
    if (id.includes('tank') || id.includes('abrams') || id.includes('m1')) return g('tank_m1_abrams.png');
    if (id.includes('artillery') || id.includes('mlrs') || id.includes('howitzer')) return g('artillery_mlrs.png');
    if (id.includes('heli') || id.includes('apache') || id.includes('chopper')) return g('helicopter_apache.png');
    return isFriendly ? g('tank_m1_abrams.png') : g('apc_m113.png');
  }
  if (unitType === 'artillery') return isFriendly ? g('artillery_mlrs.png') : g('watchtower.png');
  if (unitType === 'hero') {
    if (isFriendly) return g('infantry_squad.png');
    return id.includes('knight') || id.includes('death') ? g('death_knight.png') : g('necromancer.png');
  }
  if (isFriendly) {
    if (id.includes('sniper') || id.includes('scout')) return g('sniper_team.png');
    if (id.includes('medic') || id.includes('doctor')) return g('medic_unit.png');
    return g('infantry_squad.png');
  }
  // enemy infantry / support
  if (id.includes('ghoul') || id.includes('zombie') || id.includes('undead')) return g('ghoul_pack.png');
  if (id.includes('golem')) return g('bone_golem.png');
  if (id.includes('ogre') || id.includes('brute') || id.includes('troll')) return g('ogre_brute.png');
  if (id.includes('warlock') || id.includes('necromancer') || id.includes('lich')) return g('necromancer.png');
  return g('skeleton_warrior.png');
}

export const DIRECTIONAL_UNIT_ANCHOR_Y: Record<string, number> = {
  artillery_directional: 0.93,
  heavy_infantry: 0.92,
  light_infantry: 0.74,
  m113_apc: 1,
  rangers: 0.77,
  apc_directional: 1,
  tank_directional: 0.72
};

export const DIRECTIONAL_UNIT_SOURCE_HEIGHTS: Record<string, number> = {
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

const DIRECTIONAL_UNIT_ALPHA_BOTTOMS: Record<string, Record<string, number>> = {
  m113_apc: { n: 121, ne: 126, e: 119, se: 125, s: 121, sw: 124, w: 119, nw: 126 }
};

const DIRECTIONAL_UNIT_DIRECTION_LIFT: Record<string, Record<string, number>> = {};

export const DIRECTIONAL_UNIT_GROUND_BIAS: Record<string, number> = {
  m113_apc: 7
};

export type UnitVisualFootprint = { rx: number; ry: number; alpha: number; y: number };
export type UnitPointerArea = { x: number; y: number; width: number; height: number };

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

export const vehicleSheetDirectionNameForScreenVector = (vector: { x: number; y: number }, spriteName: string) => {
  const direction = directionNameForScreenVector(vector);
  const mapped = VEHICLE_SHEET_DIRECTION_OVERRIDES[spriteName]?.[direction] ?? direction;
  return cleanVehicleSheetDirection(spriteName, mapped);
};

export function unitVisualHeight(tile: number, unitType: string, definitionId: string, directionalSprite?: string) {
  if (definitionId.includes('mortar')) return tile * 0.52; // foot crew, not a towed gun
  if (definitionId.includes('orc')) return tile * 0.6; // hulking orcs read larger than human infantry
  if (definitionId.includes('lich')) return tile * 0.56; // crowned lich lord stands taller than a robed caster
  if (definitionId.includes('hell-rider')) return tile * 0.62; // mounted hell cavalry
  if (unitType === 'air') {
    if (definitionId.includes('black-angel')) return tile * 0.72;
    if (definitionId.includes('harpy')) return tile * 0.5;
    if (definitionId.includes('drake') || definitionId.includes('dragon') || definitionId.includes('fiend')) return tile * 0.62;
    return tile * 0.58;
  }
  if (unitType === 'vehicle') {
    if (definitionId.includes('breorn')) return tile * 0.98; // boss titan towers over the field
    if (definitionId.includes('golem')) return tile * 0.8;
    if (definitionId.includes('siege-walker')) return tile * 0.72;
    if (definitionId.includes('death-knight')) return tile * 0.66;
    if (definitionId.includes('arachnoid')) return tile * 0.6;
    if (definitionId.includes('dire') || definitionId.includes('wolf')) return tile * 0.52;
    if (definitionId.includes('salamander')) return tile * 0.5;
    if (definitionId.includes('demon-engine')) return tile * 0.55;
    if (directionalSprite === 'm113_apc') return tile * 0.43;
    if (directionalSprite === 'apc_directional') return tile * 0.398;
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
  if (directionalSprite === 'heavy_infantry') return tile * 0.45;
  if (directionalSprite === 'rangers') return tile * 0.56;
  if (definitionId.includes('exo')) return tile * 0.6; // power-armor troopers are bulkier
  if (definitionId.includes('sniper') || definitionId.includes('scout')) return tile * 0.31;
  if (unitType === 'infantry') return tile * 0.56;
  return tile * 0.54;
}

export function unitContactFootprint(tile: number, unitType: string, definitionId: string): UnitVisualFootprint {
  if (unitType === 'support' && definitionId.includes('truck')) return { rx: tile * 0.31, ry: tile * 0.082, alpha: 0.48, y: tile * 0.035 };
  if (unitType === 'vehicle') return { rx: tile * 0.31, ry: tile * 0.082, alpha: 0.48, y: tile * 0.035 };
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

export function rasterVehiclePose(vector: { x: number; y: number }) {
  const mirrored = vector.x > 0.08;
  const rotation = 0;
  return { mirrored, rotation };
}

export function directionalVehicleSprite(unitType: string, definitionId: string) {
  if (unitType === 'support' && definitionId.includes('truck')) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (unitType === 'artillery') return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  if (unitType !== 'vehicle') return undefined;
  if (definitionId.includes('heli') || definitionId.includes('apache') || definitionId.includes('chopper')) return undefined;
  if (definitionId.includes('apc') || definitionId.includes('ifv') || definitionId.includes('m113')) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (definitionId.includes('artillery') || definitionId.includes('mlrs') || definitionId.includes('howitzer')) return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  return VEHICLE_DIRECTIONAL_SPRITES.tank;
}

export function unitPointerArea(tile: number, unitType: string, definitionId: string, selected = false): UnitPointerArea {
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

export const directionalSpriteGroundOffset = (
  spriteName: string,
  state: 'idle' | 'walk',
  direction: string,
  scale: number
) => {
  const alphaBottom = DIRECTIONAL_UNIT_ALPHA_BOTTOMS[spriteName]?.[direction];
  if (alphaBottom !== undefined) return (UNIT_SHEET_FRAME_SIZE - alphaBottom) * scale;
  const directionLift = DIRECTIONAL_UNIT_DIRECTION_LIFT[spriteName]?.[direction] ?? 0;
  if (state !== 'walk') return directionLift === 0 ? 0 : -directionLift;
  const ground = DIRECTIONAL_UNIT_GROUND_BOTTOMS[spriteName];
  const walkBottom = ground?.walk[direction];
  if (ground === undefined || walkBottom === undefined) return directionLift === 0 ? 0 : -directionLift;
  return (ground.idle - walkBottom) * scale - directionLift;
};
