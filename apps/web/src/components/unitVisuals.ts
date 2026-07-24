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
  artillery: 'artillery_directional',
  supplyTruck: 'supply_truck_directional'
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
    e: 'w',
    se: 'nw',
    sw: 'ne',
    w: 'e',
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

const smoothClamped = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
};

export const UNIT_SHEET_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const UNIT_SHEET_FRAME_SIZE = 128;

export const DIRECTIONAL_UNIT_ASSET_VERSION: Record<string, string> = {
  light_infantry: 'light-infantry-generated-20260721-4',
  m113_apc: 'm113-generated-20260503-1',
  supply_truck_directional: 'supply-truck-20260722-1'
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
  '/assets/generated/hell_rider.png': 1250,
  '/assets/generated/firefly_105.png': 512,
  '/assets/generated/badger_mortar_carrier.png': 571,
  '/assets/generated/thunderhead_155.png': 838,
  '/assets/generated/tempest_counterbattery.png': 574,
  '/assets/generated/horizon_radar.png': 842,
  '/assets/generated/tidewalker_apc.png': 668,
  '/assets/generated/aegis_assault_tank.png': 594,
  '/assets/generated/valkyrie_mobile_infantry.png': 564,
  '/assets/generated/breach_engineers.png': 858,
  '/assets/generated/cerberus_gunship.png': 562,
  '/assets/generated/kestrel_recon_drone.png': 677,
  '/assets/generated/wardog_fire_support.png': 589,
  '/assets/generated/razorwing_flock.png': 820,
  '/assets/generated/gloom_balloon.png': 939,
  '/assets/generated/ironroot_colossus.png': 915,
  '/assets/generated/bone_ballista.png': 683,
  '/assets/generated/resonance_cannon.png': 912,
  '/assets/generated/slime_harvester.png': 611,
  '/assets/generated/rift_predator.png': 601,
  '/assets/generated/veil_magus.png': 896,
  '/assets/generated/gate_conjurer.png': 893,
  '/assets/generated/thorn_elf_master.png': 894,
  '/assets/generated/ash_mammoth.png': 895,
  '/assets/generated/dread_fortress.png': 748,
  '/assets/generated/signal_eater.png': 1000,
  '/assets/generated/glass_regent.png': 986,
  '/assets/generated/ash_crown_sovereign.png': 942,
  '/assets/generated/renegade_cell.png': 684
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
  '/assets/generated/hell_rider.png': 0.92,
  '/assets/generated/firefly_105.png': 0.86,
  '/assets/generated/badger_mortar_carrier.png': 0.9,
  '/assets/generated/thunderhead_155.png': 0.9,
  '/assets/generated/tempest_counterbattery.png': 0.89,
  '/assets/generated/horizon_radar.png': 0.9,
  '/assets/generated/tidewalker_apc.png': 0.91,
  '/assets/generated/aegis_assault_tank.png': 0.94,
  '/assets/generated/valkyrie_mobile_infantry.png': 0.88,
  '/assets/generated/breach_engineers.png': 0.89,
  '/assets/generated/cerberus_gunship.png': 0.92,
  '/assets/generated/kestrel_recon_drone.png': 0.81,
  '/assets/generated/wardog_fire_support.png': 0.91,
  '/assets/generated/razorwing_flock.png': 0.88,
  '/assets/generated/gloom_balloon.png': 0.96,
  '/assets/generated/ironroot_colossus.png': 0.93,
  '/assets/generated/bone_ballista.png': 0.94,
  '/assets/generated/resonance_cannon.png': 0.95,
  '/assets/generated/slime_harvester.png': 0.9,
  '/assets/generated/rift_predator.png': 0.94,
  '/assets/generated/veil_magus.png': 0.94,
  '/assets/generated/gate_conjurer.png': 0.93,
  '/assets/generated/thorn_elf_master.png': 0.91,
  '/assets/generated/ash_mammoth.png': 0.93,
  '/assets/generated/dread_fortress.png': 0.96,
  '/assets/generated/signal_eater.png': 0.99,
  '/assets/generated/glass_regent.png': 0.97,
  '/assets/generated/ash_crown_sovereign.png': 0.95,
  '/assets/generated/renegade_cell.png': 0.88
};

