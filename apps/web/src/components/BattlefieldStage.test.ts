import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TERRAIN_GRID_ALPHA,
  TERRAIN_WASH_VISIBILITY_RADIUS,
  buildingVisibilityPresentation,
  presentationTerrainAt,
  proceduralBuildingUnderlayTerrain,
  scenarioEventVisualStyle,
  softShadowLayers,
  smoothTerrainNoise,
  terrainDestructionRevision,
  terrainDetailDensity,
  terrainDetailFamily,
  terrainMacroPattern,
  terrainTextureWorldUnitsPerTexel,
  worldTextureMatrix
} from './BattlefieldStage.js';
import {
  activeKillingEffectForTarget,
  combatImpactWindowMs,
  combatEffectTypeForWeapon,
  deathMarkerExpired,
  deathMarkerVisible
} from './combatVisuals.js';
import {
  DIRECTIONAL_UNIT_ANCHOR_Y,
  DIRECTIONAL_UNIT_GROUND_BIAS,
  DIRECTIONAL_UNIT_SOURCE_HEIGHTS,
  DIRECTIONAL_UNIT_SPRITES,
  battlefieldDirectionalSprite,
  blockedRangeOverlayStyle,
  canMovingUnitFadeCanopy,
  deathMarkerDetailVisible,
  deathMarkerSpriteTransform,
  deathMarkerVisualClass,
  quantizeMovementOcclusionCoordinate,
  directionalSpriteGroundOffset,
  directionNameForOrientation,
  directionNameForScreenVector,
  featheredOcclusionAlpha,
  isSupportVehicleDefinition,
  infantryGroundMotion,
  leavesMechanicalWreck,
  rasterUnitOverride,
  rasterVehiclePose,
  rangeOverlayStyle,
  resolveMovementFrame,
  unitContactFootprint,
  unitVisualHeight,
  VEHICLE_TURN_DURATION_MS,
  vehicleDustEnvelope,
  vehicleGearPhase,
  vehicleMotionEnvelope,
  vehicleRunningGearKind,
  vehicleSheetDirectionNameForOrientation,
  vehicleSheetDirectionNameForScreenVector,
  vehicleTurnSheetBlend,
  vehicleTurnCrossfade,
  vehicleTurnRotation,
  vehicleTurnScaleX,
  vehicleTurnScaleY
} from './unitVisuals.js';

const APC_SHEET_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

