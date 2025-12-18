import { z } from 'zod';

export type FactionId = 'alliance' | 'otherSide';
export type TerrainType =
  | 'plain'
  | 'road'
  | 'forest'
  | 'urban'
  | 'hill'
  | 'water'
  | 'swamp'
  | 'structure';

export interface HexCoordinate {
  q: number;
  r: number;
}

export interface MapTile {
  terrain: TerrainType;
  elevation: number;
  cover: number;
  movementCostModifier: number;
  passable: boolean;
  providesVisionBoost: boolean;
  destructible?: boolean;
  hp?: number;
}

export interface BattlefieldMap {
  id: string;
  width: number;
  height: number;
  tiles: MapTile[];
}

export interface UnitStatsData {
  maxHealth: number;
  mobility: number;
  vision: number;
  armor: number;
  morale: number;
  ammoCapacity?: number;
  transportCapacity?: number;
  weaponRanges: Record<string, number>;
  weaponPower: Record<string, number>;
  weaponAccuracy: Record<string, number>;
  weaponTargets?: Record<string, Array<UnitData['type']>>;
}

export interface UnitData {
  id: string;
  name: string;
  faction: FactionId;
  type: 'infantry' | 'vehicle' | 'air' | 'artillery' | 'support' | 'hero';
  role?: 'line' | 'recon' | 'support' | 'commander';
  cost: number;
  stats: UnitStatsData;
}

export interface ResearchTopic {
  id: string;
  name: string;
  description: string;
  cost: number;
  unlocks: string[];
  requires?: string[];
}

export type ObjectiveKind = 'eliminate' | 'reach' | 'protect' | 'hold';

export interface TacticalObjective {
  id: string;
  kind: ObjectiveKind;
  description: string;
  target?: HexCoordinate;
  turnLimit?: number;
  unitIds?: string[];
}

export interface ScenarioUnit {
  id: string;
  definitionId: string;
  coordinate: HexCoordinate;
  orientation?: number;
  isKey?: boolean;
}

export interface TacticalScenario {
  id: string;
  name: string;
  brief: string;
  weather?: 'clear' | 'night' | 'fog';
  map: BattlefieldMap;
  startZones: {
    alliance: HexCoordinate[];
    otherSide: HexCoordinate[];
  };
  allianceForces?: ScenarioUnit[];
  otherSideForces: ScenarioUnit[];
  objectives: TacticalObjective[];
}

export interface TerritorySpec {
  id: string;
  name: string;
  brief: string;
  scenarioId: string;
  timer?: number;
  reward: {
    money: number;
    research: number;
    strategic: number;
  };
  /** Position on the strategic map (percentage 0-100) */
  mapPosition?: { x: number; y: number };
  /** IDs of territories that must be cleared before this one becomes available */
  requires?: string[];
  /** Region name for grouping on the map */
  region?: string;
  /** Difficulty level 1-5 */
  difficulty?: number;
}

export interface CampaignSpec {
  id: string;
  name: string;
  description: string;
  startingResources: {
    money: number;
    research: number;
    strategic: number;
  };
  startingResearch: string[];
  startingUnits: Array<{
    id: string;
    definitionId: string;
    tier: 'rookie' | 'veteran' | 'elite';
    experience?: number;
    nickname?: string;
  }>;
  territories: TerritorySpec[];
}

export interface ContentBundle {
  units: UnitData[];
  research: ResearchTopic[];
  scenarios: TacticalScenario[];
  territories: TerritorySpec[];
  campaigns: CampaignSpec[];
}

const hexCoordinateSchema = z.object({
  q: z.number().int().nonnegative(),
  r: z.number().int().nonnegative()
});

const mapTileSchema = z.object({
  terrain: z.enum(['plain', 'road', 'forest', 'urban', 'hill', 'water', 'swamp', 'structure']),
  elevation: z.number(),
  cover: z.number(),
  movementCostModifier: z.number().positive(),
  passable: z.boolean(),
  providesVisionBoost: z.boolean(),
  destructible: z.boolean().optional(),
  hp: z.number().optional()
});

const battlefieldMapSchema = z.object({
  id: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiles: z.array(mapTileSchema)
});

const unitStatsSchema = z.object({
  maxHealth: z.number().positive(),
  mobility: z.number().positive(),
  vision: z.number().int().positive(),
  armor: z.number().nonnegative(),
  morale: z.number().int().positive(),
  ammoCapacity: z.number().int().nonnegative().optional(),
  transportCapacity: z.number().int().nonnegative().optional(),
  weaponRanges: z.record(z.string(), z.number().int().nonnegative()),
  weaponPower: z.record(z.string(), z.number().nonnegative()),
  weaponAccuracy: z.record(z.string(), z.number().min(0).max(1)),
  weaponTargets: z.record(z.string(), z.array(z.enum(['infantry', 'vehicle', 'air', 'artillery', 'support', 'hero']))).optional()
});

const unitSchema = z.object({
  id: z.string(),
  name: z.string(),
  faction: z.enum(['alliance', 'otherSide']),
  type: z.enum(['infantry', 'vehicle', 'air', 'artillery', 'support', 'hero']),
  role: z.enum(['line', 'recon', 'support', 'commander']).optional(),
  cost: z.number().nonnegative(),
  stats: unitStatsSchema
});

const researchSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  cost: z.number().positive(),
  unlocks: z.array(z.string()),
  requires: z.array(z.string()).optional()
});

const scenarioUnitSchema = z.object({
  id: z.string(),
  definitionId: z.string(),
  coordinate: hexCoordinateSchema,
  orientation: z.number().optional(),
  isKey: z.boolean().optional()
});