// Per-unit raster sprite overrides keyed by a substring of the unit definitionId. Checked after the
// type-branch fallback so each new unit gets its own art; add a line here per generated sprite.
const RASTER_UNIT_OVERRIDES: Array<[string, string]> = [
  ['ogre-brute', '/assets/generated/ogre_brute.png'],
  ['firefly-105', '/assets/generated/firefly_105.png'],
  ['badger-mortar-carrier', '/assets/generated/badger_mortar_carrier.png'],
  ['thunderhead-155', '/assets/generated/thunderhead_155.png'],
  ['tempest-counterbattery', '/assets/generated/tempest_counterbattery.png'],
  ['horizon-radar', '/assets/generated/horizon_radar.png'],
  ['tidewalker-apc', '/assets/generated/tidewalker_apc.png'],
  ['aegis-assault-tank', '/assets/generated/aegis_assault_tank.png'],
  ['valkyrie-mobile-infantry', '/assets/generated/valkyrie_mobile_infantry.png'],
  ['breach-engineers', '/assets/generated/breach_engineers.png'],
  ['cerberus-gunship', '/assets/generated/cerberus_gunship.png'],
  ['kestrel-recon-drone', '/assets/generated/kestrel_recon_drone.png'],
  ['wardog-fire-support', '/assets/generated/wardog_fire_support.png'],
  ['razorwing-flock', '/assets/generated/razorwing_flock.png'],
  ['gloom-balloon', '/assets/generated/gloom_balloon.png'],
  ['ironroot-colossus', '/assets/generated/ironroot_colossus.png'],
  ['bone-ballista', '/assets/generated/bone_ballista.png'],
  ['resonance-cannon', '/assets/generated/resonance_cannon.png'],
  ['slime-harvester', '/assets/generated/slime_harvester.png'],
  ['rift-predator', '/assets/generated/rift_predator.png'],
  ['veil-magus', '/assets/generated/veil_magus.png'],
  ['gate-conjurer', '/assets/generated/gate_conjurer.png'],
  ['thorn-elf-master', '/assets/generated/thorn_elf_master.png'],
  ['ash-mammoth', '/assets/generated/ash_mammoth.png'],
  ['dread-fortress', '/assets/generated/dread_fortress.png'],
  ['signal-eater', '/assets/generated/signal_eater.png'],
  ['glass-regent', '/assets/generated/glass_regent.png'],
  ['ash-crown-sovereign', '/assets/generated/ash_crown_sovereign.png'],
  ['renegade-cell', '/assets/generated/renegade_cell.png'],
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

const UNIT_PORTRAIT_OVERRIDES: Record<string, string> = {
  'gepard-aa': '/assets/generated/gepard_aa_portrait.png',
  'heavy-infantry': '/assets/generated/heavy_infantry_portrait.png',
  'leopard-2': '/assets/generated/leopard_2_portrait.png',
  'light-infantry': '/assets/generated/light_infantry_idle_s.png',
  'paladin-acs': '/assets/generated/paladin_acs_portrait.png',
  'sky-lance': '/assets/generated/sky_lance_portrait.png',
  'spg-m109': '/assets/generated/spg_m109_portrait.png',
  rangers: '/assets/generated/rangers_portrait.png'
};

export const SHARED_UNIT_PORTRAIT_VARIANTS: ReadonlyArray<readonly string[]> = [];

// A representative static sprite for a unit, for HUD portraits. Hand-authored override wins; otherwise
// fall back to the same base art the battlefield uses for each unit type, so every unit shows real art.
export function unitPortrait(unitType: string, definitionId: string, isFriendly: boolean): string {
  const portraitOverride = UNIT_PORTRAIT_OVERRIDES[definitionId];
  if (portraitOverride) return portraitOverride;
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
  light_infantry: 0.95,
  m113_apc: 1,
  rangers: 0.77,
  apc_directional: 1,
  supply_truck_directional: 1,
  tank_directional: 0.72
};

export const DIRECTIONAL_UNIT_SOURCE_HEIGHTS: Record<string, number> = {
  artillery_directional: 110,
  apc_directional: 88,
  m113_apc: 121,
  supply_truck_directional: 104,
  tank_directional: 86
};

const DIRECTIONAL_UNIT_GROUND_BOTTOMS: Record<string, { idle: number; walk: Record<string, number> }> = {
  apc_directional: {
    idle: 128,
    walk: { n: 114, ne: 116, e: 116, se: 116, s: 114, sw: 117, w: 117, nw: 117 }
  }
};

const DIRECTIONAL_UNIT_ALPHA_BOTTOMS: Record<string, Record<string, number>> = {
  m113_apc: { n: 121, ne: 126, e: 119, se: 125, s: 121, sw: 124, w: 119, nw: 126 },
  supply_truck_directional: { n: 123, ne: 123, e: 123, se: 123, s: 123, sw: 123, w: 123, nw: 123 }
};

const DIRECTIONAL_UNIT_DIRECTION_LIFT: Record<string, Record<string, number>> = {};

export const DIRECTIONAL_UNIT_GROUND_BIAS: Record<string, number> = {
  m113_apc: 7,
  tank_directional: 1.4
};

export type UnitVisualFootprint = { rx: number; ry: number; alpha: number; y: number };
export type UnitPointerArea = { x: number; y: number; width: number; height: number };
export type VisualCoordinate = { q: number; r: number };
export type VisualMovement = {
  path: VisualCoordinate[];
  startTime: number;
  stepDuration: number;
  preAlignDuration?: number;
  segmentTurnDuration?: number;
  initialOrientation?: number;
};

export type MovementFrame = {
  displayCoord: VisualCoordinate;
  fromCoord: VisualCoordinate;
  toCoord: VisualCoordinate;
  currentStep: number;
  stepProgress: number;
  movementPhase: number;
  easedProgress: number;
  isFirstSegment: boolean;
  isLastSegment: boolean;
  isTurnPhase: boolean;
  isInitialTurnPhase: boolean;
  turnProgress: number;
  isMoving: boolean;
};

export const VEHICLE_TURN_DURATION_MS = 320;

const orientationForVisualStep = (from: VisualCoordinate, to: VisualCoordinate) => {
  const dq = Math.sign(to.q - from.q);
  const dr = Math.sign(to.r - from.r);
  if (dq > 0 && dr === 0) return 0;
  if (dq > 0 && dr < 0) return 1;
  if (dq === 0 && dr < 0) return 2;
  if (dq < 0 && dr === 0) return 3;
  if (dq < 0 && dr > 0) return 4;
  if (dq === 0 && dr > 0) return 5;
  if (dq > 0 && dr > 0) return 6;
  if (dq < 0 && dr < 0) return 7;
  return 0;
};

export function resolveMovementFrame(moving: VisualMovement, now: number): MovementFrame | null {
  if (moving.path.length < 2) return null;

  const rawElapsed = now - moving.startTime;
  const preAlignDuration = Math.max(0, moving.preAlignDuration ?? 0);
  const elapsed = Math.max(0, rawElapsed - preAlignDuration);
  const totalSteps = moving.path.length - 1;
  const stepDuration = Math.max(1, moving.stepDuration);
  const segmentTurnDuration = Math.max(0, moving.segmentTurnDuration ?? 0);
  const firstOrientation = orientationForVisualStep(moving.path[0], moving.path[1]);
  const isInitialTurnPhase = rawElapsed < preAlignDuration
    && moving.initialOrientation !== undefined
    && moving.initialOrientation !== firstOrientation;
  let remainingElapsed = elapsed;
  let currentStep = 0;
  let movementPhase = 0;
  let stepProgress = rawElapsed < preAlignDuration ? 0 : 1;
  let isTurnPhase = isInitialTurnPhase;
  let turnProgress = isInitialTurnPhase
    ? Math.min(Math.max(rawElapsed / preAlignDuration, 0), 1)
    : 0;

  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
    currentStep = stepIndex;
    if (remainingElapsed <= stepDuration || stepIndex === totalSteps - 1) {
      stepProgress = rawElapsed < preAlignDuration ? 0 : Math.min(Math.max(remainingElapsed / stepDuration, 0), 1);
      movementPhase = stepIndex + stepProgress;
      break;
    }

    remainingElapsed -= stepDuration;
    const fromOrientation = orientationForVisualStep(moving.path[stepIndex], moving.path[stepIndex + 1]);
    const toOrientation = stepIndex + 2 < moving.path.length
      ? orientationForVisualStep(moving.path[stepIndex + 1], moving.path[stepIndex + 2])
      : fromOrientation;
    const turnDuration = fromOrientation !== toOrientation ? segmentTurnDuration : 0;
    if (turnDuration > 0 && remainingElapsed <= turnDuration) {
      stepProgress = 1;
      movementPhase = stepIndex + 1;
      isTurnPhase = true;
      turnProgress = Math.min(Math.max(remainingElapsed / turnDuration, 0), 1);
      break;
    }
    remainingElapsed -= turnDuration;
  }

  const fromCoord = moving.path[currentStep];
  const toCoord = moving.path[currentStep + 1];
  const isFirstSegment = currentStep === 0;
  const isLastSegment = currentStep === totalSteps - 1;
  const easedProgress = (isFirstSegment && isLastSegment)
    ? stepProgress * stepProgress * (3 - 2 * stepProgress)
    : isFirstSegment
      ? stepProgress * stepProgress
      : isLastSegment
        ? stepProgress * (2 - stepProgress)
        : stepProgress;
  const displayCoord = isTurnPhase
    ? { ...(isInitialTurnPhase ? fromCoord : toCoord) }
    : {
        q: fromCoord.q + (toCoord.q - fromCoord.q) * easedProgress,
        r: fromCoord.r + (toCoord.r - fromCoord.r) * easedProgress
      };

  return {
    displayCoord,
    fromCoord,
    toCoord,
    currentStep,
    stepProgress,
    movementPhase,
    easedProgress,
    isFirstSegment,
    isLastSegment,
    isTurnPhase,
    isInitialTurnPhase,
    turnProgress,
    isMoving: rawElapsed >= preAlignDuration && !isTurnPhase && !(isLastSegment && stepProgress >= 1)
  };
}

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

