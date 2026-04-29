import { describe, expect, it } from 'vitest';

import {
  directionNameForOrientation,
  rasterVehiclePose,
  unitVisualHeight,
  vehicleSheetDirectionNameForOrientation
} from './BattlefieldStage.js';

describe('unitVisualHeight', () => {
  it('keeps ground vehicle raster sprites at tactical scale', () => {
    const tile = 56;

    expect(unitVisualHeight(tile, 'vehicle', 'leopard-2')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'vehicle', 'm113')).toBeLessThan(tile * 0.5);
    expect(unitVisualHeight(tile, 'support', 'supply-truck')).toBeLessThan(tile * 0.5);
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

describe('vehicleSheetDirectionNameForOrientation', () => {
  it('uses the current vehicle sheet orientation metadata', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'apc_directional')).toBe('nw');
    expect(vehicleSheetDirectionNameForOrientation(1, 'apc_directional')).toBe('w');
    expect(vehicleSheetDirectionNameForOrientation(2, 'apc_directional')).toBe('sw');
    expect(vehicleSheetDirectionNameForOrientation(3, 'apc_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(4, 'apc_directional')).toBe('e');
    expect(vehicleSheetDirectionNameForOrientation(5, 'apc_directional')).toBe('ne');
    expect(vehicleSheetDirectionNameForOrientation(6, 'apc_directional')).toBe('n');
    expect(vehicleSheetDirectionNameForOrientation(7, 'apc_directional')).toBe('s');
  });

  it('leaves correctly ordered sheets unchanged', () => {
    expect(vehicleSheetDirectionNameForOrientation(0, 'future_vehicle_directional')).toBe('se');
    expect(vehicleSheetDirectionNameForOrientation(1, 'future_vehicle_directional')).toBe('e');
    expect(vehicleSheetDirectionNameForOrientation(2, 'future_vehicle_directional')).toBe('ne');
  });
});
