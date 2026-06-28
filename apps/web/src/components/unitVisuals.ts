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
  '/assets/generated/tank_m1_abrams.png': 572
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
  '/assets/generated/zombie_horde.png': 0.97
};

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
  if (unitType === 'vehicle') {
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