const SCREEN_CLOCKWISE_DIRECTIONS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;

const vehicleSheetDirectionForDisplayDirection = (direction: string, spriteName: string) => {
  const mapped = VEHICLE_SHEET_DIRECTION_OVERRIDES[spriteName]?.[direction] ?? direction;
  return cleanVehicleSheetDirection(spriteName, mapped);
};

export const vehicleSheetDirectionNameForScreenVector = (vector: { x: number; y: number }, spriteName: string) => {
  return vehicleSheetDirectionForDisplayDirection(directionNameForScreenVector(vector), spriteName);
};

export type VehicleTurnSheetBlend = {
  from: string;
  to: string;
  displayFrom: string;
  displayTo: string;
  progress: number;
  stepCount: number;
  stepDirection: -1 | 0 | 1;
};

export const vehicleTurnSheetBlend = (
  fromOrientation: number,
  toOrientation: number,
  spriteName: string,
  progress: number,
  preferredDirection = 1
): VehicleTurnSheetBlend => {
  const fromDirection = directionNameForOrientation(fromOrientation);
  const toDirection = directionNameForOrientation(toOrientation);
  const fromIndex = SCREEN_CLOCKWISE_DIRECTIONS.indexOf(fromDirection as typeof SCREEN_CLOCKWISE_DIRECTIONS[number]);
  const toIndex = SCREEN_CLOCKWISE_DIRECTIONS.indexOf(toDirection as typeof SCREEN_CLOCKWISE_DIRECTIONS[number]);
  const clockwiseSteps = (toIndex - fromIndex + SCREEN_CLOCKWISE_DIRECTIONS.length) % SCREEN_CLOCKWISE_DIRECTIONS.length;
  const counterClockwiseSteps = (fromIndex - toIndex + SCREEN_CLOCKWISE_DIRECTIONS.length) % SCREEN_CLOCKWISE_DIRECTIONS.length;
  const stepDirection: -1 | 0 | 1 = clockwiseSteps === 0
    ? 0
    : clockwiseSteps < counterClockwiseSteps
      ? 1
      : counterClockwiseSteps < clockwiseSteps
        ? -1
        : preferredDirection >= 0 ? 1 : -1;
  const stepCount = Math.min(clockwiseSteps, counterClockwiseSteps);

  if (stepCount === 0) {
    const sheetDirection = vehicleSheetDirectionForDisplayDirection(toDirection, spriteName);
    return {
      from: sheetDirection,
      to: sheetDirection,
      displayFrom: toDirection,
      displayTo: toDirection,
      progress: 0,
      stepCount,
      stepDirection
    };
  }

  const clampedProgress = Math.min(1, Math.max(0, progress));
  const scaledProgress = clampedProgress * stepCount;
  const stepIndex = clampedProgress === 1
    ? stepCount - 1
    : Math.min(stepCount - 1, Math.floor(scaledProgress));
  const stepProgress = clampedProgress === 1 ? 1 : scaledProgress - stepIndex;
  const displayFrom = SCREEN_CLOCKWISE_DIRECTIONS[
    (fromIndex + stepDirection * stepIndex + SCREEN_CLOCKWISE_DIRECTIONS.length)
      % SCREEN_CLOCKWISE_DIRECTIONS.length
  ];
  const displayTo = SCREEN_CLOCKWISE_DIRECTIONS[
    (fromIndex + stepDirection * (stepIndex + 1) + SCREEN_CLOCKWISE_DIRECTIONS.length)
      % SCREEN_CLOCKWISE_DIRECTIONS.length
  ];

  return {
    from: vehicleSheetDirectionForDisplayDirection(displayFrom, spriteName),
    to: vehicleSheetDirectionForDisplayDirection(displayTo, spriteName),
    displayFrom,
    displayTo,
    progress: stepProgress,
    stepCount,
    stepDirection
  };
};