describe('terrain and fog presentation', () => {
  it('gives objective, terrain, and pressure events distinct visual languages', () => {
    const styles = [
      scenarioEventVisualStyle('revealObjective'),
      scenarioEventVisualStyle('transformTerrain'),
      scenarioEventVisualStyle('pressurePulse')
    ];

    expect(new Set(styles.map((style) => style.primary)).size).toBe(3);
    expect(new Set(styles.map((style) => style.glow)).size).toBe(3);
    expect(styles.map((style) => style.shape)).toEqual(['beacon', 'fracture', 'rings']);
  });

  it('keeps remembered buildings solid and muted while preserving visible-unit occlusion', () => {
    const rememberedBehindUnit = buildingVisibilityPresentation(false, 0.2);
    const rememberedAlone = buildingVisibilityPresentation(false, 1);
    const rgb = [
      (rememberedAlone.spriteTint >> 16) & 0xff,
      (rememberedAlone.spriteTint >> 8) & 0xff,
      rememberedAlone.spriteTint & 0xff
    ];

    expect(rememberedAlone).toMatchObject({
      containerAlpha: 1,
      spriteAlpha: 1,
      shadowStrength: 0.72
    });
    expect(Math.max(...rgb) - Math.min(...rgb)).toBeLessThanOrEqual(16);
    expect(rememberedBehindUnit).toMatchObject({
      containerAlpha: 0.2,
      spriteAlpha: rememberedAlone.spriteAlpha,
      spriteTint: rememberedAlone.spriteTint
    });
  });

  it('keeps visible-building occlusion behavior unchanged', () => {
    expect(buildingVisibilityPresentation(true, 0.2)).toMatchObject({
      containerAlpha: 0.2,
      spriteAlpha: 1,
      spriteTint: 0xf2ead8
    });
    expect(buildingVisibilityPresentation(true, 1).containerAlpha).toBe(1);
  });

  it('uses deterministic, smoothly varying terrain grades', () => {
    const samples = Array.from({ length: 16 }, (_, index) => smoothTerrainNoise(index, 7, 911, 4.2));
    const repeated = Array.from({ length: 16 }, (_, index) => smoothTerrainNoise(index, 7, 911, 4.2));
    const largestNeighborStep = Math.max(...samples.slice(1).map((sample, index) => Math.abs(sample - samples[index])));

    expect(repeated).toEqual(samples);
    expect(largestNeighborStep).toBeLessThan(0.3);
    expect(samples.every((sample) => sample >= 0 && sample <= 1)).toBe(true);
  });

  it('authors a deterministic, seamless macro pattern for all three terrain families', () => {
    expect(terrainDetailFamily('plain')).toBe('vegetation');
    expect(terrainDetailFamily('road')).toBe('built');
    expect(terrainDetailFamily('water')).toBe('wet');

    const samples = Array.from({ length: 16 * 16 }, (_, index) => (
      terrainMacroPattern((index % 16) / 16, Math.floor(index / 16) / 16)
    ));
    const repeated = Array.from({ length: 16 * 16 }, (_, index) => (
      terrainMacroPattern((index % 16) / 16, Math.floor(index / 16) / 16)
    ));

    expect(repeated).toEqual(samples);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.5);
    expect(terrainMacroPattern(0.23, 0.67)).toBeCloseTo(terrainMacroPattern(1.23, 1.67), 10);
  });

  it('maps shared tile edges to the same world texture coordinate', () => {
    const leftUvs = worldTextureMatrix(100, 50, 3.2).invert().apply({ x: 20, y: 10 });
    const rightUvs = worldTextureMatrix(140, 50, 3.2).invert().apply({ x: -20, y: 10 });

    expect(leftUvs.x).toBeCloseTo(37.5, 10);
    expect(leftUvs.y).toBeCloseTo(18.75, 10);
    expect(rightUvs.x).toBeCloseTo(leftUvs.x, 10);
    expect(rightUvs.y).toBeCloseTo(leftUvs.y, 10);
  });

  it('keeps broad terrain washes inside a fully visible neighborhood', () => {
    expect(TERRAIN_WASH_VISIBILITY_RADIUS).toBeGreaterThanOrEqual(4);
  });

  it('keeps the compact structure texture in the same broad repeat class', () => {
    expect(128 * terrainTextureWorldUnitsPerTexel('structure') / 56).toBeGreaterThanOrEqual(6);
    expect(64 * terrainTextureWorldUnitsPerTexel('structure') / 28).toBeGreaterThanOrEqual(6);
    expect(terrainTextureWorldUnitsPerTexel('plain')).toBe(0.92);
  });

  it('renders a procedural building footprint with one stable surrounding ground while preserving gameplay terrain', () => {
    const tiles: Array<{ terrain: 'plain' | 'structure' }> = Array.from(
      { length: 25 },
      () => ({ terrain: 'plain' })
    );
    tiles[6] = { terrain: 'structure' };
    tiles[7] = { terrain: 'structure' };
    tiles[24] = { terrain: 'structure' };
    const props = [{
      id: 'test-building',
      kind: 'proc-building' as const,
      coordinate: { q: 1, r: 1 },
      w: 2,
      h: 1
    }];

    const first = proceduralBuildingUnderlayTerrain(tiles, props, 5, 5);
    const repeated = proceduralBuildingUnderlayTerrain(tiles, props, 5, 5);

    expect([...first.entries()]).toEqual([...repeated.entries()]);
    expect(first.get(6)).toBe('plain');
    expect(first.get(7)).toBe('plain');
    expect(first.has(24)).toBe(false);
    expect(tiles[6].terrain).toBe('structure');
    expect(tiles[7].terrain).toBe('structure');
    expect(tiles[24].terrain).toBe('structure');
  });

  it('resolves visual terrain symmetrically while gameplay keeps the real blocked tiles', () => {
    const tiles = [
      { terrain: 'structure' as const, passable: false },
      { terrain: 'structure' as const, passable: false }
    ];
    const underlays = new Map<number, 'plain' | 'forest'>([
      [0, 'plain'],
      [1, 'forest']
    ]);

    const forwardEdge = [
      presentationTerrainAt(tiles, underlays, 0),
      presentationTerrainAt(tiles, underlays, 1)
    ];
    const reverseEdge = [
      presentationTerrainAt(tiles, underlays, 1),
      presentationTerrainAt(tiles, underlays, 0)
    ];

    expect(forwardEdge).toEqual(['plain', 'forest']);
    expect(reverseEdge).toEqual([...forwardEdge].reverse());
    expect(tiles[0]).toMatchObject({ terrain: 'structure', passable: false });
    expect(tiles[1]).toMatchObject({ terrain: 'structure', passable: false });
  });

  it('leaves all-structure ruins without an invented urban underlay', () => {
    const tiles = Array.from({ length: 9 }, () => ({ terrain: 'structure' as const }));
    const props = [{
      id: 'ruins',
      kind: 'proc-building' as const,
      coordinate: { q: 1, r: 1 },
      w: 1,
      h: 1
    }];

    expect([...proceduralBuildingUnderlayTerrain(tiles, props, 3, 3)]).toEqual([]);
    expect(tiles[4].terrain).toBe('structure');
  });

  it('refreshes a demolished footprint without changing the surviving underlay', () => {
    const tiles: Array<{ terrain: 'plain' | 'structure' }> = Array.from(
      { length: 25 },
      () => ({ terrain: 'plain' })
    );
    tiles[6] = { terrain: 'structure' };
    tiles[7] = { terrain: 'structure' };
    const props = [{
      id: 'demolition-test',
      kind: 'proc-building' as const,
      coordinate: { q: 1, r: 1 },
      w: 2,
      h: 1
    }];
    const timeline = [{ kind: 'unit:moved' }];

    const beforeRevision = terrainDestructionRevision(timeline);
    const before = proceduralBuildingUnderlayTerrain(tiles, props, 5, 5);
    tiles[6].terrain = 'plain';
    timeline.push({ kind: 'tile:destroyed' });
    const afterRevision = terrainDestructionRevision(timeline);
    const after = proceduralBuildingUnderlayTerrain(tiles, props, 5, 5);

    expect(beforeRevision).toBe(0);
    expect(afterRevision).toBe(1);
    expect(before.get(6)).toBe('plain');
    expect(before.get(7)).toBe('plain');
    expect(after.has(6)).toBe(false);
    expect(after.get(7)).toBe(before.get(7));
    expect(tiles[6].terrain).toBe('plain');
  });

  it('invalidates memoized terrain when a scripted event transforms tiles', () => {
    const timeline = [
      { kind: 'round:started' },
      { kind: 'scenario:event', effectKinds: ['revealObjective'] },
      { kind: 'scenario:event', effectKinds: ['transformTerrain'] }
    ];

    expect(terrainDestructionRevision(timeline)).toBe(1);
  });

  it('does not infer a water underlay that the building footprint cannot render', () => {
    const tiles = Array.from({ length: 9 }, () => ({ terrain: 'water' as const }));
    const props = [{
      id: 'island-building',
      kind: 'proc-building' as const,
      coordinate: { q: 1, r: 1 },
      w: 1,
      h: 1
    }];
    const structureTiles: Array<{ terrain: 'water' | 'structure' }> = [...tiles];
    structureTiles[4] = { terrain: 'structure' };

    expect([...proceduralBuildingUnderlayTerrain(structureTiles, props, 3, 3)]).toEqual([]);
  });

  it('varies detail density in broad deterministic regions instead of per-tile checker steps', () => {
    for (const terrain of ['plain', 'urban', 'water']) {
      const samples = Array.from({ length: 24 }, (_, q) => terrainDetailDensity(q, 9, terrain));
      const repeated = Array.from({ length: 24 }, (_, q) => terrainDetailDensity(q, 9, terrain));
      const largestNeighborStep = Math.max(
        ...samples.slice(1).map((sample, index) => Math.abs(sample - samples[index]))
      );

      expect(repeated).toEqual(samples);
      expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.24);
      expect(Math.max(...samples)).toBeLessThanOrEqual(1.08);
      expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2);
      expect(largestNeighborStep).toBeLessThan(0.24);
    }
  });

  it('softens contact shadows without increasing their alpha budget', () => {
    const layers = softShadowLayers(0.24);

    expect(layers).toHaveLength(3);
    expect(layers.reduce((sum, layer) => sum + layer.alpha, 0)).toBeCloseTo(0.24, 10);
    expect(layers.map((layer) => layer.scaleX)).toEqual([1.24, 1.04, 0.82]);
    expect(layers[0].alpha).toBeLessThan(layers[2].alpha);
    expect(TERRAIN_GRID_ALPHA).toBeLessThan(0.03);
  });

  it('tucks the Gepard contact tracks under its lower battlefield silhouette', () => {
    const tile = 56;
    const gepard = unitContactFootprint(tile, 'vehicle', 'gepard-aa');
    const genericTank = unitContactFootprint(tile, 'vehicle', 'leopard-2');

    expect(gepard.rx).toBeLessThan(genericTank.rx);
    expect(gepard.ry).toBeLessThan(genericTank.ry);
    expect(gepard.y).toBeLessThan(0);
  });
});

