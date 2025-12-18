import type { BattlefieldMap, HexCoordinate, MapTile } from '../types.js';

export const hexDirections: ReadonlyArray<HexCoordinate> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export const coordinateKey = (coordinate: HexCoordinate) => `${coordinate.q},${coordinate.r}`;

export function addCoordinates(a: HexCoordinate, b: HexCoordinate): HexCoordinate {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function axialDistance(a: HexCoordinate, b: HexCoordinate): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - (b.q + b.r)));
}

export function isNeighbor(a: HexCoordinate, b: HexCoordinate): boolean {
  return hexDirections.some((dir) => a.q + dir.q === b.q && a.r + dir.r === b.r);
}

export function isWithinBounds(map: BattlefieldMap, coordinate: HexCoordinate): boolean {
  return coordinate.q >= 0 && coordinate.q < map.width && coordinate.r >= 0 && coordinate.r < map.height;
}

export function tileIndex(map: BattlefieldMap, coordinate: HexCoordinate): number {
  return coordinate.r * map.width + coordinate.q;
}

export function getTile(map: BattlefieldMap, coordinate: HexCoordinate): MapTile | undefined {
  if (!isWithinBounds(map, coordinate)) {
    return undefined;
  }

  return map.tiles[tileIndex(map, coordinate)];
}

export function getNeighbors(map: BattlefieldMap, coordinate: HexCoordinate): HexCoordinate[] {
  return hexDirections
    .map((direction) => addCoordinates(coordinate, direction))
    .filter((neighbor) => isWithinBounds(map, neighbor));
}

export function directionIndex(from: HexCoordinate, to: HexCoordinate): number {
  if (from.q === to.q && from.r === to.r) return 0;
  let bestIdx = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hexDirections.length; i++) {
    const dir = hexDirections[i];
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    const score = Math.abs(dq - dir.q) + Math.abs(dr - dir.r);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function orientationDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 6;
  return Math.min(diff, 6 - diff);
}

export interface CubeCoordinate {
  x: number;
  y: number;
  z: number;
}

export function axialToCube(axial: HexCoordinate): CubeCoordinate {
  const x = axial.q;
  const z = axial.r;
  const y = -x - z;
  return { x, y, z };
}

export function cubeToAxial(cube: CubeCoordinate): HexCoordinate {
  return { q: cube.x, r: cube.z };
}

export function cubeDistance(a: CubeCoordinate, b: CubeCoordinate): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

export function cubeAdd(a: CubeCoordinate, b: CubeCoordinate): CubeCoordinate {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

const cubeDirections: ReadonlyArray<CubeCoordinate> = hexDirections.map((direction) =>
  axialToCube(direction)
);

export function cubeNeighbors(cube: CubeCoordinate): CubeCoordinate[] {
  return cubeDirections.map((direction) => cubeAdd(cube, direction));
}

function cubeLerp(a: CubeCoordinate, b: CubeCoordinate, t: number): CubeCoordinate {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t
  };
}

function cubeRound(cube: CubeCoordinate): CubeCoordinate {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);

  const xDiff = Math.abs(rx - cube.x);
  const yDiff = Math.abs(ry - cube.y);
  const zDiff = Math.abs(rz - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { x: rx, y: ry, z: rz };
}

export function hexLine(from: HexCoordinate, to: HexCoordinate): HexCoordinate[] {
  const start = axialToCube(from);
  const end = axialToCube(to);
  const distance = cubeDistance(start, end);

  const results: HexCoordinate[] = [];
  for (let i = 0; i <= distance; i++) {
    const t = distance === 0 ? 0 : i / distance;
    const lerp = cubeLerp(start, end, t);
    const rounded = cubeRound(lerp);
    results.push(cubeToAxial(rounded));
  }
  return results;
}

export function hexWithinRange(center: HexCoordinate, range: number): HexCoordinate[] {
  const results: HexCoordinate[] = [];
  const centerCube = axialToCube(center);

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = Math.max(-range, -dx - range); dy <= Math.min(range, -dx + range); dy++) {
      const dz = -dx - dy;
      const cube: CubeCoordinate = {
        x: centerCube.x + dx,
        y: centerCube.y + dy,
        z: centerCube.z + dz
      };
      results.push(cubeToAxial(cube));
    }
  }

  return results;
}