export const vehicleTurnCrossfade = (progress: number) => {
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped === 0) return { outgoingAlpha: 1, incomingAlpha: 0 };
  if (clamped === 1) return { outgoingAlpha: 0, incomingAlpha: 1 };
  const eased = smoothClamped(clamped);
  return {
    outgoingAlpha: Math.pow(Math.cos(eased * Math.PI * 0.5), 0.9),
    incomingAlpha: Math.pow(Math.sin(eased * Math.PI * 0.5), 0.9)
  };
};

export const vehicleTurnRotation = (progress: number, direction: number, incoming: boolean) => {
  const clamped = Math.min(1, Math.max(0, progress));
  const eased = smoothClamped(clamped);
  const signedDirection = Math.sign(direction);
  return incoming
    ? -signedDirection * (1 - eased) * 0.055
    : signedDirection * eased * 0.055;
};

export const vehicleTurnScaleX = (progress: number) =>
  1 - Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * 0.018;

export const vehicleTurnScaleY = (progress: number) =>
  1 + Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI) * 0.012;

export const vehicleMotionEnvelope = (frame: Pick<MovementFrame, 'isFirstSegment' | 'isLastSegment' | 'isMoving' | 'isTurnPhase' | 'isInitialTurnPhase' | 'stepProgress' | 'turnProgress'>) => {
  if (frame.isInitialTurnPhase) return Math.sin(frame.turnProgress * Math.PI) * 0.68;
  if (frame.isTurnPhase) return 1 - Math.sin(frame.turnProgress * Math.PI) * 0.28;
  if (!frame.isMoving) return 0;

  const rampWindow = 0.24;
  const acceleration = frame.isFirstSegment ? smoothClamped(frame.stepProgress / rampWindow) : 1;
  const braking = frame.isLastSegment ? smoothClamped((1 - frame.stepProgress) / rampWindow) : 1;
  return Math.min(acceleration, braking);
};