function measureCellBottoms(sheet: Awaited<ReturnType<typeof loadImage>>, rows: number) {
  const canvas = createCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  const bottomsByDirection: number[][] = [];

  for (let directionIndex = 0; directionIndex < APC_SHEET_DIRECTIONS.length; directionIndex += 1) {
    const frameBottoms: number[] = [];
    for (let frameIndex = 0; frameIndex < rows; frameIndex += 1) {
      ctx.clearRect(0, 0, 128, 128);
      ctx.drawImage(sheet, directionIndex * 128, frameIndex * 128, 128, 128, 0, 0, 128, 128);
      const pixels = ctx.getImageData(0, 0, 128, 128).data;
      let bottom = -1;
      for (let y = 127; y >= 0 && bottom === -1; y -= 1) {
        for (let x = 0; x < 128; x += 1) {
          if (pixels[(y * 128 + x) * 4 + 3] >= 64) {
            bottom = y + 1;
            break;
          }
        }
      }
      frameBottoms.push(bottom);
    }
    bottomsByDirection.push(frameBottoms);
  }

  return bottomsByDirection;
}

describe('unitVisualHeight', () => {
  it('keeps ground vehicle raster sprites at tactical scale', () => {
    const tile = 56;
    const m113Height = unitVisualHeight(tile, 'vehicle', 'm113', 'm113_apc');

    expect(unitVisualHeight(tile, 'vehicle', 'leopard-2')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'vehicle', 'gepard-aa', 'gepard_directional')).toBe(tile * 0.48);
    expect(m113Height).toBeLessThan(tile * 0.54);
    expect(unitVisualHeight(tile, 'support', 'supply-truck')).toBeLessThan(tile * 0.5);
    expect(m113Height).toBeGreaterThan(tile * 0.5);
  });

  it('does not tilt raster vehicles into vertical launch poses', () => {
    const movementVectors = [
      { x: 1, y: 0 },
      { x: 0.7, y: -0.7 },
      { x: 0, y: -1 },
      { x: -0.7, y: -0.7 },
      { x: -1, y: 0 },
      { x: -0.7, y: 0.7 },
      { x: 0, y: 1 },
      { x: 0.7, y: 0.7 }
    ];

    for (const vector of movementVectors) {
      expect(rasterVehiclePose(vector).rotation).toBe(0);
    }
  });

  it('keeps large battlefield commanders visually dominant', () => {
    const tile = 56;

    expect(unitVisualHeight(tile, 'air', 'ash-crown-sovereign')).toBe(tile * 0.9);
    expect(unitVisualHeight(tile, 'vehicle', 'glass-regent')).toBe(tile * 0.82);
    expect(unitVisualHeight(tile, 'support', 'signal-eater')).toBe(tile * 0.78);
  });
});

describe('roster expansion combat effects', () => {
  it.each([
    ['firefly-105', 'fragment-shell', 'explosion'],
    ['breach-engineers', 'demolition-charge', 'explosion'],
    ['kestrel-recon-drone', 'laser-designator', 'sniper'],
    ['bone-ballista', 'bone-quarrel', 'arrow'],
    ['resonance-cannon', 'resonance-wave', 'magic'],
    ['rift-predator', 'phase-claw', 'melee'],
    ['glass-regent', 'prism-beam', 'magic'],
    ['ash-crown-sovereign', 'crown-fire', 'fire'],
    ['renegade-cell', 'antitank-charge', 'explosion'],
    ['signal-eater', 'silence-claw', 'melee'],
    ['cerberus-gunship', 'chain-cannon', 'gunshot']
  ] as const)('maps %s / %s to %s', (definitionId, weaponId, expected) => {
    expect(combatEffectTypeForWeapon(definitionId, weaponId)).toBe(expected);
  });
});

describe('combat effect lifetime', () => {
  it('keeps lethal explosion debris and flame mounted through their fade', () => {
    expect(combatImpactWindowMs('explosion', true, 920)).toBe(1200);
    expect(combatImpactWindowMs('explosion', false, 920)).toBe(920);
    expect(combatImpactWindowMs('gunshot', true, 460)).toBe(460);
  });
});

describe('roster expansion visuals', () => {
  const definitionIds = [
    'firefly-105', 'badger-mortar-carrier', 'thunderhead-155', 'tempest-counterbattery',
    'horizon-radar', 'tidewalker-apc', 'aegis-assault-tank', 'valkyrie-mobile-infantry',
    'breach-engineers', 'cerberus-gunship', 'kestrel-recon-drone', 'wardog-fire-support',
    'razorwing-flock', 'gloom-balloon', 'ironroot-colossus', 'bone-ballista',
    'resonance-cannon', 'slime-harvester', 'rift-predator', 'veil-magus', 'gate-conjurer',
    'thorn-elf-master', 'ash-mammoth', 'dread-fortress', 'signal-eater', 'glass-regent',
    'ash-crown-sovereign', 'renegade-cell'
  ];

  it('maps every new definition to a shipped raster asset', () => {
    for (const definitionId of definitionIds) {
      const assetPath = rasterUnitOverride(definitionId);
      expect(assetPath, definitionId).not.toBeNull();
      expect(existsSync(path.resolve(process.cwd(), `public${assetPath}`)), definitionId).toBe(true);
    }
  });

  it('treats the counterbattery radar as a ground vehicle', () => {
    expect(isSupportVehicleDefinition('support', 'horizon-radar')).toBe(true);
    expect(isSupportVehicleDefinition('support', 'veil-magus')).toBe(false);
  });

  it('uses the dedicated directional Gepard art on the battlefield', () => {
    expect(battlefieldDirectionalSprite('vehicle', 'gepard-aa')).toBe('gepard_directional');
  });
});

describe('canopy occlusion visibility', () => {
  const coordinate = { q: 3.4, r: 2.2 };
  const mapWidth = 10;

  it('does not reveal a hidden enemy move by fading nearby trees', () => {
    expect(canMovingUnitFadeCanopy('otherSide', 'alliance', coordinate, mapWidth, new Set())).toBe(false);
  });

  it('fades for friendly movers and enemies on visible tiles', () => {
    expect(canMovingUnitFadeCanopy('alliance', 'alliance', coordinate, mapWidth, new Set())).toBe(true);
    expect(canMovingUnitFadeCanopy('otherSide', 'alliance', coordinate, mapWidth, new Set([23]))).toBe(true);
  });
});

describe('movement occlusion sampling', () => {
  it('limits scenery invalidations to two steps per traversed tile', () => {
    const samples = Array.from({ length: 61 }, (_, frame) => (
      quantizeMovementOcclusionCoordinate({ q: frame / 60, r: frame / 60 })
    ));
    const distinctSamples = new Set(samples.map(({ q, r }) => `${q}:${r}`));

    expect(distinctSamples.size - 1).toBeLessThanOrEqual(2);
    expect(samples[0]).toEqual({ q: 0, r: 0 });
    expect(samples.at(-1)).toEqual({ q: 1, r: 1 });
  });
});