const tacticalObjectiveSchema = z.object({
  id: z.string(),
  kind: z.enum(['eliminate', 'reach', 'protect', 'hold']),
  description: z.string(),
  target: hexCoordinateSchema.optional(),
  turnLimit: z.number().int().positive().optional(),
  unitIds: z.array(z.string()).optional()
});

const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  brief: z.string(),
  weather: z.enum(['clear', 'night', 'fog']).optional(),
  map: battlefieldMapSchema,
  startZones: z.object({
    alliance: z.array(hexCoordinateSchema),
    otherSide: z.array(hexCoordinateSchema)
  }),
  allianceForces: z.array(scenarioUnitSchema).optional(),
  otherSideForces: z.array(scenarioUnitSchema),
  objectives: z.array(tacticalObjectiveSchema)
});

const territorySchema = z.object({
  id: z.string(),
  name: z.string(),
  brief: z.string(),
  scenarioId: z.string(),
  timer: z.number().int().positive().optional(),
  reward: z.object({
    money: z.number().nonnegative(),
    research: z.number().nonnegative(),
    strategic: z.number().nonnegative()
  }),
  mapPosition: z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100)
  }).optional(),
  requires: z.array(z.string()).optional(),
  region: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).optional()
});

const campaignSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  startingResources: z.object({
    money: z.number().nonnegative(),
    research: z.number().nonnegative(),
    strategic: z.number().nonnegative()
  }),
  startingResearch: z.array(z.string()),
  startingUnits: z.array(
    z.object({
      id: z.string(),
      definitionId: z.string(),
      tier: z.enum(['rookie', 'veteran', 'elite']),
      experience: z.number().nonnegative().optional(),
      nickname: z.string().optional()
    })
  ),
  territories: z.array(territorySchema)
});

const bundleSchema = z.object({
  units: z.array(unitSchema),
  research: z.array(researchSchema),
  scenarios: z.array(scenarioSchema),
  territories: z.array(territorySchema),
  campaigns: z.array(campaignSchema)
});

export type UnitDataValidated = z.infer<typeof unitSchema>;

export function loadContentBundle(raw: unknown): ContentBundle {
  const result = bundleSchema.parse(raw);
  return result;
}

const tile = (input: Partial<MapTile> & { terrain: TerrainType }): MapTile => ({
  elevation: 0,
  cover: 0,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false,
  ...input
});

const makeMap = (id: string, width: number, height: number, decorate: (q: number, r: number) => Partial<MapTile>): BattlefieldMap => {
  const tiles: MapTile[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      const base = tile({ terrain: 'plain' });
      const tweaks = decorate(q, r);
      tiles.push({ ...base, ...tweaks });
    }
  }
  return { id, width, height, tiles };
};