export const vehicleDustEnvelope = (frame: Pick<MovementFrame, 'isFirstSegment' | 'isLastSegment' | 'isMoving' | 'isTurnPhase' | 'isInitialTurnPhase' | 'stepProgress' | 'turnProgress'>) => {
  if (frame.isInitialTurnPhase) return Math.sin(frame.turnProgress * Math.PI) * 0.32;
  if (frame.isTurnPhase) return 0.56 + Math.sin(frame.turnProgress * Math.PI) * 0.14;
  if (!frame.isMoving) return 0;

  const motion = vehicleMotionEnvelope(frame);
  const burstWindow = 0.32;
  const startBurst = frame.isFirstSegment && frame.stepProgress < burstWindow
    ? Math.sin((frame.stepProgress / burstWindow) * Math.PI)
    : 0;
  const stopBurst = frame.isLastSegment && frame.stepProgress > 1 - burstWindow
    ? Math.sin(((frame.stepProgress - (1 - burstWindow)) / burstWindow) * Math.PI)
    : 0;
  return Math.min(1, motion * 0.56 + Math.max(startBurst, stopBurst) * 0.62);
};

export const vehicleGearPhase = (movementPhase: number, turnProgress: number) =>
  (((movementPhase * 2.8 + turnProgress * 2) % 1) + 1) % 1;

