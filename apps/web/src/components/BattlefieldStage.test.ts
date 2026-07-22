import { createCanvas, loadImage } from 'canvas';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  activeKillingEffectForTarget,
  combatImpactWindowMs,
  combatEffectTypeForWeapon,
  deathMarkerExpired,
  deathMarkerVisible
} from './combatVisuals.js';
import {
  battlefieldDirectionalSprite,
  canMovingUnitFadeCanopy,
  directionalSpriteGroundOffset,
  directionNameForOrientation,
  directionNameForScreenVector,
  isSupportVehicleDefinition,
  leavesMechanicalWreck,
  rasterUnitOverride,
  rasterVehiclePose,
  resolveMovementFrame,
  unitVisualHeight,
  vehicleSheetDirectionNameForOrientation,
  vehicleSheetDirectionNameForScreenVector,
  vehicleTurnCrossfade
} from './unitVisuals.js';

const APC_SHEET_DIRECTIONS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

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

    expect(unitVisualHeight(tile, 'vehicle', 'leopard-2')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'vehicle', 'm113')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'support', 'supply-truck')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'vehicle', 'm113')).toBeGreaterThan(tile * 0.44);
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
  it('only leaves hulls for explicitly mechanical definitions', () => {
    for (const definitionId of [
      'arachnoid',
      'arrow-tower',
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

    expect(leavesMechanicalWreck('vehicle', 'demon-engine')).toBe(true);
    expect(leavesMechanicalWreck('vehicle', 'leopard-2')).toBe(true);
    expect(leavesMechanicalWreck('artillery', 'spg-m109')).toBe(true);
    expect(leavesMechanicalWreck('support', 'supply-truck')).toBe(true);
    expect(leavesMechanicalWreck('artillery', 'thunderhead-155')).toBe(true);
    expect(leavesMechanicalWreck('vehicle', 'dread-fortress')).toBe(true);
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

  it('keeps legacy reversed vehicle sheets corrected', () => {
    expect(vehicleSheetDirectionNameForScreenVector({ x: 1, y: 0 }, 'm113_apc')).toBe('w');
    expect(vehicleSheetDirectionNameForScreenVector({ x: -1, y: 0 }, 'm113_apc')).toBe('e');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 1, y: 1 }, 'm113_apc')).toBe('nw');
    expect(vehicleSheetDirectionNameForScreenVector({ x: -1, y: -1 }, 'm113_apc')).toBe('se');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 0, y: -1 }, 'm113_apc')).toBe('n');
    expect(vehicleSheetDirectionNameForScreenVector({ x: 0, y: 1 }, 'm113_apc')).toBe('s');
    expect(vehicleSheetDirectionNameForOrientation(0, 'tank_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(4, 'artillery_directional')).toBe('e');
  });

  it('maps M113 diagonal sheet cells to their visual facing', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'm113_apc')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(1, 'm113_apc')).toBe('w');
    expect(vehicleSheetDirectionNameForOrientation(2, 'm113_apc')).toBe('sw');
    expect(vehicleSheetDirectionNameForOrientation(3, 'm113_apc')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(4, 'm113_apc')).toBe('e');
    expect(vehicleSheetDirectionNameForOrientation(5, 'm113_apc')).toBe('ne');
    expect(vehicleSheetDirectionNameForOrientation(6, 'm113_apc')).toBe('s');
    expect(vehicleSheetDirectionNameForOrientation(7, 'm113_apc')).toBe('n');
  });
});

describe('vehicleTurnCrossfade', () => {
  it('preserves opacity while easing between directional poses', () => {
    expect(vehicleTurnCrossfade(-1)).toEqual({ outgoingAlpha: 1, incomingAlpha: 0 });
    expect(vehicleTurnCrossfade(0.5)).toEqual({ outgoingAlpha: 0.5, incomingAlpha: 0.5 });
    expect(vehicleTurnCrossfade(2)).toEqual({ outgoingAlpha: 0, incomingAlpha: 1 });

    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const blend = vehicleTurnCrossfade(progress);
      expect(blend.outgoingAlpha + blend.incomingAlpha).toBeCloseTo(1);
    }
  });
});