export const starterUnits: UnitData[] = [
  {
    id: 'john-alexander',
    name: 'Captain John Alexander',
    faction: 'alliance',
    type: 'hero',
    role: 'commander',
    cost: 0,
    stats: {
      maxHealth: 120,
      mobility: 8,
      vision: 5,
      armor: 3,
      morale: 90,
      ammoCapacity: 12,
      weaponRanges: { sidearm: 3, smg: 4 },
      weaponPower: { sidearm: 10, smg: 12 },
      weaponAccuracy: { sidearm: 0.7, smg: 0.68 }
    }
  },
  {
    id: 'light-infantry',
    name: 'Light Infantry',
    faction: 'alliance',
    type: 'infantry',
    role: 'line',
    cost: 60,
    stats: {
      maxHealth: 100,
      mobility: 7,
      vision: 4,
      armor: 1,
      morale: 60,
      ammoCapacity: 8,
      weaponRanges: { rifle: 5 },
      weaponPower: { rifle: 12 },
      weaponAccuracy: { rifle: 0.64 }
    }
  },
  {
    id: 'rangers',
    name: 'Ranger Recon',
    faction: 'alliance',
    type: 'infantry',
    role: 'recon',
    cost: 90,
    stats: {
      maxHealth: 80,
      mobility: 8,
      vision: 6,
      armor: 2,
      morale: 70,
      ammoCapacity: 10,
      weaponRanges: { marksman: 6 },
      weaponPower: { marksman: 14 },
      weaponAccuracy: { marksman: 0.72 }
    }
  },
  {
    id: 'mortar-team',
    name: 'Mortar Team',
    faction: 'alliance',
    type: 'artillery',
    role: 'support',
    cost: 110,
    stats: {
      maxHealth: 60,
      mobility: 5,
      vision: 4,
      armor: 1,
      morale: 60,
      ammoCapacity: 6,
      weaponRanges: { mortar: 8 },
      weaponPower: { mortar: 18 },
      weaponAccuracy: { mortar: 0.55 }
    }
  },
  {
    id: 'm113',
    name: 'M113 IFV',
    faction: 'alliance',
    type: 'vehicle',
    role: 'support',
    cost: 120,
    stats: {
      maxHealth: 80,
      mobility: 9,
      vision: 5,
      armor: 4,
      morale: 65,
      ammoCapacity: 8,
      transportCapacity: 2,
      weaponRanges: { autocannon: 6 },
      weaponPower: { autocannon: 16 },
      weaponAccuracy: { autocannon: 0.62 }
    }
  },
  {
    id: 'leopard-2',
    name: 'Leopard 2 MBT',
    faction: 'alliance',
    type: 'vehicle',
    role: 'line',
    cost: 220,
    stats: {
      maxHealth: 110,
      mobility: 8,
      vision: 6,
      armor: 8,
      morale: 70,
      weaponRanges: { cannon: 7, coax: 3 },
      weaponPower: { cannon: 28, coax: 8 },
      weaponAccuracy: { cannon: 0.64, coax: 0.52 }
    }
  },
  {
    id: 'gepard-aa',
    name: 'Gepard AA',
    faction: 'alliance',
    type: 'vehicle',
    role: 'support',
    cost: 150,
    stats: {
      maxHealth: 85,
      mobility: 9,
      vision: 6,
      armor: 6,
      morale: 65,
      weaponRanges: { aa: 6, gun: 5 },
      weaponPower: { aa: 18, gun: 14 },
      weaponAccuracy: { aa: 0.66, gun: 0.6 },
      weaponTargets: { aa: ['air'] }
    }
  },
  {
    id: 'orc-warband',
    name: 'Orc Warband',
    faction: 'otherSide',
    type: 'infantry',
    role: 'line',
    cost: 0,
    stats: {
      maxHealth: 90,
      mobility: 6,
      vision: 4,
      armor: 1,
      morale: 55,
      weaponRanges: { cleaver: 1, musket: 4 },
      weaponPower: { cleaver: 16, musket: 10 },
      weaponAccuracy: { cleaver: 0.8, musket: 0.48 }
    }
  },
  {
    id: 'ghoul-pack',
    name: 'Ghoul Pack',
    faction: 'otherSide',
    type: 'infantry',
    role: 'recon',
    cost: 0,
    stats: {
      maxHealth: 70,
      mobility: 8,
      vision: 5,
      armor: 0,
      morale: 50,
      weaponRanges: { claws: 1, darts: 3 },
      weaponPower: { claws: 18, darts: 8 },
      weaponAccuracy: { claws: 0.82, darts: 0.52 }
    }
  },
  {
    id: 'necromancer',
    name: 'Necromancer',
    faction: 'otherSide',
    type: 'support',
    role: 'commander',
    cost: 0,
    stats: {
      maxHealth: 60,
      mobility: 6,
      vision: 6,
      armor: 0,
      morale: 70,
      weaponRanges: { hex: 5 },
      weaponPower: { hex: 12 },
      weaponAccuracy: { hex: 0.65 }
    }
  },
  {
    id: 'ogre-brute',
    name: 'Ogre Brute',
    faction: 'otherSide',
    type: 'vehicle',
    role: 'line',
    cost: 0,
    stats: {
      maxHealth: 140,
      mobility: 6,
      vision: 4,
      armor: 6,
      morale: 65,
      weaponRanges: { maul: 1, boulder: 3 },
      weaponPower: { maul: 26, boulder: 20 },
      weaponAccuracy: { maul: 0.75, boulder: 0.5 }
    }
  },
  {
    id: 'winged-fiend',
    name: 'Winged Fiend',
    faction: 'otherSide',
    type: 'air',
    role: 'recon',
    cost: 0,
    stats: {
      maxHealth: 70,
      mobility: 10,
      vision: 6,
      armor: 2,
      morale: 60,
    weaponRanges: { talons: 1, scream: 4 },
    weaponPower: { talons: 16, scream: 14 },
    weaponAccuracy: { talons: 0.74, scream: 0.62 }
    }
  },
  {
    id: 'heavy-infantry',
    name: 'Storm Squad',
    faction: 'alliance',
    type: 'infantry',
    role: 'line',
    cost: 130,
    stats: {
      maxHealth: 110,
      mobility: 6,
      vision: 4,
      armor: 3,
      morale: 70,
      ammoCapacity: 9,
      weaponRanges: { lmg: 5, at: 3 },
      weaponPower: { lmg: 16, at: 22 },
      weaponAccuracy: { lmg: 0.62, at: 0.58 }
    }
  },
  {
    id: 'sniper-team',
    name: 'Pathfinder Snipers',
    faction: 'alliance',
    type: 'infantry',
    role: 'recon',
    cost: 140,
    stats: {
      maxHealth: 70,
      mobility: 7,
      vision: 7,
      armor: 1,
      morale: 75,
      weaponRanges: { sniper: 8 },
      weaponPower: { sniper: 22 },
      weaponAccuracy: { sniper: 0.86 }
    }
  },
  {
    id: 'spg-m109',
    name: 'M109 SPG',
    faction: 'alliance',
    type: 'artillery',
    role: 'support',
    cost: 210,
    stats: {
      maxHealth: 90,
      mobility: 7,
      vision: 6,
      armor: 4,
      morale: 70,
      ammoCapacity: 6,
      weaponRanges: { howitzer: 9 },
      weaponPower: { howitzer: 26 },
      weaponAccuracy: { howitzer: 0.58 }
    }
  },
  {
    id: 'attack-helo',
    name: 'Attack Helicopter',
    faction: 'alliance',
    type: 'air',
    role: 'support',
    cost: 260,
    stats: {
      maxHealth: 95,
      mobility: 12,
      vision: 7,
      armor: 5,
      morale: 75,
      ammoCapacity: 10,
      weaponRanges: { rockets: 5, gun: 4 },
      weaponPower: { rockets: 24, gun: 16 },
      weaponAccuracy: { rockets: 0.62, gun: 0.64 },
      weaponTargets: { rockets: ['infantry', 'vehicle', 'artillery', 'support'] }
    }
  },
  {
    id: 'field-medic',
    name: 'Field Medic',
    faction: 'alliance',
    type: 'support',
    role: 'support',
    cost: 80,
    stats: {
      maxHealth: 70,
      mobility: 7,
      vision: 5,
      armor: 1,
      morale: 70,
      ammoCapacity: 8,
      weaponRanges: { carbine: 4 },
      weaponPower: { carbine: 10 },
      weaponAccuracy: { carbine: 0.6 }
    }
  },
  {
    id: 'supply-truck',
    name: 'Supply Truck',
    faction: 'alliance',
    type: 'support',
    role: 'support',
    cost: 90,
    stats: {
      maxHealth: 70,
      mobility: 8,
      vision: 4,
      armor: 1,
      morale: 60,
      ammoCapacity: 0,
      transportCapacity: 1,
      weaponRanges: { smg: 3 },
      weaponPower: { smg: 8 },
      weaponAccuracy: { smg: 0.55 }
    }
  },
  {
    id: 'warlock',
    name: 'Warlock',
    faction: 'otherSide',
    type: 'support',
    role: 'commander',
    cost: 0,
    stats: {
      maxHealth: 70,
      mobility: 7,
      vision: 7,
      armor: 1,
      morale: 80,
      weaponRanges: { curse: 6 },
      weaponPower: { curse: 18 },
      weaponAccuracy: { curse: 0.72 }
    }
  },
  {
    id: 'salamander',
    name: 'Salamander',
    faction: 'otherSide',
    type: 'vehicle',
    role: 'line',
    cost: 0,
    stats: {
      maxHealth: 120,
      mobility: 7,
      vision: 5,
      armor: 7,
      morale: 70,
      weaponRanges: { flame: 3, bolt: 5 },
      weaponPower: { flame: 24, bolt: 20 },
      weaponAccuracy: { flame: 0.7, bolt: 0.64 }
    }
  },
  {
    id: 'specter',
    name: 'Specter',
    faction: 'otherSide',
    type: 'infantry',
    role: 'recon',
    cost: 0,
    stats: {
      maxHealth: 60,
      mobility: 9,
      vision: 7,
      armor: 0,
      morale: 80,
      weaponRanges: { claws: 1, shadow: 4 },
      weaponPower: { claws: 18, shadow: 14 },
      weaponAccuracy: { claws: 0.78, shadow: 0.66 }
    }
  },
  {
    id: 'paladin-acs',
    name: 'Paladin ACS',
    faction: 'alliance',
    type: 'artillery',
    role: 'support',
    cost: 260,
    stats: {
      maxHealth: 105,
      mobility: 7,
      vision: 6,
      armor: 6,
      morale: 80,
      ammoCapacity: 6,
      weaponRanges: { 'heavy-shell': 10, coax: 3 },
      weaponPower: { 'heavy-shell': 30, coax: 10 },
      weaponAccuracy: { 'heavy-shell': 0.64, coax: 0.54 }
    }
  },
  {
    id: 'sky-lance',
    name: 'Sky Lance SAM',
    faction: 'alliance',
    type: 'vehicle',
    role: 'support',
    cost: 190,
    stats: {
      maxHealth: 90,
      mobility: 8,
      vision: 7,
      armor: 5,
      morale: 75,
      ammoCapacity: 8,
      weaponRanges: { sam: 8, gun: 4 },
      weaponPower: { sam: 26, gun: 12 },
      weaponAccuracy: { sam: 0.7, gun: 0.6 },
      weaponTargets: { sam: ['air', 'vehicle', 'artillery', 'support'] }
    }
  },
  {
    id: 'lich-lord',
    name: 'Lich Lord',
    faction: 'otherSide',
    type: 'support',
    role: 'commander',
    cost: 0,
    stats: {
      maxHealth: 85,
      mobility: 6,
      vision: 7,
      armor: 2,
      morale: 90,
      weaponRanges: { doom: 6, hex: 4 },
      weaponPower: { doom: 26, hex: 16 },
      weaponAccuracy: { doom: 0.68, hex: 0.7 }
    }
  },
  {
    id: 'void-drake',
    name: 'Void Drake',
    faction: 'otherSide',
    type: 'air',
    role: 'recon',
    cost: 0,
    stats: {
      maxHealth: 120,
      mobility: 12,
      vision: 8,
      armor: 6,
      morale: 85,
      weaponRanges: { flame: 3, dive: 1, shriek: 5 },
      weaponPower: { flame: 24, dive: 30, shriek: 18 },
      weaponAccuracy: { flame: 0.7, dive: 0.82, shriek: 0.66 }
    }
  },
  {
    id: 'demon-engine',
    name: 'Demon Engine',
    faction: 'otherSide',
    type: 'vehicle',
    role: 'line',
    cost: 0,
    stats: {
      maxHealth: 150,
      mobility: 6,
      vision: 6,
      armor: 9,
      morale: 80,
      weaponRanges: { magma: 4, bolt: 6 },
      weaponPower: { magma: 32, bolt: 24 },
      weaponAccuracy: { magma: 0.64, bolt: 0.6 }
    }
  }
];