describe('occlusion transitions', () => {
  it('eases occluders back to opaque instead of snapping', () => {
    expect(featheredOcclusionAlpha(0, 40, 0.2)).toBe(0.2);
    expect(featheredOcclusionAlpha(20, 40, 0.2)).toBeCloseTo(0.6);
    expect(featheredOcclusionAlpha(40, 40, 0.2)).toBe(1);
    expect(featheredOcclusionAlpha(30, 40, 0.2)).toBeGreaterThan(featheredOcclusionAlpha(10, 40, 0.2));
  });
});

describe('range overlay presentation', () => {
  it('keeps the map readable while giving the overlay a visible fill and edge', () => {
    for (const coloredTerrain of [false, true]) {
      const style = rangeOverlayStyle(coloredTerrain);
      expect(style.fillAlpha).toBeGreaterThanOrEqual(0.3);
      expect(style.fillAlpha).toBeLessThan(0.35);
      expect(style.edgeAlpha).toBeGreaterThan(0.7);
      expect(style.shadowAlpha).toBeGreaterThan(0.5);
      const blockedStyle = blockedRangeOverlayStyle(coloredTerrain);
      expect(blockedStyle.fill).not.toBe(style.fill);
      expect(blockedStyle.edgeAlpha).toBeGreaterThan(style.edgeAlpha);
    }
  });
});

describe('resolveMovementFrame', () => {
  it('keeps the unit still during vehicle pre-alignment', () => {
    const frame = resolveMovementFrame({
      path: [{ q: 2, r: 2 }, { q: 3, r: 2 }],
      startTime: 1000,
      stepDuration: 400,
      preAlignDuration: 150
    }, 1100);

    expect(frame).toMatchObject({
      displayCoord: { q: 2, r: 2 },
      isMoving: false,
      isInitialTurnPhase: false,
      stepProgress: 0
    });
  });

  it('turns a directional vehicle from its standing orientation before it moves', () => {
    expect(VEHICLE_TURN_DURATION_MS).toBe(320);
    const movement = {
      path: [{ q: 2, r: 2 }, { q: 3, r: 2 }],
      startTime: 1000,
      stepDuration: 400,
      preAlignDuration: VEHICLE_TURN_DURATION_MS,
      segmentTurnDuration: VEHICLE_TURN_DURATION_MS,
      initialOrientation: 3
    };
    const midpoint = resolveMovementFrame(movement, 1000 + VEHICLE_TURN_DURATION_MS / 2);
    const firstMovingFrame = resolveMovementFrame(movement, 1000 + VEHICLE_TURN_DURATION_MS);

    expect(midpoint).toMatchObject({
      displayCoord: { q: 2, r: 2 },
      isMoving: false,
      isTurnPhase: true,
      isInitialTurnPhase: true,
      turnProgress: 0.5
    });
    expect(firstMovingFrame).toMatchObject({
      displayCoord: { q: 2, r: 2 },
      isMoving: true,
      isTurnPhase: false,
      isInitialTurnPhase: false,
      stepProgress: 0
    });
  });

  it('uses continuous speed between eased start and stop segments', () => {
    const movement = {
      path: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
      startTime: 0,
      stepDuration: 100
    };

    expect(resolveMovementFrame(movement, 50)?.displayCoord.q).toBeCloseTo(0.25);
    expect(resolveMovementFrame(movement, 150)?.displayCoord.q).toBeCloseTo(1.5);
    expect(resolveMovementFrame(movement, 250)?.displayCoord.q).toBeCloseTo(2.75);
  });

  it('holds a vehicle on the corner while its facing changes', () => {
    const movement = {
      path: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }],
      startTime: 0,
      stepDuration: 100,
      segmentTurnDuration: 50
    };
    const turnFrame = resolveMovementFrame(movement, 125);
    const movingFrame = resolveMovementFrame(movement, 175);

    expect(turnFrame).toMatchObject({
      displayCoord: { q: 1, r: 0 },
      isMoving: false,
      isTurnPhase: true,
      turnProgress: 0.5
    });
    expect(movingFrame?.isMoving).toBe(true);
    expect(movingFrame?.displayCoord.r).toBeCloseTo(0.4375);
  });
});

describe('leavesMechanicalWreck', () => {
  it('only leaves persistent wrecks for explicitly authored machines and structures', () => {
    for (const definitionId of [
      'arachnoid',
      'breorn-titan',
      'death-knight',
      'dire-wolves',
      'hell-rider',
      'ogre-brute',
      'salamander',
      'stone-golem',
      'wolf-rider',
      'future-fantasy-vehicle'
    ]) {
      expect(leavesMechanicalWreck('vehicle', definitionId)).toBe(false);
    }
    expect(leavesMechanicalWreck('air', 'winged-fiend')).toBe(false);
    expect(leavesMechanicalWreck('air', 'harpy-swarm')).toBe(false);

    expect(leavesMechanicalWreck('vehicle', 'demon-engine')).toBe(true);
    expect(leavesMechanicalWreck('vehicle', 'leopard-2')).toBe(true);
    expect(leavesMechanicalWreck('artillery', 'spg-m109')).toBe(true);
    expect(leavesMechanicalWreck('support', 'supply-truck')).toBe(true);
    expect(leavesMechanicalWreck('artillery', 'thunderhead-155')).toBe(true);
    expect(leavesMechanicalWreck('vehicle', 'dread-fortress')).toBe(true);
    expect(leavesMechanicalWreck('artillery', 'arrow-tower')).toBe(true);
    expect(leavesMechanicalWreck('air', 'attack-helo')).toBe(true);
    expect(leavesMechanicalWreck('air', 'kestrel-recon-drone')).toBe(true);
  });
});

describe('death marker lifecycle', () => {
  const scheduledReaction = {
    id: 'reaction-1',
    targetId: 'moving-squad',
    startTime: 2000,
    type: 'explosion' as const,
    hit: true,
    killed: true
  };

  it('keeps a future-dated reaction kill bound to its moving target', () => {
    const matched = activeKillingEffectForTarget([scheduledReaction], 'moving-squad', 1000);

    expect(matched).toBe(scheduledReaction);
    expect(activeKillingEffectForTarget([scheduledReaction], 'other-unit', 1000)).toBeUndefined();
    expect(deathMarkerVisible(matched, true, 1000)).toBe(false);
    expect(deathMarkerVisible(matched, true, 2000 + 430)).toBe(true);
    expect(deathMarkerVisible(matched, false, 2000 + 430)).toBe(false);
  });

  it('ignores a later non-killing hit on the wreck tile', () => {
    const laterHit = {
      ...scheduledReaction,
      id: 'later-hit',
      startTime: 3000,
      killed: false
    };

    expect(activeKillingEffectForTarget([laterHit], 'moving-squad', 3200)).toBeUndefined();
    expect(activeKillingEffectForTarget([laterHit, scheduledReaction], 'moving-squad', 3200)).toBe(scheduledReaction);
  });

  it('keeps mechanical wrecks after the organic corpse TTL', () => {
    expect(deathMarkerExpired(1000, 22_000, false)).toBe(true);
    expect(deathMarkerExpired(1000, 22_000, true)).toBe(false);
  });
});

