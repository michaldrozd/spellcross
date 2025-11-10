import type {
  BattlefieldMap,
  CreateBattleStateOptions,
  UnitDefinition
} from '@spellcross/core';

const mapWidth = 12;
const mapHeight = 10;

const plainTile = {
  terrain: 'plain',
  elevation: 0,
  cover: 1,
  movementCostModifier: 1,
  passable: true,
  providesVisionBoost: false
} as const;

export const sandboxMap: BattlefieldMap = {
  id: 'tutorial-field',
  width: mapWidth,
  height: mapHeight,
  tiles: Array.from({ length: mapWidth * mapHeight }, () => ({ ...plainTile }))
};


// Auto-bake slopes for all 1-level elevation differences unless explicitly marked as wall
function autoBakeSlopes(map: BattlefieldMap) {
  const W = map.width, H = map.height;
  const idx = (q:number,r:number)=> r*W+q;
  const inb = (q:number,r:number)=> q>=0 && r>=0 && q<W && r<H;
  const opp = {N:'S',E:'W',S:'N',W:'E'} as const;
  const dvec = {N:[0,-1],E:[1,0],S:[0,1],W:[-1,0]} as const;
  for (let r=0;r<H;r++) for (let q=0;q<W;q++) {
    const A:any = map.tiles[idx(q,r)];
    for (const dir of ['N','E','S','W'] as const) {
      const [dq,dr] = dvec[dir]; const q2=q+dq, r2=r+dr;
      if (!inb(q2,r2)) continue;
      const B:any = map.tiles[idx(q2,r2)];
      const d = (A.elevation??0) - (B.elevation??0);
      if (d===1) {
        // prefer slope unless someone explicitne oznacil wall
        if (A.elevEdges?.[dir] !== 'wall' && B.elevEdges?.[opp[dir]] !== 'wall') {
          A.elevEdges = { ...(A.elevEdges??{}), [dir]:'slope' };
        }
      }
    }
  }
}

