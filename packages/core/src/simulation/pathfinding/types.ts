import type { HexCoordinate, UnitInstance } from '../types.js';

export interface PathfindingOptions {
  ignoreCoordinates?: Set<string>;
  maxCost?: number;
  // Unit-type specific movement constraints (e.g., forest only infantry/hero, water only air, ...)
  unitType?: UnitInstance['unitType'];
}

export interface PathResult {
  success: boolean;
  path: HexCoordinate[];
  cost: number;
  reason?: string;
}