describe('authored death-marker classes', () => {
  it('keeps procedural hull details hidden during the live hit reaction', () => {
    expect(deathMarkerDetailVisible(true, false)).toBe(false);
    expect(deathMarkerDetailVisible(false, false)).toBe(true);
    expect(deathMarkerDetailVisible(true, true)).toBe(true);
  });

  it('keeps firearm, melee, creature, vehicle, aircraft, and structure remains distinct', () => {
    expect(deathMarkerVisualClass('infantry', 'light-infantry')).toBe('rifle');
    expect(deathMarkerVisualClass('infantry', 'heavy-infantry')).toBe('rifle');
    expect(deathMarkerVisualClass('infantry', 'exo-troopers')).toBe('rifle');
    expect(deathMarkerVisualClass('artillery', 'mortar-team')).toBe('rifle');
    expect(deathMarkerVisualClass('infantry', 'skeleton-horde')).toBe('melee');
    expect(deathMarkerVisualClass('infantry', 'dark-elf-archers')).toBe('melee');
    expect(deathMarkerVisualClass('support', 'necromancer')).toBe('melee');
    expect(deathMarkerVisualClass('vehicle', 'ogre-brute')).toBe('heavy');
    expect(deathMarkerVisualClass('vehicle', 'dire-wolves')).toBe('creature');
    expect(deathMarkerVisualClass('artillery', 'spg-m109')).toBe('artillery');
    expect(deathMarkerVisualClass('artillery', 'firefly-105')).toBe('wheeled');
    expect(deathMarkerVisualClass('vehicle', 'leopard-2')).toBe('tracked');
    expect(deathMarkerVisualClass('support', 'supply-truck')).toBe('wheeled');
    expect(deathMarkerVisualClass('air', 'attack-helo')).toBe('air');
    expect(deathMarkerVisualClass('air', 'cerberus-gunship')).toBe('air');
    expect(deathMarkerVisualClass('air', 'kestrel-recon-drone')).toBe('air');
    expect(deathMarkerVisualClass('air', 'gloom-balloon')).toBe('air');
    expect(deathMarkerVisualClass('air', 'winged-fiend')).toBe('creature');
    expect(deathMarkerVisualClass('artillery', 'arrow-tower')).toBe('structure');
  });

  it('assigns each class a recognizably different flattened silhouette', () => {
    const classes = [
      'rifle',
      'melee',
      'heavy',
      'creature',
      'artillery',
      'tracked',
      'wheeled',
      'air',
      'structure'
    ] as const;
    const profiles = classes.map((visualClass) => deathMarkerSpriteTransform(visualClass));
    const signatures = profiles.map((profile) => (
      `${profile.scaleX}:${profile.scaleY}:${profile.rotation}:${profile.y}`
    ));

    expect(new Set(signatures).size).toBe(classes.length);
    expect(deathMarkerSpriteTransform('rifle').scaleY).toBeLessThan(deathMarkerSpriteTransform('tracked').scaleY);
    expect(deathMarkerSpriteTransform('artillery').scaleX).toBeGreaterThan(deathMarkerSpriteTransform('wheeled').scaleX);
  });
});

describe('infantry ground motion', () => {
  it('plants alternating feet without lifting the sprite more than 1.5 pixels', () => {
    const positiveStep = infantryGroundMotion(1, true);
    const negativeStep = infantryGroundMotion(-1, true);
    const fallbackStep = infantryGroundMotion(1, false);

    expect(positiveStep.plantedSide).toBe(1);
    expect(negativeStep.plantedSide).toBe(-1);
    expect(positiveStep.plantStrength).toBe(1);
    expect(Math.abs(positiveStep.spriteBobY)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(fallbackStep.spriteBobY)).toBeLessThanOrEqual(1.5);
    expect(positiveStep.spriteSwayX).toBe(-negativeStep.spriteSwayX);
  });
});

