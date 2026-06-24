import { describe, expect, it } from 'vitest';

import { cityScenarios } from './city-battlefields.js';

const inBounds = (q: number, r: number, w: number, h: number) => q >= 0 && q < w && r >= 0 && r < h;

describe('Per-city battlefields', () => {
  it('generates one scenario per sector', () => {
    expect(cityScenarios.length).toBe(17);
    expect(new Set(cityScenarios.map((s) => s.id)).size).toBe(17); // unique ids
    expect(new Set(cityScenarios.map((s) => s.map.id)).size).toBe(17); // unique maps
  });

  for (const sc of cityScenarios) {
    describe(sc.id, () => {
      const { width: w, height: h, tiles } = sc.map;
      const passable = (q: number, r: number) => inBounds(q, r, w, h) && tiles[r * w + q]?.passable;

      it('has a correctly sized tile grid', () => {
        expect(tiles.length).toBe(w * h);
      });

      it('places both deploy zones on in-bounds passable tiles', () => {
        expect(sc.startZones.alliance.length).toBeGreaterThanOrEqual(4);
        expect(sc.startZones.otherSide.length).toBeGreaterThanOrEqual(3);
        for (const c of [...sc.startZones.alliance, ...sc.startZones.otherSide]) {
          expect(passable(c.q, c.r), `zone tile ${c.q},${c.r}`).toBe(true);
        }
      });

      it('spawns every enemy on a unique in-bounds passable tile', () => {
        const seen = new Set<string>();
        for (const u of sc.otherSideForces) {
          expect(passable(u.coordinate.q, u.coordinate.r), `${u.id} @ ${u.coordinate.q},${u.coordinate.r}`).toBe(true);
          const k = `${u.coordinate.q},${u.coordinate.r}`;
          expect(seen.has(k), `${u.id} overlaps another unit at ${k}`).toBe(false);
          seen.add(k);
        }
        expect(sc.otherSideForces.length).toBeGreaterThan(0);
      });

      it('puts every objective target on a passable tile', () => {
        for (const o of sc.objectives) {
          if (o.target) expect(passable(o.target.q, o.target.r), `objective ${o.id} @ ${o.target.q},${o.target.r}`).toBe(true);
        }
      });

      it('spawns every enemy on a tile reachable from the alliance zone', () => {
        // BFS the passable component from the alliance zone; every enemy must be inside it (no stranded
        // foes the player can never reach — which previously caused forced timeouts).
        const seen = new Set<string>(sc.startZones.alliance.map((c) => `${c.q},${c.r}`));
        const queue = sc.startZones.alliance.slice();
        while (queue.length) {
          const cur = queue.shift()!;
          for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
            if (dq === 0 && dr === 0) continue;
            const nq = cur.q + dq, nr = cur.r + dr, k = `${nq},${nr}`;
            if (!seen.has(k) && passable(nq, nr)) { seen.add(k); queue.push({ q: nq, r: nr }); }
          }
        }
        for (const u of sc.otherSideForces) {
          expect(seen.has(`${u.coordinate.q},${u.coordinate.r}`), `${u.id} @ ${u.coordinate.q},${u.coordinate.r} unreachable`).toBe(true);
        }
      });

      it('keeps the two deploy zones connected (not walled off)', () => {
        // 8-neighbour BFS over passable tiles from the alliance zone; must reach an otherSide tile.
        const start = sc.startZones.alliance[0];
        const goals = new Set(sc.startZones.otherSide.map((c) => `${c.q},${c.r}`));
        const seen = new Set<string>([`${start.q},${start.r}`]);
        const queue = [start];
        let reached = false;
        while (queue.length) {
          const cur = queue.shift()!;
          if (goals.has(`${cur.q},${cur.r}`)) { reached = true; break; }
          for (let dq = -1; dq <= 1; dq++) for (let dr = -1; dr <= 1; dr++) {
            if (dq === 0 && dr === 0) continue;
            const nq = cur.q + dq, nr = cur.r + dr;
            const k = `${nq},${nr}`;
            if (!seen.has(k) && passable(nq, nr)) { seen.add(k); queue.push({ q: nq, r: nr }); }
          }
        }
        expect(reached).toBe(true);
      });
    });
  }
});