export function rangeOverlayStyle(externalTexturesAreColored: boolean) {
  return {
    fill: 0x6f9f68,
    fillAlpha: externalTexturesAreColored ? 0.3 : 0.32,
    shadow: 0x071008,
    shadowAlpha: 0.56,
    edge: 0xd7d889,
    edgeAlpha: 0.78
  } as const;
}

export function blockedRangeOverlayStyle(externalTexturesAreColored: boolean) {
  return {
    fill: 0x8f4134,
    fillAlpha: externalTexturesAreColored ? 0.33 : 0.36,
    shadow: 0x140705,
    shadowAlpha: 0.62,
    edge: 0xf0a06a,
    edgeAlpha: 0.94
  } as const;
}

export function featheredOcclusionAlpha(distanceFromOccluder: number, feather: number, obscuredAlpha: number) {
  if (feather <= 0) return distanceFromOccluder <= 0 ? obscuredAlpha : 1;
  const progress = Math.min(1, Math.max(0, distanceFromOccluder / feather));
  const eased = progress * progress * (3 - 2 * progress);
  return obscuredAlpha + (1 - obscuredAlpha) * eased;
}

export function unitVisualHeight(tile: number, unitType: string, definitionId: string, directionalSprite?: string) {
  if (definitionId.includes('ash-crown-sovereign')) return tile * 0.9;
  if (definitionId.includes('signal-eater')) return tile * 0.78;
  if (definitionId.includes('glass-regent')) return tile * 0.82;
  if (definitionId.includes('dread-fortress')) return tile * 0.78;
  if (definitionId.includes('ash-mammoth')) return tile * 0.82;
  if (definitionId.includes('ironroot-colossus')) return tile * 0.72;
  if (definitionId.includes('slime-harvester')) return tile * 0.55;
  if (definitionId.includes('gate-conjurer')) return tile * 0.6;
  if (definitionId === 'mortar-team') return tile * 0.52; // foot crew, not a towed gun
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
    if (definitionId === 'ogre-brute') return tile * 0.74;
    if (definitionId.includes('breorn')) return tile * 0.98; // boss titan towers over the field
    if (definitionId.includes('golem')) return tile * 0.8;
    if (definitionId.includes('siege-walker')) return tile * 0.72;
    if (definitionId.includes('death-knight')) return tile * 0.66;
    if (definitionId.includes('arachnoid')) return tile * 0.6;
    if (definitionId.includes('dire') || definitionId.includes('wolf')) return tile * 0.52;
    if (definitionId.includes('salamander')) return tile * 0.5;
    if (definitionId.includes('demon-engine')) return tile * 0.55;
    if (directionalSprite === 'm113_apc') return tile * 0.52;
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
  if (directionalSprite === 'light_infantry') return tile * 0.68;
  if (directionalSprite === 'rangers') return tile * 0.56;
  if (definitionId.includes('exo')) return tile * 0.6; // power-armor troopers are bulkier
  if (definitionId.includes('sniper') || definitionId.includes('scout')) return tile * 0.31;
  if (unitType === 'infantry') return tile * 0.56;
  return tile * 0.54;
}

export function isSupportVehicleDefinition(unitType: string, definitionId: string) {
  return unitType === 'support' && (definitionId.includes('truck') || definitionId.includes('radar'));
}

export function canMovingUnitFadeCanopy(
  moverFaction: string | undefined,
  viewerFaction: string,
  coordinate: { q: number; r: number },
  mapWidth: number,
  visibleTiles: ReadonlySet<number>
) {
  if (!moverFaction) return false;
  if (moverFaction === viewerFaction) return true;
  const q = Math.round(coordinate.q);
  const r = Math.round(coordinate.r);
  return visibleTiles.has(r * mapWidth + q);
}

export function quantizeMovementOcclusionCoordinate(
  coordinate: { q: number; r: number },
  stepsPerTile = 2
) {
  return {
    q: Math.round(coordinate.q * stepsPerTile) / stepsPerTile,
    r: Math.round(coordinate.r * stepsPerTile) / stepsPerTile
  };
}