describe('vehicle movement sheets', () => {
  it('uses a dedicated eight-direction battlefield sheet for the supply truck', async () => {
    expect(rasterUnitOverride('supply-truck')).toBe('/assets/generated/supply_truck.png');
    expect(battlefieldDirectionalSprite('support', 'supply-truck')).toBe('supply_truck_directional');

    const sheetPath = path.resolve(process.cwd(), 'public/assets/generated/supply_truck_directional_idle_sheet.png');
    const sheet = await loadImage(sheetPath);
    expect(sheet.width).toBe(1024);
    expect(sheet.height).toBe(128);

    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext('2d');
    const directionFrames = APC_SHEET_DIRECTIONS.map((_, directionIndex) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.drawImage(sheet, directionIndex * 128, 0, 128, 128, 0, 0, 128, 128);
      return Buffer.from(ctx.getImageData(0, 0, 128, 128).data).toString('base64');
    });
    expect(new Set(directionFrames).size).toBe(8);
  });

  it('keeps every supply-truck direction on the same wheel contact line', async () => {
    const sheetPath = path.resolve(process.cwd(), 'public/assets/generated/supply_truck_directional_walk_sheet.png');
    const sheet = await loadImage(sheetPath);
    const frameBottomsByDirection = measureCellBottoms(sheet, 4);
    const scale = 0.3;

    for (const [directionIndex, direction] of APC_SHEET_DIRECTIONS.entries()) {
      expect(new Set(frameBottomsByDirection[directionIndex])).toEqual(new Set([123]));
      expect(directionalSpriteGroundOffset('supply_truck_directional', 'walk', direction, scale)).toBeCloseTo(1.5, 4);
    }
  });

  it('pins all eight M113, Gepard, and supply-truck poses to unique visual headings', async () => {
    const screenVectors = [
      { name: 'n', x: 0, y: -1 },
      { name: 'ne', x: 1, y: -1 },
      { name: 'e', x: 1, y: 0 },
      { name: 'se', x: 1, y: 1 },
      { name: 's', x: 0, y: 1 },
      { name: 'sw', x: -1, y: 1 },
      { name: 'w', x: -1, y: 0 },
      { name: 'nw', x: -1, y: -1 }
    ];
    const vehicles = [
      { sprite: 'm113_apc', sheet: 'm113_apc_idle_sheet.png' },
      { sprite: 'gepard_directional', sheet: 'gepard_directional_idle_sheet.png' },
      { sprite: 'supply_truck_directional', sheet: 'supply_truck_directional_idle_sheet.png' }
    ];

    for (const vehicle of vehicles) {
      const sheet = await loadImage(path.resolve(process.cwd(), `public/assets/generated/${vehicle.sheet}`));
      const canvas = createCanvas(128, 128);
      const ctx = canvas.getContext('2d');
      const usedColumns = new Set<number>();
      const frameSignatures = new Set<string>();

      for (const vector of screenVectors) {
        const sheetDirection = vehicleSheetDirectionNameForScreenVector(vector, vehicle.sprite);
        const column = APC_SHEET_DIRECTIONS.indexOf(sheetDirection);
        expect(column, `${vehicle.sprite}:${vector.name}`).toBeGreaterThanOrEqual(0);
        usedColumns.add(column);
        ctx.clearRect(0, 0, 128, 128);
        ctx.drawImage(sheet, column * 128, 0, 128, 128, 0, 0, 128, 128);
        frameSignatures.add(Buffer.from(ctx.getImageData(0, 0, 128, 128).data).toString('base64'));
      }

      expect(usedColumns.size, vehicle.sprite).toBe(8);
      expect(frameSignatures.size, vehicle.sprite).toBe(8);
    }
  });

  it('keeps M113 rear lamps trailing east and west travel', async () => {
    const hottestWarmMarkerX = (pixels: Uint8ClampedArray) => {
      let hottestScore = Number.NEGATIVE_INFINITY;
      let hottestX = -1;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const [red, green, blue, alpha] = pixels.slice(offset, offset + 4);
        if (alpha < 128 || red < 65 || red < green * 1.12 || red < blue * 1.18) continue;
        const score = red * 2 - green - blue;
        if (score > hottestScore) {
          hottestScore = score;
          hottestX = (offset / 4) % 128;
        }
      }
      return hottestX;
    };
    const sheet = await loadImage(path.resolve(process.cwd(), 'public/assets/generated/m113_apc_idle_sheet.png'));
    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext('2d');
    const rearLampForVector = (x: number) => {
      const sheetDirection = vehicleSheetDirectionNameForScreenVector({ x, y: 0 }, 'm113_apc');
      const column = APC_SHEET_DIRECTIONS.indexOf(sheetDirection);
      ctx.clearRect(0, 0, 128, 128);
      ctx.drawImage(sheet, column * 128, 0, 128, 128, 0, 0, 128, 128);
      return hottestWarmMarkerX(ctx.getImageData(0, 0, 128, 128).data);
    };

    expect(rearLampForVector(1), 'east travel').toBeLessThan(43);
    expect(rearLampForVector(-1), 'west travel').toBeGreaterThan(85);
  });

  it('keeps M113 walk frames on a stable ground line', async () => {
    const sheetPath = path.resolve(process.cwd(), 'public/assets/generated/apc_directional_walk_sheet.png');
    const sheet = await loadImage(sheetPath);
    const frameBottomsByDirection = measureCellBottoms(sheet, 4);

    for (const frameBottoms of frameBottomsByDirection) {
      expect(Math.max(...frameBottoms) - Math.min(...frameBottoms)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps M113 render offsets aligned with measured sprite alpha bottoms', async () => {
    const sheetPath = path.resolve(process.cwd(), 'public/assets/generated/apc_directional_walk_sheet.png');
    const sheet = await loadImage(sheetPath);
    const scale = 0.3;
    const frameBottomsByDirection = measureCellBottoms(sheet, 4);

    for (const [directionIndex, direction] of APC_SHEET_DIRECTIONS.entries()) {
      const measuredBottom = frameBottomsByDirection[directionIndex][0];
      expect(directionalSpriteGroundOffset('apc_directional', 'walk', direction, scale)).toBeCloseTo(
        (128 - measuredBottom) * scale,
        4
      );
    }
    expect(directionalSpriteGroundOffset('apc_directional', 'idle', 'e', scale)).toBe(0);
    expect(directionalSpriteGroundOffset('tank_directional', 'walk', 'e', scale)).toBe(0);
  });

  it('keeps the current M113 sheet aligned to the terrain contact line', () => {
    const scale = 0.3;

    const expectedOffsets = {
      n: 2.1,
      ne: 0.6,
      e: 2.7,
      se: 0.9,
      s: 2.1,
      sw: 1.2,
      w: 2.7,
      nw: 0.6
    };

    for (const direction of APC_SHEET_DIRECTIONS) {
      expect(directionalSpriteGroundOffset('m113_apc', 'idle', direction, scale)).toBeCloseTo(
        expectedOffsets[direction as keyof typeof expectedOffsets],
        4
      );
      expect(directionalSpriteGroundOffset('m113_apc', 'walk', direction, scale)).toBeCloseTo(
        expectedOffsets[direction as keyof typeof expectedOffsets],
        4
      );
    }
  });
});