export const starterResearch: ResearchTopic[] = [
  {
    id: 'optics-i',
    name: 'Optics I',
    description: 'Scoped sights and rangefinders improve hit odds at distance.',
    cost: 60,
    unlocks: ['rangers', 'gepard-aa']
  },
  {
    id: 'optics-ii',
    name: 'Optics II',
    description: 'Thermal and low-light sights improve reconnaissance in poor visibility.',
    cost: 90,
    unlocks: ['sniper-team', 'attack-helo'],
    requires: ['optics-i']
  },
  {
    id: 'armor-upfit',
    name: 'Composite Plating',
    description: 'Layered armor kits for frontline vehicles.',
    cost: 80,
    unlocks: ['leopard-2'],
    requires: ['optics-i']
  },
  {
    id: 'esprit-de-corps',
    name: 'Esprit de Corps',
    description: 'Unit cohesion drills that boost morale recovery.',
    cost: 50,
    unlocks: ['light-infantry', 'mortar-team']
  },
  {
    id: 'siege-ops',
    name: 'Siege Operations',
    description: 'Ballistics tables and spotter protocols for heavy artillery.',
    cost: 120,
    unlocks: ['spg-m109'],
    requires: ['armor-upfit']
  },
  {
    id: 'sanctified-ammo',
    name: 'Sanctified Ammunition',
    description: 'Blessed rounds to disrupt spectral enemies.',
    cost: 70,
    unlocks: ['heavy-infantry'],
    requires: ['esprit-de-corps']
  },
  {
    id: 'mobile-supply',
    name: 'Mobile Supply Corps',
    description: 'Field supply trucks to resupply ammo mid-battle.',
    cost: 80,
    unlocks: ['supply-truck', 'supply-truck-unlock']
  },
  {
    id: 'arcane-shielding',
    name: 'Arcane Shielding',
    description: 'Reinforced plating and wards for late-war artillery and SAM cover.',
    cost: 110,
    unlocks: ['paladin-acs', 'sky-lance'],
    requires: ['siege-ops']
  },
  {
    id: 'wyrm-slayer',
    name: 'Wyrm Slayer Doctrine',
    description: 'Anti-beast tactics and tracking for flying horrors.',
    cost: 90,
    unlocks: ['sky-lance'],
    requires: ['arcane-shielding']
  }
];

