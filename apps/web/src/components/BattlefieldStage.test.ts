import { describe, expect, it } from 'vitest';
import { createCanvas, loadImage } from 'canvas';
import path from 'node:path';

import {
  directionalSpriteGroundOffset,
  directionNameForOrientation,
  directionNameForScreenVector,
  rasterVehiclePose,
  unitVisualHeight,
  vehicleSheetDirectionNameForOrientation,
  vehicleSheetDirectionNameForScreenVector
} from './BattlefieldStage.js';

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
    expect(vehicleSheetDirectionNameForOrientation(0, 'tank_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(4, 'artillery_directional')).toBe('e');
  });
});