describe('directional infantry walk cycles', () => {
  it('ships grounded multi-pose movement for every directional foot family', async () => {
    for (const spriteName of ['light_infantry', 'heavy_infantry', 'rangers']) {
      const sheetPath = path.resolve(process.cwd(), `public/assets/generated/${spriteName}_walk_sheet.png`);
      const sheet = await loadImage(sheetPath);
      expect(sheet.width, spriteName).toBe(1024);
      expect(sheet.height, spriteName).toBe(512);

      const canvas = createCanvas(128, 128);
      const ctx = canvas.getContext('2d');
      for (let directionIndex = 0; directionIndex < APC_SHEET_DIRECTIONS.length; directionIndex += 1) {
        const poses = new Set<string>();
        for (let frameIndex = 0; frameIndex < 4; frameIndex += 1) {
          ctx.clearRect(0, 0, 128, 128);
          ctx.drawImage(sheet, directionIndex * 128, frameIndex * 128, 128, 128, 0, 0, 128, 128);
          poses.add(Buffer.from(ctx.getImageData(0, 0, 128, 128).data).toString('base64'));
        }
        expect(poses.size, `${spriteName}:${APC_SHEET_DIRECTIONS[directionIndex]}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('routes commanders and all core infantry classes through directional cycles', () => {
    expect(DIRECTIONAL_UNIT_SPRITES['john-alexander']).toBe('light_infantry');
    expect(DIRECTIONAL_UNIT_SPRITES['field-medic']).toBe('light_infantry');
    expect(DIRECTIONAL_UNIT_SPRITES['heavy-infantry']).toBe('heavy_infantry');
    expect(DIRECTIONAL_UNIT_SPRITES.rangers).toBe('rangers');
  });
});

describe('directionNameForOrientation', () => {
  it('maps isometric grid movement orientations to screen-facing sprite directions', () => {
    expect(directionNameForOrientation(0)).toBe('se');
    expect(directionNameForOrientation(1)).toBe('e');
    expect(directionNameForOrientation(2)).toBe('ne');
    expect(directionNameForOrientation(3)).toBe('nw');
    expect(directionNameForOrientation(4)).toBe('w');
    expect(directionNameForOrientation(5)).toBe('sw');
    expect(directionNameForOrientation(6)).toBe('s');
    expect(directionNameForOrientation(7)).toBe('n');
  });
});

describe('directionNameForScreenVector', () => {
  it('maps live screen-space motion to the nearest sprite direction', () => {
    expect(directionNameForScreenVector({ x: 1, y: 0 })).toBe('e');
    expect(directionNameForScreenVector({ x: 1, y: 1 })).toBe('se');
    expect(directionNameForScreenVector({ x: 0, y: 1 })).toBe('s');
    expect(directionNameForScreenVector({ x: -1, y: -1 })).toBe('nw');
  });

  it('avoids smeared M113 sheet cells for horizontal vehicle movement', () => {
    expect(vehicleSheetDirectionNameForScreenVector({ x: 1, y: 0 }, 'apc_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForScreenVector({ x: -1, y: 0 }, 'apc_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(1, 'apc_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(4, 'apc_directional')).toBe('nw');
  });
});

describe('vehicleSheetDirectionNameForOrientation', () => {
  it('maps all supply-truck movement orientations without reversing or substituting a side', () => {
    const expectedDirections = ['se', 'e', 'ne', 'nw', 'w', 'sw', 's', 'n'];
    expect(expectedDirections.map((_, orientation) => (
      vehicleSheetDirectionNameForOrientation(orientation, 'supply_truck_directional')
    ))).toEqual(expectedDirections);
  });

  it('uses the current APC sheet orientation metadata while bypassing damaged side cells', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'apc_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(1, 'apc_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(2, 'apc_directional')).toBe('ne');
    expect(vehicleSheetDirectionNameForOrientation(3, 'apc_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(4, 'apc_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(5, 'apc_directional')).toBe('sw');
    expect(vehicleSheetDirectionNameForOrientation(6, 'apc_directional')).toBe('s');
    expect(vehicleSheetDirectionNameForOrientation(7, 'apc_directional')).toBe('n');
  });

  it('leaves correctly ordered generic sheets unchanged', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'future_vehicle_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(1, 'future_vehicle_directional')).toBe('e');
    expect(vehicleSheetDirectionNameForOrientation(2, 'future_vehicle_directional')).toBe('ne');
  });

  it('maps authored vehicle sheets to their visible headings', () => {
    expect(vehicleSheetDirectionNameForScreenVector({ x: 1, y: 0 }, 'm113_apc')).toBe('e');
    expect(vehicleSheetDirectionNameForScreenVector({ x: -1, y: 0 }, 'm113_apc')).toBe('w');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 1, y: 1 }, 'm113_apc')).toBe('sw');
    expect(vehicleSheetDirectionNameForScreenVector({ x: -1, y: -1 }, 'm113_apc')).toBe('se');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 0, y: -1 }, 'm113_apc')).toBe('n');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 0, y: 1 }, 'm113_apc')).toBe('s');
    expect(vehicleSheetDirectionNameForOrientation(0, 'tank_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(4, 'artillery_directional')).toBe('e');
  });

  it('maps M113 diagonal sheet cells to their visual facing', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'm113_apc')).toBe('sw');
    expect(vehicleSheetDirectionNameForOrientation(1, 'm113_apc')).toBe('e');
    expect(vehicleSheetDirectionNameForOrientation(2, 'm113_apc')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(3, 'm113_apc')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(4, 'm113_apc')).toBe('w');
    expect(vehicleSheetDirectionNameForOrientation(5, 'm113_apc')).toBe('ne');
    expect(vehicleSheetDirectionNameForOrientation(6, 'm113_apc')).toBe('s');
    expect(vehicleSheetDirectionNameForOrientation(7, 'm113_apc')).toBe('n');
  });
});

describe('vehicleTurnCrossfade', () => {
  it('keeps the vehicle solid while easing between directional poses', () => {
    expect(vehicleTurnCrossfade(-1)).toEqual({ outgoingAlpha: 1, incomingAlpha: 0 });
    expect(vehicleTurnCrossfade(0.5).outgoingAlpha).toBeCloseTo(Math.pow(Math.SQRT1_2, 0.9));
    expect(vehicleTurnCrossfade(0.5).incomingAlpha).toBeCloseTo(Math.pow(Math.SQRT1_2, 0.9));
    expect(vehicleTurnCrossfade(2)).toEqual({ outgoingAlpha: 0, incomingAlpha: 1 });

    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const blend = vehicleTurnCrossfade(progress);
      const compositedAlpha = blend.incomingAlpha + blend.outgoingAlpha * (1 - blend.incomingAlpha);
      expect(compositedAlpha).toBeGreaterThanOrEqual(0.92);
    }
  });

  it('splits wide turns into adjacent 45-degree sheet poses', () => {
    const clockwise = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
    const samples = Array.from({ length: 65 }, (_, index) => index / 64);

    for (const [fromOrientation, toOrientation, expectedSteps] of [
      [1, 6, 2],
      [1, 5, 3],
      [1, 4, 4]
    ]) {
      let previousDominantIndex = clockwise.indexOf(directionNameForOrientation(fromOrientation));
      for (const progress of samples) {
        const blend = vehicleTurnSheetBlend(
          fromOrientation,
          toOrientation,
          'supply_truck_directional',
          progress
        );
        const fromIndex = clockwise.indexOf(blend.displayFrom);
        const toIndex = clockwise.indexOf(blend.displayTo);
        expect(blend.stepCount).toBe(expectedSteps);
        expect((toIndex - fromIndex + clockwise.length) % clockwise.length).toBe(1);
        const dominantIndex = blend.progress < 0.5 ? fromIndex : toIndex;
        expect((dominantIndex - previousDominantIndex + clockwise.length) % clockwise.length)
          .toBeLessThanOrEqual(1);
        previousDominantIndex = dominantIndex;
      }
    }
  });

  it('cuts maximum 90-degree turn error from 45 to 22.5 degrees', () => {
    let endpointOnlyError = 0;
    let steppedError = 0;

    for (let sample = 0; sample <= 160; sample += 1) {
      const progress = sample / 160;
      const intendedAngle = progress * 90;
      const endpointAngle = progress < 0.5 ? 0 : 90;
      endpointOnlyError = Math.max(endpointOnlyError, Math.abs(endpointAngle - intendedAngle));

      const blend = vehicleTurnSheetBlend(1, 6, 'supply_truck_directional', progress);
      const displayAngles: Record<string, number> = { e: 0, se: 45, s: 90 };
      const dominantDirection = blend.progress < 0.5 ? blend.displayFrom : blend.displayTo;
      steppedError = Math.max(
        steppedError,
        Math.abs(displayAngles[dominantDirection] - intendedAngle)
      );
    }

    expect(endpointOnlyError).toBe(45);
    expect(steppedError).toBe(22.5);
  });

  it('does not skip a heading at the 20 fps motion-capture floor', () => {
    const frameInterval = 1000 / 20;
    const clockwise = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
    let previousIndex = clockwise.indexOf('e');

    for (let elapsed = 0; elapsed <= VEHICLE_TURN_DURATION_MS; elapsed += frameInterval) {
      const blend = vehicleTurnSheetBlend(
        1,
        4,
        'm113_apc',
        elapsed / VEHICLE_TURN_DURATION_MS
      );
      const dominantDirection = blend.progress < 0.5 ? blend.displayFrom : blend.displayTo;
      const index = clockwise.indexOf(dominantDirection);
      expect((index - previousIndex + clockwise.length) % clockwise.length).toBeLessThanOrEqual(1);
      previousIndex = index;
    }
  });

  it('turns both poses toward the blend instead of swapping them in place', () => {
    expect(vehicleTurnRotation(0, 1, false)).toBe(0);
    expect(vehicleTurnRotation(0, 1, true)).toBe(-0.055);
    const outgoingMidpoint = vehicleTurnRotation(0.5, 1, false);
    expect(outgoingMidpoint).toBeCloseTo(0.0275);
    expect(vehicleTurnRotation(0.5, 1, true)).toBeCloseTo(-0.0275);
    expect(vehicleTurnScaleX(0.5)).toBeLessThan(1);
    expect(vehicleTurnScaleY(0.5)).toBeGreaterThan(1);
    expect(vehicleTurnRotation(1, 1, true)).toBeCloseTo(0);
    expect(vehicleTurnRotation(0.5, -1, false)).toBeCloseTo(-outgoingMidpoint);
  });
});

describe('vehicleMotionEnvelope', () => {
  const frame = {
    isFirstSegment: true,
    isLastSegment: false,
    isMoving: true,
    isTurnPhase: false,
    isInitialTurnPhase: false,
    stepProgress: 0,
    turnProgress: 0
  };

  it('eases dust and running gear into and out of motion', () => {
    expect(vehicleMotionEnvelope(frame)).toBe(0);
    expect(vehicleMotionEnvelope({ ...frame, stepProgress: 0.12 })).toBeCloseTo(0.5);
    expect(vehicleMotionEnvelope({ ...frame, stepProgress: 0.24 })).toBe(1);
    expect(vehicleMotionEnvelope({
      ...frame,
      isFirstSegment: false,
      isLastSegment: true,
      stepProgress: 0.88
    })).toBeCloseTo(0.5);
    expect(vehicleMotionEnvelope({
      ...frame,
      isFirstSegment: false,
      isLastSegment: true,
      stepProgress: 1,
      isMoving: false
    })).toBe(0);
  });

  it('eases running gear through initial and mid-path pivots', () => {
    const initialTurn = {
      ...frame,
      isMoving: false,
      isTurnPhase: true,
      isInitialTurnPhase: true
    };
    expect(vehicleMotionEnvelope(initialTurn)).toBe(0);
    expect(vehicleMotionEnvelope({ ...initialTurn, turnProgress: 0.5 })).toBeCloseTo(0.68);
    expect(vehicleMotionEnvelope({ ...initialTurn, turnProgress: 1 })).toBeCloseTo(0);

    const midPathTurn = { ...initialTurn, isInitialTurnPhase: false };
    expect(vehicleMotionEnvelope(midPathTurn)).toBe(1);
    expect(vehicleMotionEnvelope({ ...midPathTurn, turnProgress: 0.5 })).toBeCloseTo(0.72);
    expect(vehicleMotionEnvelope({ ...midPathTurn, turnProgress: 1 })).toBeCloseTo(1);
  });
});

describe('vehicle secondary motion', () => {
  const movingFrame = {
    isFirstSegment: true,
    isLastSegment: false,
    isMoving: true,
    isTurnPhase: false,
    isInitialTurnPhase: false,
    stepProgress: 0,
    turnProgress: 0
  };

  it('gives acceleration, braking, and corner pivots readable dust pulses', () => {
    expect(vehicleDustEnvelope(movingFrame)).toBe(0);
    expect(vehicleDustEnvelope({ ...movingFrame, stepProgress: 0.16 })).toBeGreaterThan(0.9);
    expect(vehicleDustEnvelope({
      ...movingFrame,
      isFirstSegment: false,
      isLastSegment: true,
      stepProgress: 0.84
    })).toBeGreaterThan(0.9);
    const pivotStart = vehicleDustEnvelope({
      ...movingFrame,
      isMoving: false,
      isTurnPhase: true,
      stepProgress: 1,
      turnProgress: 0
    });
    expect(pivotStart).toBeCloseTo(0.56);
    expect(vehicleDustEnvelope({
      ...movingFrame,
      isMoving: false,
      isTurnPhase: true,
      stepProgress: 1,
      turnProgress: 0.5
    })).toBeGreaterThan(pivotStart);
    expect(vehicleDustEnvelope({
      ...movingFrame,
      isMoving: false,
      isTurnPhase: true,
      stepProgress: 1,
      turnProgress: 1
    })).toBeCloseTo(pivotStart);
  });

  it('keeps wheel and tread phase continuous across a pivot', () => {
    expect(vehicleGearPhase(1, 0)).toBeCloseTo(vehicleGearPhase(1, 1));
  });

  it('classifies visible running gear without putting it on creatures, static crews, or structures', () => {
    expect(vehicleRunningGearKind('vehicle', 'm113')).toBe('tracked');
    expect(vehicleRunningGearKind('vehicle', 'leopard-2')).toBe('tracked');
    expect(vehicleRunningGearKind('support', 'supply-truck')).toBe('wheeled');
    expect(vehicleRunningGearKind('support', 'horizon-radar')).toBe('wheeled');
    expect(vehicleRunningGearKind('artillery', 'firefly-105')).toBe('wheeled');
    expect(vehicleRunningGearKind('vehicle', 'ash-mammoth')).toBeNull();
    expect(vehicleRunningGearKind('vehicle', 'dire-wolves')).toBeNull();
    expect(vehicleRunningGearKind('vehicle', 'wolf-rider')).toBeNull();
    expect(vehicleRunningGearKind('artillery', 'mortar-team')).toBeNull();
    expect(vehicleRunningGearKind('artillery', 'arrow-tower')).toBeNull();
  });
});

describe('directional tank ground contact', () => {
  it('keeps both front-facing Leopard poses within two pixels of the ground marker', async () => {
    const tileSize = 56;
    const spriteName = 'tank_directional';
    const idleSheet = await loadImage(path.resolve('public/assets/generated/tank_directional_idle_sheet.png'));
    const walkSheet = await loadImage(path.resolve('public/assets/generated/tank_directional_walk_sheet.png'));
    const idleBottoms = measureCellBottoms(idleSheet, 1);
    const walkBottoms = measureCellBottoms(walkSheet, 4);
    const scale = unitVisualHeight(tileSize, 'vehicle', 'leopard-2', spriteName)
      / DIRECTIONAL_UNIT_SOURCE_HEIGHTS[spriteName];
    const anchorY = DIRECTIONAL_UNIT_ANCHOR_Y[spriteName] * 128;
    const groundBias = DIRECTIONAL_UNIT_GROUND_BIAS[spriteName];
    const markerY = unitContactFootprint(tileSize, 'vehicle', 'leopard-2').y;

    for (const directionIndex of [0, 4]) {
      for (const bottom of [...idleBottoms[directionIndex], ...walkBottoms[directionIndex]]) {
        const spriteBottomY = (bottom - anchorY) * scale + groundBias;
        expect(Math.abs(markerY - spriteBottomY)).toBeLessThanOrEqual(2);
      }
    }
  });
});