const borderMap = makeMap('evac-corridor', 9, 7, (q, r) => {
  if (q === 4 && r >= 1 && r <= 5) {
    return tile({ terrain: 'water', passable: false, movementCostModifier: 99 });
  }
  if (r === 0 || r === 6) {
    return tile({ terrain: 'forest', cover: 2, movementCostModifier: 2 });
  }
  if (q === 2 && r >= 2 && r <= 4) {
    return tile({ terrain: 'urban', cover: 3, movementCostModifier: 2, providesVisionBoost: true });
  }
  if ((q === 6 || q === 7) && r === 3) {
    return tile({ terrain: 'hill', elevation: 1, providesVisionBoost: true, cover: 1, movementCostModifier: 1.2 });
  }
  return {};
});

const hamletMap = makeMap('crossroads-hold', 8, 6, (q, r) => {
  if ((q === 3 || q === 4) && r === 2) {
    return tile({ terrain: 'urban', cover: 3, movementCostModifier: 2, destructible: true, hp: 35 });
  }
  if (r === 2 && q >= 2 && q <= 5) {
    return tile({ terrain: 'urban', cover: 3, movementCostModifier: 2 });
  }
  if (q === 1 && r >= 1 && r <= 4) {
    return tile({ terrain: 'forest', cover: 2, movementCostModifier: 2 });
  }
  if (r === 5 || r === 0) {
    return tile({ terrain: 'hill', elevation: 1, providesVisionBoost: true, movementCostModifier: 1.3 });
  }
  return {};
});

const bridgeMap = makeMap('river-bridge', 10, 6, (q, r) => {
  if (q === 4 && r === 2) {
    return tile({ terrain: 'structure', cover: 3, passable: false, movementCostModifier: 99 });
  }
  if (q === 5 && r === 3) {
    return tile({ terrain: 'structure', cover: 3, passable: false, movementCostModifier: 99 });
  }
  if (q === 4 && r === 3) {
    return tile({ terrain: 'road', cover: 1, movementCostModifier: 0.8, destructible: true, hp: 30 });
  }
  if (q === 5 && r === 2) {
    return tile({ terrain: 'road', cover: 1, movementCostModifier: 0.8, destructible: true, hp: 30 });
  }
  if (q === 4 || q === 5) {
    return tile({ terrain: 'water', passable: false, movementCostModifier: 99 });
  }
  if (r === 1 || r === 4) {
    return tile({ terrain: 'forest', cover: 2, movementCostModifier: 2 });
  }
  return {};
});

const outpostMap = makeMap('forward-outpost', 9, 6, (q, r) => {
  if (r === 0 || r === 5) {
    return tile({ terrain: 'hill', elevation: 1, providesVisionBoost: true, cover: 1, movementCostModifier: 1.2 });
  }
  if ((q === 2 && r === 3) || (q === 6 && r === 2)) {
    return tile({ terrain: 'structure', passable: false, cover: 3, movementCostModifier: 99, destructible: true, hp: 30 });
  }
  if ((q === 3 || q === 5) && r >= 2 && r <= 3) {
    return tile({ terrain: 'structure', passable: false, cover: 3, movementCostModifier: 99, destructible: true, hp: 40 });
  }
  if (q === 4 && r === 3) {
    return tile({ terrain: 'road', cover: 1, movementCostModifier: 0.8, destructible: true, hp: 25 });
  }
  if (r === 2 && q >= 0 && q <= 2) {
    return tile({ terrain: 'forest', cover: 2, movementCostModifier: 2 });
  }
  if (q === 7 && r >= 1 && r <= 4) {
    return tile({ terrain: 'swamp', cover: 1, movementCostModifier: 2 });
  }
  return {};
});

const blackSpireMap = makeMap('black-spire', 11, 8, (q, r) => {
  if (r === 0 || r === 7) {
    return tile({ terrain: 'hill', elevation: 1, providesVisionBoost: true, cover: 1, movementCostModifier: 1.2 });
  }
  if ((q === 5 || q === 6) && r >= 2 && r <= 5) {
    return tile({ terrain: 'structure', passable: false, cover: 3, movementCostModifier: 99, destructible: true, hp: 50 });
  }
  if ((q === 4 || q === 7) && r === 3) {
    return tile({ terrain: 'structure', passable: false, cover: 3, movementCostModifier: 99, destructible: true, hp: 35 });
  }
  if ((q === 3 || q === 8) && r === 4) {
    return tile({ terrain: 'urban', cover: 3, movementCostModifier: 2, destructible: true, hp: 28 });
  }
  if (r === 2 && q >= 1 && q <= 3) {
    return tile({ terrain: 'forest', cover: 2, movementCostModifier: 2 });
  }
  if (r === 5 && q >= 7 && q <= 9) {
    return tile({ terrain: 'swamp', cover: 1, movementCostModifier: 2 });
  }
  if (q === 9 && r === 3) {
    return tile({ terrain: 'road', cover: 1, movementCostModifier: 0.8 });
  }
  return {};
});