export function unitContactFootprint(tile: number, unitType: string, definitionId: string): UnitVisualFootprint {
  if (isSupportVehicleDefinition(unitType, definitionId)) return { rx: tile * 0.31, ry: tile * 0.082, alpha: 0.48, y: tile * 0.035 };
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
  if (unitType === 'support' && definitionId === 'supply-truck') return VEHICLE_DIRECTIONAL_SPRITES.supplyTruck;
  if (isSupportVehicleDefinition(unitType, definitionId)) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (unitType === 'artillery') return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  if (unitType !== 'vehicle') return undefined;
  if (definitionId.includes('heli') || definitionId.includes('apache') || definitionId.includes('chopper')) return undefined;
  if (definitionId.includes('apc') || definitionId.includes('ifv') || definitionId.includes('m113')) return VEHICLE_DIRECTIONAL_SPRITES.apc;
  if (definitionId.includes('artillery') || definitionId.includes('mlrs') || definitionId.includes('howitzer')) return VEHICLE_DIRECTIONAL_SPRITES.artillery;
  return VEHICLE_DIRECTIONAL_SPRITES.tank;
}

export function battlefieldDirectionalSprite(unitType: string, definitionId: string) {
  const vehicleSprite = directionalVehicleSprite(unitType, definitionId);
  if (definitionId === 'supply-truck') return vehicleSprite;
  if (rasterUnitOverride(definitionId)) return undefined;
  return DIRECTIONAL_UNIT_SPRITES[definitionId] ?? vehicleSprite;
}

const MECHANICAL_WRECK_DEFINITION_IDS = new Set([
  'avenger-aa',
  'aegis-assault-tank',
  'arrow-tower',
  'badger-mortar-carrier',
  'bone-ballista',
  'bradley-ifv',
  'demon-engine',
  'dread-fortress',
  'firefly-105',
  'gepard-aa',
  'horizon-radar',
  'humvee-scout',
  'leopard-2',
  'light-tank',
  'm109-howitzer',
  'm113',
  'mlrs-battery',
  'paladin-acs',
  'railgun-tank',
  'resonance-cannon',
  'siege-walker',
  'sky-lance',
  'spg-m109',
  'supply-truck',
  'tempest-counterbattery',
  'thunderhead-155',
  'tidewalker-apc',
  'wardog-fire-support'
]);

const AIR_WRECK_DEFINITION_IDS = new Set([
  'attack-helo',
  'cerberus-gunship',
  'gloom-balloon',
  'kestrel-recon-drone'
]);

export function leavesMechanicalWreck(_unitType: string | undefined, definitionId: string) {
  const id = definitionId.toLowerCase();
  return MECHANICAL_WRECK_DEFINITION_IDS.has(id) || AIR_WRECK_DEFINITION_IDS.has(id);
}

export type DeathMarkerVisualClass =
  | 'rifle'
  | 'melee'
  | 'heavy'
  | 'creature'
  | 'artillery'
  | 'tracked'
  | 'wheeled'
  | 'air'
  | 'structure';

const WHEELED_WRECK_IDS = new Set([
  'avenger-aa',
  'firefly-105',
  'horizon-radar',
  'humvee-scout',
  'supply-truck'
]);

const AIR_WRECK_IDS = new Set([
  'attack-helo',
  'cerberus-gunship',
  'gloom-balloon',
  'kestrel-recon-drone'
]);

const STRUCTURE_WRECK_IDS = new Set([
  'arrow-tower',
  'bone-ballista',
  'dread-fortress'
]);

export type VehicleRunningGearKind = 'tracked' | 'wheeled';

export function vehicleRunningGearKind(unitType: string, definitionId: string): VehicleRunningGearKind | null {
  const id = definitionId.toLowerCase();
  if (!leavesMechanicalWreck(unitType, id) || STRUCTURE_WRECK_IDS.has(id)) return null;
  if (WHEELED_WRECK_IDS.has(id) || id.includes('truck')) return 'wheeled';
  if (unitType === 'vehicle' || unitType === 'artillery' || isSupportVehicleDefinition(unitType, id)) return 'tracked';
  return null;
}

const RIFLE_FOOT_IDS = new Set([
  'antitank-orc',
  'breach-engineers',
  'commando-team',
  'exo-troopers',
  'field-medic',
  'flamethrower-squad',
  'heavy-infantry',
  'john-alexander',
  'light-infantry',
  'mortar-team',
  'orc-warband',
  'rangers',
  'renegade-cell',
  'sniper-team',
  'valkyrie-mobile-infantry',
  'war-orc'
]);

