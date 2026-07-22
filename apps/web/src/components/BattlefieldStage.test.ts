import { createCanvas, loadImage } from 'canvas';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  activeKillingEffectForTarget,
  deathMarkerExpired,
  deathMarkerVisible
} from './combatVisuals.js';
import {
  directionalSpriteGroundOffset,
  directionNameForOrientation,
  directionNameForScreenVector,
  leavesMechanicalWreck,
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
