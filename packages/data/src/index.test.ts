import { describe, expect, it } from 'vitest';

import { loadContentBundle, starterBundle, validatedStarterBundle } from './index.js';

describe('data bundle', () => {
  it('validates starter bundle structure', () => {
    const bundle = loadContentBundle(starterBundle);
    expect(bundle.units.length).toBeGreaterThan(5);
    expect(bundle.research.length).toBeGreaterThan(0);
    expect(bundle.scenarios.length).toBeGreaterThan(1);
    expect(bundle.campaigns.length).toBe(1);
  });

  it('exports a prevalidated bundle', () => {
    expect(validatedStarterBundle.units[0].id).toBeDefined();
    expect(validatedStarterBundle.campaigns[0].territories.length).toBeGreaterThan(0);
  });

  it('pays out monotonically with difficulty so harder sectors fund the next tier', () => {
    const territories = validatedStarterBundle.campaigns[0].territories.filter((t) => t.difficulty);
    const maxByTier = new Map<number, number>();
    const minByTier = new Map<number, number>();
    for (const t of territories) {
      const d = t.difficulty!;
      maxByTier.set(d, Math.max(maxByTier.get(d) ?? 0, t.reward.money));
      minByTier.set(d, Math.min(minByTier.get(d) ?? Infinity, t.reward.money));
    }
    for (let d = 2; d <= 5; d++) {
      if (!minByTier.has(d) || !maxByTier.has(d - 1)) continue;
      // no sector of difficulty d may pay less than the best-paying sector of difficulty d-1
      expect(minByTier.get(d)!).toBeGreaterThan(maxByTier.get(d - 1)!);
    }
  });
});