export const starterScenarios: TacticalScenario[] = [
  {
    id: 'evacuation-run',
    name: 'Evacuation Run',
    brief: 'Punch through raiders and reach the evac signal before the line collapses.',
    map: borderMap,
    startZones: {
      alliance: [
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 0, r: 4 },
        { q: 1, r: 3 }
      ],
      otherSide: [
        { q: 7, r: 2 },
        { q: 7, r: 3 },
        { q: 7, r: 4 }
      ]
    },
    allianceForces: [
      { id: 'ally-rangers', definitionId: 'rangers', coordinate: { q: 1, r: 2 } }
    ],
    otherSideForces: [
      { id: 'evac-orc-1', definitionId: 'orc-warband', coordinate: { q: 6, r: 2 } },
      { id: 'evac-orc-2', definitionId: 'orc-warband', coordinate: { q: 6, r: 4 } },
      { id: 'evac-ghoul', definitionId: 'ghoul-pack', coordinate: { q: 5, r: 3 } }
    ],
    objectives: [
      {
        id: 'reach-evac',
        kind: 'reach',
        description: 'Move any allied unit onto the evac flare.',
        target: { q: 8, r: 3 }
      },
      {
        id: 'keep-commander',
        kind: 'protect',
        description: 'Do not lose Captain Alexander.',
        unitIds: ['captain']
      }
    ]
  },
  {
    id: 'crossroads-defense',
    name: 'Crossroads Defense',
    brief: 'Hold a ruined hamlet against a probing attack.',
    map: hamletMap,
    startZones: {
      alliance: [
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 1, r: 2 }
      ],
      otherSide: [
        { q: 6, r: 2 },
        { q: 6, r: 3 },
        { q: 6, r: 4 }
      ]
    },
    otherSideForces: [
      { id: 'hamlet-ogre', definitionId: 'ogre-brute', coordinate: { q: 6, r: 3 } },
      { id: 'hamlet-orc', definitionId: 'orc-warband', coordinate: { q: 5, r: 2 } },
      { id: 'hamlet-necro', definitionId: 'necromancer', coordinate: { q: 5, r: 4 } }
    ],
    objectives: [
      { id: 'eliminate', kind: 'eliminate', description: 'Destroy the enemy spearhead.' },
      {
        id: 'protect-bridge',
        kind: 'hold',
        description: 'Hold the central square for 4 rounds.',
        target: { q: 3, r: 2 },
        turnLimit: 4
      }
    ]
  },
  {
    id: 'enemy-counterstrike',
    name: 'Hamlet Counterattack',
    brief: 'Enemy forces push back toward the crossroads. Hold the square until they break.',
    map: hamletMap,
    startZones: {
      alliance: [
        { q: 2, r: 2 },
        { q: 2, r: 3 },
        { q: 1, r: 2 }
      ],
      otherSide: [
        { q: 6, r: 2 },
        { q: 6, r: 3 },
        { q: 5, r: 3 }
      ]
    },
    allianceForces: [
      { id: 'militia-ally', definitionId: 'light-infantry', coordinate: { q: 1, r: 3 } }
    ],
    otherSideForces: [
      { id: 'counter-ogre', definitionId: 'ogre-brute', coordinate: { q: 6, r: 3 } },
      { id: 'counter-ghoul', definitionId: 'ghoul-pack', coordinate: { q: 5, r: 2 } },
      { id: 'counter-necro', definitionId: 'necromancer', coordinate: { q: 5, r: 4 } }
    ],
    objectives: [
      {
        id: 'hold-square',
        kind: 'hold',
        description: 'Hold the town square for 3 rounds.',
        target: { q: 3, r: 2 },
        turnLimit: 3
      },
      {
        id: 'protect-captain',
        kind: 'protect',
        description: 'Keep Captain Alexander alive.',
        unitIds: ['captain']
      }
    ]
  },
  {
    id: 'bridgehead',
    name: 'Bridgehead Raid',
    brief: 'Demolish the enemy bridge or rout their guard before reinforcements arrive.',
    map: bridgeMap,
    startZones: {
      alliance: [
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 1, r: 2 },
        { q: 1, r: 3 }
      ],
      otherSide: [
        { q: 8, r: 2 },
        { q: 8, r: 3 },
        { q: 7, r: 2 }
      ]
    },
    otherSideForces: [
      { id: 'bridge-ogre', definitionId: 'ogre-brute', coordinate: { q: 8, r: 3 } },
      { id: 'bridge-ghoul', definitionId: 'ghoul-pack', coordinate: { q: 7, r: 2 } },
      { id: 'bridge-fiend', definitionId: 'winged-fiend', coordinate: { q: 8, r: 1 } }
    ],
    objectives: [
      { id: 'eliminate', kind: 'eliminate', description: 'Destroy or rout all defenders.' },
      {
        id: 'reach-bridge',
        kind: 'reach',
        description: 'Plant charges on the bridge span.',
        target: { q: 4, r: 3 },
        turnLimit: 6
      }
    ]
  },
  {
    id: 'outpost-night',
    name: 'Forward Outpost Night Raid',
    brief: 'Break the siege line under cover of darkness and silence enemy sorcery.',
    weather: 'night',
    map: outpostMap,
    startZones: {
      alliance: [
        { q: 0, r: 2 },
        { q: 0, r: 3 },
        { q: 1, r: 2 },
        { q: 1, r: 3 }
      ],
      otherSide: [
        { q: 7, r: 2 },
        { q: 7, r: 3 },
        { q: 6, r: 2 }
      ]
    },
    allianceForces: [
      { id: 'ally-sniper', definitionId: 'sniper-team', coordinate: { q: 1, r: 1 } }
    ],
    otherSideForces: [
      { id: 'outpost-warlock', definitionId: 'warlock', coordinate: { q: 7, r: 2 } },
      { id: 'outpost-salamander', definitionId: 'salamander', coordinate: { q: 6, r: 3 } },
      { id: 'outpost-specter', definitionId: 'specter', coordinate: { q: 6, r: 1 } }
    ],
    objectives: [
      { id: 'eliminate-commander', kind: 'eliminate', description: 'Eliminate the enemy coven leaders.' },
      { id: 'hold-relay', kind: 'hold', description: 'Secure the comms relay for 3 rounds.', target: { q: 4, r: 2 }, turnLimit: 3 }
    ]
  },
  {
    id: 'black-spire-assault',
    name: 'Black Spire Assault',
    brief: 'Crash the ritual spire, break the beasts, and stop the portal ignition.',
    weather: 'fog',
    map: blackSpireMap,
    startZones: {
      alliance: [
        { q: 0, r: 3 },
        { q: 1, r: 3 },
        { q: 0, r: 4 },
        { q: 1, r: 4 },
        { q: 2, r: 4 }
      ],
      otherSide: [
        { q: 9, r: 3 },
        { q: 9, r: 4 },
        { q: 8, r: 3 },
        { q: 8, r: 4 }
      ]
    },
    allianceForces: [
      { id: 'taskforce-paladin', definitionId: 'paladin-acs', coordinate: { q: 1, r: 5 } },
      { id: 'taskforce-sky', definitionId: 'sky-lance', coordinate: { q: 1, r: 2 } }
    ],
    otherSideForces: [
      { id: 'spire-lich', definitionId: 'lich-lord', coordinate: { q: 9, r: 3 } },
      { id: 'spire-drake', definitionId: 'void-drake', coordinate: { q: 9, r: 1 } },
      { id: 'spire-engine', definitionId: 'demon-engine', coordinate: { q: 8, r: 4 } },
      { id: 'spire-specter', definitionId: 'specter', coordinate: { q: 7, r: 2 } }
    ],
    objectives: [
      { id: 'eliminate-portal', kind: 'eliminate', description: 'Destroy the ritual guardians.' },
      { id: 'hold-spire', kind: 'hold', description: 'Hold the spire grounds for 3 rounds.', target: { q: 6, r: 3 }, turnLimit: 3 }
    ]
  }
];