// --- Elevation testbed near spawn: mix of cliffs and a small ramp (slope) ---
(function setupSandboxElevation() {
  const idx = (q: number, r: number) => r * mapWidth + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < mapWidth && r < mapHeight;
  const setTile = (q: number, r: number, t: Partial<(typeof sandboxMap)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(sandboxMap.tiles[idx(q, r)], t);
  };
  const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => {
    if (!inb(q, r)) return;
    const t: any = sandboxMap.tiles[idx(q, r)];
    t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style };
  };

  // Rozšírené testy prevýšení pri spawne:
  // Veľká plošina 6x3 (elev=1)
  for (let q = 4; q <= 9; q++) {
    for (let r = 2; r <= 4; r++) {
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }
  // Rampy (S) na južnej hrane plošiny – 4 dlaždice uprostred
  for (let q = 5; q <= 8; q++) markEdge(q, 4, 'S', 'slope');
  // Rampy (E) na východnej hrane plošiny – 2 dlaždice
  markEdge(9, 3, 'E', 'slope');


  markEdge(9, 4, 'E', 'slope');

  // Vnútorná terasa (elev=2) 2x1 na hornej hrane plošiny
  for (let q = 6; q <= 7; q++) {
    setTile(q, 3, { terrain: 'hill', elevation: 2, cover: 1, providesVisionBoost: true });
  }
  // Z terasy zjazd (S) a (E)
  markEdge(6, 3, 'S', 'slope');
  markEdge(7, 3, 'S', 'slope');
  markEdge(7, 3, 'E', 'slope');

  // Druhá, samostatná kopa 3x3 (elev=1) dolu-vľavo s rôznymi rampami
  for (let q = 1; q <= 3; q++) {
    for (let r = 6; r <= 8; r++) {
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }
  // Rampy pre túto kopu: dve na juh (S) a dve na východ (E)
  markEdge(2, 8, 'S', 'slope');
  markEdge(1, 8, 'S', 'slope');
  markEdge(3, 7, 'E', 'slope');
  markEdge(3, 8, 'E', 'slope');

  // Ostatné hrany zostávajú implicitne "cliff" (renderer nakreslí stenu, pathfinding ich nepovolí).
})();



// Bake default slopes along 1-step elevation differences (makes 1-level edges ramps by default)
autoBakeSlopes(sandboxMap);

const lightInfantry: UnitDefinition = {
  id: 'light-infantry',
  faction: 'alliance',
  name: 'Light Infantry',
  type: 'infantry',
  stats: {
    maxHealth: 100,
    mobility: 6,
    vision: 4,
    armor: 1,
    morale: 60,
    weaponRanges: { rifle: 5 },
    weaponPower: { rifle: 12 },
    weaponAccuracy: { rifle: 0.75 }
  }
};

const impRaiders: UnitDefinition = {
  id: 'imp-raiders',
  faction: 'otherSide',
  name: 'Imp Raiders',
  type: 'infantry',
  stats: {
    maxHealth: 70,
    mobility: 7,
    vision: 3,
    armor: 0.5,
    morale: 40,
    weaponRanges: { claws: 1 },
    weaponPower: { claws: 8 },
    weaponAccuracy: { claws: 0.55 }
  }
};

export const sandboxBattleSpec: CreateBattleStateOptions = {
  map: sandboxMap,
  sides: [
    {
      faction: 'alliance',
      units: [
        {
          definition: lightInfantry,
          coordinate: { q: 3, r: 3 }
        },
        {
          definition: lightInfantry,
          coordinate: { q: 4, r: 4 }
        }
      ]
    },
    {
      faction: 'otherSide',
      units: [
        {
          definition: impRaiders,
          coordinate: { q: 7, r: 4 }
        }
      ]
    }
  ],
  startingFaction: 'alliance'
};


export function makeSandboxSpec(opts: { width?: number; height?: number } = {}) {
  const width = Math.max(2, opts.width ?? mapWidth);
  const height = Math.max(2, opts.height ?? mapHeight);
  const map: BattlefieldMap = {
    id: `sandbox-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  // Keep allied units near top-left, enemy towards right-middle, clamped within bounds
  const ally1 = { q: Math.min(3, width - 1), r: Math.min(3, height - 1) };
  const ally2 = { q: Math.min(4, width - 1), r: Math.min(4, height - 1) };
  const enemy = {
    q: Math.min(Math.max(7, Math.floor(width * 0.6)), width - 1),
    r: Math.min(Math.max(4, Math.floor(height * 0.4)), height - 1)
  };

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      {
        faction: 'alliance',
        units: [
          { definition: lightInfantry, coordinate: ally1 },
          { definition: lightInfantry, coordinate: ally2 }
        ]
      },
      {
        faction: 'otherSide',
        units: [{ definition: impRaiders, coordinate: enemy }]
      }
    ],
    startingFaction: 'alliance'
  };

  return spec;
}


// Mega scenario: large map with diverse terrain and many units for thorough testing
export function makeMegaSandboxSpec(opts: { width?: number; height?: number } = {}) {
  const width = Math.max(40, opts.width ?? 160);
  const height = Math.max(32, opts.height ?? 110);

  const map: BattlefieldMap = {
    id: `mega-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  const idx = (q: number, r: number) => r * width + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;

  // Helpers to stamp terrain quickly
  const setTile = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(map.tiles[idx(q, r)], t);
  };

  // Hills ridge across the map (elevation & vision boost)
  for (let r = 4; r < height - 4; r++) {
    const center = Math.floor(width * 0.45 + Math.sin(r / 8) * 6);
    for (let dq = -2; dq <= 2; dq++) {
      const q = center + dq;
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }

  // Meandering river (only air can traverse per terrain rules)
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.62 + Math.sin(r / 7) * 5);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }


  // Second river to increase variety
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.35 + Math.cos(r / 9) * 6);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }

  // Extra forest seeds for denser clusters
  const extraForest = [
    { q: Math.floor(width * 0.48), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.55), r: Math.floor(height * 0.75) },
    { q: Math.floor(width * 0.70), r: Math.floor(height * 0.35) },
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.85) }
  ];
  for (const s of extraForest) {
    for (let dr = -5; dr <= 5; dr++) {
      for (let dq = -5; dq <= 5; dq++) {
        if (Math.hypot(dq, dr) <= 5.4) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Fortification line made of destructible structures
  const fortQ = Math.floor(width * 0.50);
  for (let r = Math.floor(height * 0.30); r < Math.floor(height * 0.70); r++) {
    for (let dq = -1; dq <= 1; dq++) {
      setTile(fortQ + dq, r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 20 });
    }
  }

  // Forest clusters (infantry favored)
  const forestSeeds = [
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.20), r: Math.floor(height * 0.65) },
    { q: Math.floor(width * 0.35), r: Math.floor(height * 0.40) }
  ];
  for (const s of forestSeeds) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        if (Math.hypot(dq, dr) <= 4.2) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Swamp region (slow, open)
  for (let r = Math.floor(height * 0.70); r < height - 2; r++) {
    for (let q = Math.floor(width * 0.70); q < width - 2; q++) {
      setTile(q, r, { terrain: 'swamp', movementCostModifier: 1.6, cover: 0 });
    }
  }

  // Town with destructible structures and surrounding urban cover
  const townQ0 = Math.floor(width * 0.30);
  const townR0 = Math.floor(height * 0.45);
  for (let r = 0; r < 8; r++) {
    for (let q = 0; q < 14; q++) {
      const atEdge = r === 0 || r === 7 || q === 0 || q === 13;
      if (atEdge) {
        setTile(townQ0 + q, townR0 + r, { terrain: 'urban', cover: 2, passable: true });
      } else {
        setTile(townQ0 + q, townR0 + r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 18 });
      }
    }
  }

  // Simple road from west -> town -> east
  for (let q = 2; q < width - 2; q++) setTile(q, Math.floor(height * 0.55), { terrain: 'road', movementCostModifier: 0.85, cover: 0 });

  // Unit definitions (concise)
  const mk = (id: string, type: UnitDefinition['type'], base: Partial<UnitDefinition['stats']> & { weaponRanges: any; weaponPower: any; weaponAccuracy: any; weaponTargets?: any }) => ({
    id, faction: 'alliance' as const, name: id, type,
    stats: { maxHealth: 100, mobility: 6, vision: 4, armor: 1, morale: 60, ...base }
  }) as UnitDefinition;
  const mkEnemy = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'otherSide' as const, name: id, type,
    stats: { maxHealth: 90, mobility: 6, vision: 4, armor: 1, morale: 55, ...base }
  }) as UnitDefinition;

  const allyInf = mk('ally-infantry', 'infantry', { weaponRanges: { rifle: 5 }, weaponPower: { rifle: 12 }, weaponAccuracy: { rifle: 0.75 } });
  const allyTank = mk('ally-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 24 }, weaponAccuracy: { cannon: 0.65 } });
  const allyArt = mk('ally-artillery', 'artillery', { weaponRanges: { howitzer: 8 }, weaponPower: { howitzer: 20 }, weaponAccuracy: { howitzer: 0.5 } });
  const allyAA = mk('ally-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.9 }, weaponTargets: { aa: ['air'] } });
  const allyAir = mk('ally-air', 'air', { mobility: 9, weaponRanges: { rockets: 3 }, weaponPower: { rockets: 18 }, weaponAccuracy: { rockets: 0.7 } });
  const allyHero = mk('ally-hero', 'hero', { weaponRanges: { sabre: 1 }, weaponPower: { sabre: 6 }, weaponAccuracy: { sabre: 1.0 } });

  const imp = mkEnemy('imp-raiders', 'infantry', { weaponRanges: { claws: 1 }, weaponPower: { claws: 8 }, weaponAccuracy: { claws: 0.55 } });
  const orc = mkEnemy('orc-grunts', 'infantry', { maxHealth: 110, armor: 1.2, weaponRanges: { axe: 1 }, weaponPower: { axe: 10 }, weaponAccuracy: { axe: 0.6 } });
  const enemyTank = mkEnemy('enemy-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 22 }, weaponAccuracy: { cannon: 0.6 } });
  const enemyArt = mkEnemy('enemy-artillery', 'artillery', { weaponRanges: { mortar: 7 }, weaponPower: { mortar: 18 }, weaponAccuracy: { mortar: 0.5 } });
  const enemyAA = mkEnemy('enemy-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.85 }, weaponTargets: { aa: ['air'] } });
  const enemyAir = mkEnemy('enemy-air', 'air', { mobility: 9, weaponRanges: { sting: 2 }, weaponPower: { sting: 14 }, weaponAccuracy: { sting: 0.7 } });

  // Spawn groups
  const clamp = (q: number, r: number) => ({ q: Math.max(0, Math.min(width - 1, q)), r: Math.max(0, Math.min(height - 1, r)) });
  let allies = [
    { definition: allyHero, coordinate: clamp(6, Math.floor(height * 0.55) - 2) },
    { definition: allyInf, coordinate: clamp(8, Math.floor(height * 0.55)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.50)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.60)) },
    { definition: allyTank, coordinate: clamp(12, Math.floor(height * 0.58)) },
    { definition: allyTank, coordinate: clamp(13, Math.floor(height * 0.52)) },
    { definition: allyArt, coordinate: clamp(10, Math.floor(height * 0.65)) },
    { definition: allyAA, coordinate: clamp(11, Math.floor(height * 0.48)) },
    { definition: allyAir, coordinate: clamp(7, Math.floor(height * 0.40)) }
  ];

  // Reinforcements: infantry line and support near road
  for (let i = 0; i < 8; i++) {
    allies.push({ definition: allyInf, coordinate: clamp(16 + i * 2, Math.floor(height * 0.55) + ((i % 3) - 1) * 2) });
  }
  for (let i = 0; i < 3; i++) {
    allies.push({ definition: allyTank, coordinate: clamp(20 + i * 3, Math.floor(height * 0.58) - i) });
  }
  for (let i = 0; i < 2; i++) {
    allies.push({ definition: allyArt, coordinate: clamp(14 + i * 2, Math.floor(height * 0.66) + i) });
  }
  allies.push({ definition: allyAA, coordinate: clamp(18, Math.floor(height * 0.48)) });
  allies.push({ definition: allyAA, coordinate: clamp(22, Math.floor(height * 0.50)) });
  allies.push({ definition: allyAir, coordinate: clamp(12, Math.floor(height * 0.38)) });

  let enemies = [
    { definition: impRaiders, coordinate: clamp(Math.floor(width * 0.78), Math.floor(height * 0.52)) },
    { definition: imp, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.55)) },
    { definition: orc, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.58)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.86), Math.floor(height * 0.60)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.88), Math.floor(height * 0.50)) },
    { definition: enemyArt, coordinate: clamp(Math.floor(width * 0.84), Math.floor(height * 0.66)) },
    { definition: enemyAA, coordinate: clamp(Math.floor(width * 0.90), Math.floor(height * 0.48)) },
    { definition: enemyAir, coordinate: clamp(Math.floor(width * 0.92), Math.floor(height * 0.40)) }
  ];

  // Enemy reinforcements: defensive line behind fortification and air patrols
  for (let i = 0; i < 10; i++) {
    enemies.push({ definition: orc, coordinate: clamp(Math.floor(width * 0.72) + (i % 3) * 2, Math.floor(height * 0.52) + ((i % 5) - 2) * 2) });
  }
  for (let i = 0; i < 4; i++) {
    enemies.push({ definition: enemyTank, coordinate: clamp(Math.floor(width * 0.76) + i * 2, Math.floor(height * 0.60) - i) });
  }
  for (let i = 0; i < 2; i++) {
    enemies.push({ definition: enemyArt, coordinate: clamp(Math.floor(width * 0.74) + i * 2, Math.floor(height * 0.66) + i) });
  }
  enemies.push({ definition: enemyAA, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.50)) });
  enemies.push({ definition: enemyAA, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.48)) });
  enemies.push({ definition: enemyAir, coordinate: clamp(Math.floor(width * 0.85), Math.floor(height * 0.40)) });


  // Auto-bake 1-step slopes across the stamped terrain for Spellcross-like bevels
  autoBakeSlopes(map);

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      { faction: 'alliance', units: allies },
      { faction: 'otherSide', units: enemies }
    ],


    startingFaction: 'alliance'
  };

  return spec;
}