const CREATURE_FOOT_IDS = new Set([
  'ghoul-pack',
  'rift-predator',
  'signal-eater'
]);

export function deathMarkerVisualClass(unitType: string | undefined, definitionId: string): DeathMarkerVisualClass {
  const id = definitionId.toLowerCase();
  if (AIR_WRECK_IDS.has(id)) return 'air';
  if (STRUCTURE_WRECK_IDS.has(id)) return 'structure';
  if (WHEELED_WRECK_IDS.has(id) || id.includes('truck')) return 'wheeled';
  if (leavesMechanicalWreck(unitType, id)
    && (unitType === 'artillery'
      || ['artillery', 'howitzer', 'mortar', 'mlrs', 'counterbattery', 'thunderhead', 'resonance-cannon']
        .some((keyword) => id.includes(keyword)))) {
    return 'artillery';
  }
  if (leavesMechanicalWreck(unitType, id)) return 'tracked';
  if (RIFLE_FOOT_IDS.has(id)) return 'rifle';
  if (CREATURE_FOOT_IDS.has(id)) return 'creature';
  if (['heavy', 'golem', 'ogre', 'titan', 'colossus', 'brute', 'death-knight', 'war-orc', 'ka-orc']
    .some((keyword) => id.includes(keyword))) {
    return 'heavy';
  }
  if (unitType === 'infantry' || unitType === 'hero' || unitType === 'support' || unitType === 'artillery') {
    return 'melee';
  }
  return 'creature';
}

export function deathMarkerDetailVisible(hitInFlight: boolean, hasCorpseTexture: boolean) {
  return !hitInFlight || hasCorpseTexture;
}

export type DeathMarkerSpriteTransform = {
  scaleX: number;
  scaleY: number;
  rotation: number;
  y: number;
};

export function deathMarkerSpriteTransform(visualClass: DeathMarkerVisualClass): DeathMarkerSpriteTransform {
  switch (visualClass) {
    case 'rifle':
      return { scaleX: 1.08, scaleY: 0.54, rotation: 0.38, y: 0.06 };
    case 'melee':
      return { scaleX: 1.12, scaleY: 0.58, rotation: -0.12, y: 0.062 };
    case 'heavy':
      return { scaleX: 1.18, scaleY: 0.64, rotation: -0.24, y: 0.065 };
    case 'creature':
      return { scaleX: 1.22, scaleY: 0.66, rotation: 0.16, y: 0.065 };
    case 'artillery':
      return { scaleX: 1.3, scaleY: 0.6, rotation: 0.1, y: 0.075 };
    case 'wheeled':
      return { scaleX: 1.18, scaleY: 0.64, rotation: -0.06, y: 0.07 };
    case 'tracked':
      return { scaleX: 1.24, scaleY: 0.72, rotation: 0.08, y: 0.07 };
    case 'air':
      return { scaleX: 1.28, scaleY: 0.58, rotation: 0.2, y: 0.08 };
    case 'structure':
      return { scaleX: 1.2, scaleY: 0.62, rotation: -0.08, y: 0.075 };
  }
}

export type InfantryGroundMotion = {
  spriteBobY: number;
  spriteSwayX: number;
  plantedSide: -1 | 1;
  plantStrength: number;
};

export function infantryGroundMotion(stepWave: number, directionalSprite: boolean): InfantryGroundMotion {
  const wave = Math.max(-1, Math.min(1, stepWave));
  const plantStrength = Math.abs(wave);
  return {
    spriteBobY: -plantStrength * (directionalSprite ? 1.2 : 1.5),
    spriteSwayX: wave * (directionalSprite ? 1.35 : 1.1),
    plantedSide: wave >= 0 ? 1 : -1,
    plantStrength
  };
}

export function unitPointerArea(tile: number, unitType: string, definitionId: string, selected = false): UnitPointerArea {
  if (unitType === 'vehicle' || isSupportVehicleDefinition(unitType, definitionId)) {
    return selected
      ? { x: -tile * 0.18, y: -tile * 0.03, width: tile * 0.36, height: tile * 0.17 }
      : { x: -tile * 0.27, y: -tile * 0.34, width: tile * 0.54, height: tile * 0.52 };
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