/** Strategic Campaign Map - Central Europe Theatre
 * The invasion started from the East. We must push back sector by sector.
 * Map covers: Western front (Spain/France) through Central Europe to Eastern front (Poland/Ukraine)
 */
export const starterTerritories: TerritorySpec[] = [
  // === STARTING SECTORS (Western Front - Already partially secured) ===
  {
    id: 'sector-paris',
    name: 'Paris Outskirts',
    brief: 'The capital evacuation is underway. Secure the perimeter while civilians escape.',
    scenarioId: 'evacuation-run',
    timer: 5,
    reward: { money: 100, research: 30, strategic: 20 },
    mapPosition: { x: 28, y: 35 },
    region: 'France',
    difficulty: 1
  },
  {
    id: 'sector-lyon',
    name: 'Lyon Industrial Zone',
    brief: 'Protect the arms factories from demonic saboteurs.',
    scenarioId: 'crossroads-defense',
    reward: { money: 120, research: 40, strategic: 25 },
    mapPosition: { x: 32, y: 48 },
    region: 'France',
    difficulty: 1
  },
  // === CENTRAL FRONT (Germany/Alps) ===
  {
    id: 'sector-strasbourg',
    name: 'Strasbourg Crossing',
    brief: 'The Rhine bridge is our only supply line. Hold it at all costs.',
    scenarioId: 'bridgehead',
    timer: 6,
    reward: { money: 140, research: 45, strategic: 30 },
    mapPosition: { x: 38, y: 38 },
    requires: ['sector-paris'],
    region: 'France',
    difficulty: 2
  },
  {
    id: 'sector-munich',
    name: 'Munich Defensive Line',
    brief: 'German forces are holding. Reinforce their position before the next wave.',
    scenarioId: 'outpost-night',
    timer: 7,
    reward: { money: 160, research: 50, strategic: 35 },
    mapPosition: { x: 48, y: 42 },
    requires: ['sector-strasbourg'],
    region: 'Germany',
    difficulty: 2
  },
  {
    id: 'sector-zurich',
    name: 'Alpine Fortress',
    brief: 'Swiss bunkers provide excellent defensive positions. Clear the tunnels.',
    scenarioId: 'crossroads-defense',
    reward: { money: 130, research: 55, strategic: 40 },
    mapPosition: { x: 40, y: 52 },
    requires: ['sector-lyon'],
    region: 'Switzerland',
    difficulty: 2
  },
  {
    id: 'sector-vienna',
    name: 'Vienna Siege',
    brief: 'The ancient city is under siege. Break through and liberate the defenders.',
    scenarioId: 'bridgehead',
    timer: 8,
    reward: { money: 180, research: 60, strategic: 45 },
    mapPosition: { x: 55, y: 45 },
    requires: ['sector-munich', 'sector-zurich'],
    region: 'Austria',
    difficulty: 3
  },
  // === NORTHERN FRONT (Benelux/Scandinavia) ===
  {
    id: 'sector-brussels',
    name: 'Brussels Command',
    brief: 'NATO headquarters is compromised. Extract classified intel before it falls.',
    scenarioId: 'evacuation-run',
    timer: 5,
    reward: { money: 110, research: 35, strategic: 25 },
    mapPosition: { x: 32, y: 28 },
    region: 'Belgium',
    difficulty: 1
  },
  {
    id: 'sector-amsterdam',
    name: 'Amsterdam Harbor',
    brief: 'Control of the port is essential for naval supply routes.',
    scenarioId: 'bridgehead',
    reward: { money: 140, research: 40, strategic: 30 },
    mapPosition: { x: 34, y: 20 },
    requires: ['sector-brussels'],
    region: 'Netherlands',
    difficulty: 2
  },
  {
    id: 'sector-copenhagen',
    name: 'Copenhagen Strait',
    brief: 'The Baltic access point. Secure it to prevent naval flanking.',
    scenarioId: 'crossroads-defense',
    timer: 7,
    reward: { money: 150, research: 50, strategic: 35 },
    mapPosition: { x: 48, y: 15 },
    requires: ['sector-amsterdam'],
    region: 'Denmark',
    difficulty: 2
  },
  // === EASTERN FRONT (Poland/Czech/Ukraine) - Enemy strongholds ===
  {
    id: 'sector-prague',
    name: 'Prague Underground',
    brief: 'Ancient catacombs hide a dark ritual. Descend and disrupt it.',
    scenarioId: 'outpost-night',
    timer: 9,
    reward: { money: 170, research: 65, strategic: 50 },
    mapPosition: { x: 52, y: 35 },
    requires: ['sector-vienna'],
    region: 'Czech Republic',
    difficulty: 3
  },
  {
    id: 'sector-berlin',
    name: 'Berlin Ruins',
    brief: 'The fallen capital. Push through the devastation to reclaim the heart of Europe.',
    scenarioId: 'black-spire-assault',
    timer: 8,
    reward: { money: 200, research: 70, strategic: 55 },
    mapPosition: { x: 50, y: 25 },
    requires: ['sector-prague', 'sector-copenhagen'],
    region: 'Germany',
    difficulty: 4
  },
  {
    id: 'sector-warsaw',
    name: 'Warsaw Front',
    brief: 'The eastern defense line. Polish forces need immediate reinforcement.',
    scenarioId: 'bridgehead',
    timer: 10,
    reward: { money: 190, research: 75, strategic: 60 },
    mapPosition: { x: 62, y: 30 },
    requires: ['sector-berlin'],
    region: 'Poland',
    difficulty: 4
  },
  {
    id: 'sector-krakow',
    name: 'Krakow Citadel',
    brief: 'An ancient fortress converted to a portal nexus. Assault and seal it.',
    scenarioId: 'black-spire-assault',
    timer: 11,
    reward: { money: 220, research: 80, strategic: 65 },
    mapPosition: { x: 60, y: 40 },
    requires: ['sector-warsaw', 'sector-vienna'],
    region: 'Poland',
    difficulty: 4
  },
  // === DEEP EASTERN FRONT (Ukraine/Russia border) - Final objectives ===
  {
    id: 'sector-kyiv',
    name: 'Kyiv Siege',
    brief: 'The largest city still standing in the east. A critical strategic target.',
    scenarioId: 'outpost-night',
    timer: 12,
    reward: { money: 250, research: 90, strategic: 70 },
    mapPosition: { x: 75, y: 35 },
    requires: ['sector-krakow'],
    region: 'Ukraine',
    difficulty: 5
  },
  {
    id: 'sector-carpathian',
    name: 'Carpathian Pass',
    brief: 'Mountain passages crawling with enemy patrols. Clear the route.',
    scenarioId: 'crossroads-defense',
    timer: 10,
    reward: { money: 180, research: 70, strategic: 55 },
    mapPosition: { x: 68, y: 48 },
    requires: ['sector-krakow'],
    region: 'Ukraine',
    difficulty: 4
  },
  {
    id: 'sector-blacksea',
    name: 'Black Sea Coast',
    brief: 'Secure the southern flank. Naval demons are emerging from the depths.',
    scenarioId: 'bridgehead',
    timer: 11,
    reward: { money: 200, research: 75, strategic: 60 },
    mapPosition: { x: 72, y: 58 },
    requires: ['sector-carpathian'],
    region: 'Ukraine',
    difficulty: 4
  },
  // === FINAL OBJECTIVES ===
  {
    id: 'sector-rift',
    name: 'The Eastern Rift',
    brief: 'The main invasion portal. Destroy it to turn the tide of war.',
    scenarioId: 'black-spire-assault',
    timer: 15,
    reward: { money: 500, research: 150, strategic: 100 },
    mapPosition: { x: 85, y: 40 },
    requires: ['sector-kyiv', 'sector-blacksea'],
    region: 'The Rift',
    difficulty: 5
  }
];

export const starterCampaign: CampaignSpec = {
  id: 'starter',
  name: 'First Contact',
  description: 'Reform scattered units, secure ground, and punch a corridor through the invasion.',
  startingResources: {
    money: 260,
    research: 80,
    strategic: 40
  },
  startingResearch: ['optics-i'],
  startingUnits: [
    { id: 'captain', definitionId: 'john-alexander', tier: 'elite', experience: 60 },
    { id: 'lance-1', definitionId: 'light-infantry', tier: 'veteran', experience: 20 },
    { id: 'lance-2', definitionId: 'light-infantry', tier: 'rookie', experience: 0 },
    { id: 'recon-1', definitionId: 'rangers', tier: 'veteran', experience: 30 },
    { id: 'apc-1', definitionId: 'm113', tier: 'rookie', experience: 0 },
    { id: 'medic-1', definitionId: 'field-medic', tier: 'rookie', experience: 0 }
  ],
  territories: starterTerritories
};

export const starterBundle: ContentBundle = {
  units: starterUnits,
  research: starterResearch,
  scenarios: starterScenarios,
  territories: starterTerritories,
  campaigns: [starterCampaign]
};

export const validatedStarterBundle = loadContentBundle(starterBundle);