// Large scenario: approximately half the size of mega, reusing the same stamping pattern
export function makeLargeSandboxSpec(opts: { width?: number; height?: number } = {}) {
  // Default roughly half of mega's 160x110
  const width = Math.max(40, opts.width ?? 80);
  const height = Math.max(32, opts.height ?? 55);

  const map: BattlefieldMap = {
    id: `large-${width}x${height}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ ...plainTile }))
  };

  const idx = (q: number, r: number) => r * width + q;
  const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
  const setTile = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => {
    if (!inb(q, r)) return;
    Object.assign(map.tiles[idx(q, r)], t);
  };


	  // Elevation testbed near start: small plateau with a 2-tile ramp (slopes) and cliffs elsewhere
	  (function stampStartPlateau() {
	    const idx = (q: number, r: number) => r * width + q;
	    const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
	    const setT = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => { if (!inb(q,r)) return; Object.assign(map.tiles[idx(q,r)], t); };
	    const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => {
	      if (!inb(q,r)) return; const t: any = map.tiles[idx(q,r)]; t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style };
	    };
	    const baseQ = Math.max(3, Math.floor(width * 0.18));
	    const baseR = Math.max(3, Math.floor(height * 0.55) - 2);
	    for (let q = baseQ + 1; q <= baseQ + 4; q++) {
	      for (let r = baseR; r <= baseR + 1; r++) {
	        setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
	      }
	    }
	    // add a 2-tile ramp on the south edge of the plateau
	    markEdge(baseQ + 2, baseR + 1, 'S', 'slope');
	    markEdge(baseQ + 3, baseR + 1, 'S', 'slope');
	  })();

		  // --- Extend start area with larger plateaus/ramps for broader testing ---
		  (function extendStartElevation() {
		    const idx = (q: number, r: number) => r * width + q;
		    const inb = (q: number, r: number) => q >= 0 && r >= 0 && q < width && r < height;
		    const setT = (q: number, r: number, t: Partial<(typeof map)["tiles"][number]>) => { if (!inb(q,r)) return; Object.assign(map.tiles[idx(q,r)], t); };
		    const markEdge = (q: number, r: number, dir: 'N'|'E'|'S'|'W', style: 'wall'|'slope'|'none') => { if (!inb(q,r)) return; const t: any = map.tiles[idx(q,r)]; t.elevEdges = { ...(t.elevEdges ?? {}), [dir]: style }; };
		    const baseQ = Math.max(3, Math.floor(width * 0.18));
		    const baseR = Math.max(3, Math.floor(height * 0.55) - 2);

		    // Bigger plateau 6x3 (elev=1) overlapping/expanding the small one
		    for (let q = baseQ + 1; q <= baseQ + 6; q++) {
		      for (let r = baseR; r <= baseR + 2; r++) {
		        setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
		      }
		    }
		    // South-edge ramps across middle (S)
		    for (let q = baseQ + 2; q <= baseQ + 5; q++) markEdge(q, baseR + 2, 'S', 'slope');
		    // East-edge ramps (E) on the plateau's east face
		    for (let r = baseR; r <= baseR + 2; r++) markEdge(baseQ + 6, r, 'E', 'slope');

		    // Inner terrace 2x1 at top row (elev=2) with S/E ramps
		    for (let q = baseQ + 3; q <= baseQ + 4; q++) setT(q, baseR, { terrain: 'hill', elevation: 2, cover: 1, providesVisionBoost: true });
		    markEdge(baseQ + 3, baseR, 'S', 'slope');
		    markEdge(baseQ + 4, baseR, 'S', 'slope');
		    markEdge(baseQ + 4, baseR, 'E', 'slope');

		    // Separate 3x3 hill southwest with mixed S/E ramps
		    for (let q = baseQ - 3; q <= baseQ - 1; q++) {
		      for (let r = baseR + 3; r <= baseR + 5; r++) setT(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
		    }
		    markEdge(baseQ - 2, baseR + 5, 'S', 'slope');
		    markEdge(baseQ - 3, baseR + 5, 'S', 'slope');
		    markEdge(baseQ - 1, baseR + 4, 'E', 'slope');
		    markEdge(baseQ - 1, baseR + 5, 'E', 'slope');

		    // Ramp walkway: 5 tiles in a row (elev=1) each with E ramp to ground
		    for (let q = baseQ + 8; q <= baseQ + 12; q++) {
		      setT(q, baseR + 3, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: false });
		      markEdge(q, baseR + 3, 'E', 'slope');
		    }
		  })();


  // Hills ridge
  for (let r = 3; r < height - 3; r++) {
    const center = Math.floor(width * 0.45 + Math.sin(r / 7) * 4);
    for (let dq = -2; dq <= 2; dq++) {
      const q = center + dq;
      setTile(q, r, { terrain: 'hill', elevation: 1, cover: 1, providesVisionBoost: true });
    }
  }

  // Two meandering rivers
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.62 + Math.sin(r / 6) * 3);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }
  for (let r = 0; r < height; r++) {
    const q0 = Math.floor(width * 0.35 + Math.cos(r / 8) * 4);
    for (let w = 0; w < 2; w++) setTile(q0 + w, r, { terrain: 'water', cover: 0, movementCostModifier: 1, passable: true });
  }

  // Forest clusters
  const forestSeeds = [
    { q: Math.floor(width * 0.15), r: Math.floor(height * 0.20) },
    { q: Math.floor(width * 0.22), r: Math.floor(height * 0.65) },
    { q: Math.floor(width * 0.36), r: Math.floor(height * 0.42) },
  ];
  for (const s of forestSeeds) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dq = -4; dq <= 4; dq++) {
        if (Math.hypot(dq, dr) <= 4.0) setTile(s.q + dq, s.r + dr, { terrain: 'forest', cover: 2 });
      }
    }
  }

  // Town block
  const townQ0 = Math.floor(width * 0.30);
  const townR0 = Math.floor(height * 0.45);
  const townH = Math.min(6, Math.floor(height * 0.12));
  const townW = Math.min(12, Math.floor(width * 0.15));
  for (let r = 0; r < townH; r++) {
    for (let q = 0; q < townW; q++) {
      const atEdge = r === 0 || r === townH - 1 || q === 0 || q === townW - 1;
      if (atEdge) setTile(townQ0 + q, townR0 + r, { terrain: 'urban', cover: 2, passable: true });
      else setTile(townQ0 + q, townR0 + r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 16 });
    }
  }

  // Swamp corner
  for (let r = Math.floor(height * 0.70); r < height - 1; r++) {
    for (let q = Math.floor(width * 0.68); q < width - 1; q++) {
      setTile(q, r, { terrain: 'swamp', movementCostModifier: 1.6, cover: 0 });
    }
  }

  // Road across map
  for (let q = 1; q < width - 1; q++) setTile(q, Math.floor(height * 0.55), { terrain: 'road', movementCostModifier: 0.85, cover: 0 });

  // Fortification line
  const fortQ = Math.floor(width * 0.50);
  for (let r = Math.floor(height * 0.30); r < Math.floor(height * 0.70); r++) {
    for (let dq = -1; dq <= 1; dq++) {
      setTile(fortQ + dq, r, { terrain: 'structure', cover: 3, passable: false, destructible: true, hp: 18 });
    }
  }

  // Unit factories (like mega but fewer totals)
  const mk = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'alliance' as const, name: id, type,
    stats: { maxHealth: 100, mobility: 6, vision: 4, armor: 1, morale: 60, ...base }
  }) as UnitDefinition;
  const mkEnemy = (id: string, type: UnitDefinition['type'], base: any) => ({
    id, faction: 'otherSide' as const, name: id, type,
    stats: { maxHealth: 90, mobility: 6, vision: 4, armor: 1, morale: 55, ...base }
  }) as UnitDefinition;

  const allyInf = mk('ally-infantry', 'infantry', { weaponRanges: { rifle: 5 }, weaponPower: { rifle: 12 }, weaponAccuracy: { rifle: 0.75 } });
  const allyTank = mk('ally-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 24 }, weaponAccuracy: { cannon: 0.65 } });
  const allyArt = mk('ally-artillery', 'artillery', { weaponRanges: { howitzer: 8 }, weaponPower: { howitzer: 20 }, weaponAccuracy: { howitzer: 0.5 } });
  const allyAA = mk('ally-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.9 }, weaponTargets: { aa: ['air'] } });
  const allyAir = mk('ally-air', 'air', { mobility: 9, weaponRanges: { rockets: 3 }, weaponPower: { rockets: 18 }, weaponAccuracy: { rockets: 0.7 } });
  const allyHero = mk('ally-hero', 'hero', { weaponRanges: { sabre: 1 }, weaponPower: { sabre: 6 }, weaponAccuracy: { sabre: 1.0 } });

  const imp = mkEnemy('imp-raiders', 'infantry', { weaponRanges: { claws: 1 }, weaponPower: { claws: 8 }, weaponAccuracy: { claws: 0.55 } });
  const orc = mkEnemy('orc-grunts', 'infantry', { maxHealth: 110, armor: 1.2, weaponRanges: { axe: 1 }, weaponPower: { axe: 10 }, weaponAccuracy: { axe: 0.6 } });
  const enemyTank = mkEnemy('enemy-tank', 'vehicle', { armor: 3, weaponRanges: { cannon: 6 }, weaponPower: { cannon: 22 }, weaponAccuracy: { cannon: 0.6 } });
  const enemyArt = mkEnemy('enemy-artillery', 'artillery', { weaponRanges: { mortar: 7 }, weaponPower: { mortar: 18 }, weaponAccuracy: { mortar: 0.5 } });
  const enemyAA = mkEnemy('enemy-aa', 'support', { weaponRanges: { aa: 4 }, weaponPower: { aa: 10 }, weaponAccuracy: { aa: 0.85 }, weaponTargets: { aa: ['air'] } });
  const enemyAir = mkEnemy('enemy-air', 'air', { mobility: 9, weaponRanges: { sting: 2 }, weaponPower: { sting: 14 }, weaponAccuracy: { sting: 0.7 } });

  const clamp = (q: number, r: number) => ({ q: Math.max(0, Math.min(width - 1, q)), r: Math.max(0, Math.min(height - 1, r)) });

  let allies = [
    { definition: allyHero, coordinate: clamp(6, Math.floor(height * 0.55) - 2) },
    { definition: allyInf, coordinate: clamp(8, Math.floor(height * 0.55)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.50)) },
    { definition: allyInf, coordinate: clamp(9, Math.floor(height * 0.60)) },
    { definition: allyTank, coordinate: clamp(12, Math.floor(height * 0.58)) },
    { definition: allyArt, coordinate: clamp(10, Math.floor(height * 0.65)) },
    { definition: allyAA, coordinate: clamp(11, Math.floor(height * 0.48)) },
    { definition: allyAir, coordinate: clamp(7, Math.floor(height * 0.40)) },
  ];

  // Fewer reinforcements than mega
  for (let i = 0; i < 5; i++) allies.push({ definition: allyInf, coordinate: clamp(14 + i * 2, Math.floor(height * 0.55) + ((i % 3) - 1) * 2) });
  for (let i = 0; i < 2; i++) allies.push({ definition: allyTank, coordinate: clamp(18 + i * 3, Math.floor(height * 0.58) - i) });
  allies.push({ definition: allyArt, coordinate: clamp(14, Math.floor(height * 0.66)) });
  allies.push({ definition: allyAA, coordinate: clamp(18, Math.floor(height * 0.48)) });

  let enemies = [
    { definition: imp, coordinate: clamp(Math.floor(width * 0.78), Math.floor(height * 0.52)) },
    { definition: orc, coordinate: clamp(Math.floor(width * 0.80), Math.floor(height * 0.55)) },
    { definition: enemyTank, coordinate: clamp(Math.floor(width * 0.84), Math.floor(height * 0.58)) },
    { definition: enemyArt, coordinate: clamp(Math.floor(width * 0.82), Math.floor(height * 0.66)) },
    { definition: enemyAA, coordinate: clamp(Math.floor(width * 0.88), Math.floor(height * 0.48)) },
    { definition: enemyAir, coordinate: clamp(Math.floor(width * 0.90), Math.floor(height * 0.40)) },
  ];

  // Auto-bake 1-step slopes across the stamped terrain for Spellcross-like bevels
  autoBakeSlopes(map);

  for (let i = 0; i < 6; i++) enemies.push({ definition: orc, coordinate: clamp(Math.floor(width * 0.72) + (i % 3) * 2, Math.floor(height * 0.52) + ((i % 5) - 2) * 2) });
  for (let i = 0; i < 2; i++) enemies.push({ definition: enemyTank, coordinate: clamp(Math.floor(width * 0.76) + i * 2, Math.floor(height * 0.60) - i) });

  const spec: CreateBattleStateOptions = {
    map,
    sides: [
      { faction: 'alliance', units: allies },
      { faction: 'otherSide', units: enemies }
    ],
    startingFaction: 'alliance'
  };

  return spec;
}

