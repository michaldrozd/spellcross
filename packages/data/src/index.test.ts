import { describe, expect, it } from 'vitest';

import { loadContentBundle, starterBundle, validatedStarterBundle } from './index.js';
import { cityScenarioIdByTerritory } from './city-battlefields.js';

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

  it('keeps all cross-references resolvable', () => {
    const bundle = validatedStarterBundle;
    const unitIds = new Set(bundle.units.map((u) => u.id));
    const scenarioIds = new Set(bundle.scenarios.map((s) => s.id));
    const researchIds = new Set(bundle.research.map((r) => r.id));
    const territories = bundle.campaigns[0].territories;
    const territoryIds = new Set(territories.map((t) => t.id));

    for (const topic of bundle.research) {
      for (const req of topic.requires ?? []) {
        expect(researchIds, `research ${topic.id} requires ${req}`).toContain(req);
      }
      for (const unlock of topic.unlocks) {
        // unlocks are either unit ids or feature flags like supply-truck-unlock
        if (unitIds.has(unlock)) continue;
        expect(unlock, `research ${topic.id} unlock ${unlock} looks like a typo'd unit id`).toMatch(/-unlock$|^feature-/);
      }
    }

    for (const territory of territories) {
      expect(scenarioIds, `territory ${territory.id} scenario`).toContain(territory.scenarioId);
      for (const req of territory.requires ?? []) {
        expect(territoryIds, `territory ${territory.id} requires ${req}`).toContain(req);
      }
    }

    // a typo'd territoryId in CITY_CONFIGS silently falls back to a legacy shared map
    for (const territory of territories) {
      expect(cityScenarioIdByTerritory, `territory ${territory.id} has no city battlefield`).toHaveProperty(territory.id);
    }

    for (const scenario of bundle.scenarios) {
      for (const force of [...scenario.otherSideForces, ...(scenario.allianceForces ?? [])]) {
        expect(unitIds, `scenario ${scenario.id} spawns ${force.definitionId}`).toContain(force.definitionId);
      }
    }

    for (const unit of bundle.units) {
      const ranges = Object.keys(unit.stats.weaponRanges).sort();
      expect(Object.keys(unit.stats.weaponPower).sort(), `unit ${unit.id} weaponPower keys`).toEqual(ranges);
      expect(Object.keys(unit.stats.weaponAccuracy).sort(), `unit ${unit.id} weaponAccuracy keys`).toEqual(ranges);
      for (const weapon of Object.keys(unit.stats.weaponTargets ?? {})) {
        expect(ranges, `unit ${unit.id} weaponTargets ${weapon}`).toContain(weapon);
      }
    }
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
