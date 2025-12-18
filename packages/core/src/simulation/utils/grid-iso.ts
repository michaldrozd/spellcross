import type { BattlefieldMap, HexCoordinate } from '../types.js';
import { isWithinBounds } from './grid.js';

// 8-directional square grid (isometric diamond projection in renderer)
export const isoDirections8: ReadonlyArray<HexCoordinate> = [
  { q: 0, r: -1 },  // N
  { q: +1, r: -1 }, // NE
  { q: +1, r: 0 },  // E
  { q: +1, r: +1 }, // SE
  { q: 0, r: +1 },  // S
  { q: -1, r: +1 }, // SW
  { q: -1, r: 0 },  // W
  { q: -1, r: -1 }  // NW
] as const;

export const coordinateKey = (c: HexCoordinate) => `${c.q},${c.r}`;

// Chebyshev distance suitable for 8-dir movement
export function isoDistance(a: HexCoordinate, b: HexCoordinate): number {
  const dq = Math.abs(a.q - b.q);
  const dr = Math.abs(a.r - b.r);
  return Math.max(dq, dr);
}

export function isoNeighbors(map: BattlefieldMap, c: HexCoordinate): HexCoordinate[] {
  return isoDirections8
    .map((d) => ({ q: c.q + d.q, r: c.r + d.r }))
    .filter((n) => isWithinBounds(map, n));
}

// Bresenham line on square grid (q,r interpreted as x,y)
export function isoLine(from: HexCoordinate, to: HexCoordinate): HexCoordinate[] {
  const points: HexCoordinate[] = [];
  let q = from.q;
  let r = from.r;
  const q2 = to.q;
  const r2 = to.r;
  const dq = Math.abs(q2 - q);
  const dr = Math.abs(r2 - r);
  const sq = q < q2 ? 1 : -1;
  const sr = r < r2 ? 1 : -1;
  let err = dq - dr;
  points.push({ q, r });
  while (q !== q2 || r !== r2) {
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; q += sq; }
    if (e2 < dq) { err += dq; r += sr; }
    points.push({ q, r });
  }
  return points;
}

// Tiles within Chebyshev radius (square in q,r axes; diamond when rendered isometrically)
export function isoWithinRange(center: HexCoordinate, range: number): HexCoordinate[] {
  const res: HexCoordinate[] = [];
  for (let dq = -range; dq <= range; dq++) {
    for (let dr = -range; dr <= range; dr++) {
      if (Math.max(Math.abs(dq), Math.abs(dr)) <= range) {
        res.push({ q: center.q + dq, r: center.r + dr });
      }
    }
  }
  return res;
}
