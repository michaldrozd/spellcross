import { describe, expect, it } from 'vitest';

import { cityScenarioIdByTerritory } from './city-battlefields.js';
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
    expect(validatedStarterBundle.scenarios
      .filter((scenario) => scenario.id.startsWith('city-'))
      .every((scenario) => Boolean(scenario.map.environment))).toBe(true);
  });

  it('rejects fire modes for weapons a unit does not have', () => {
    const invalidBundle = structuredClone(starterBundle);
    invalidBundle.units[0].stats.weaponFireModes = { missing: 'indirect' };
    expect(() => loadContentBundle(invalidBundle)).toThrow(/Unknown weapon missing/);
  });

  it('classifies only authored spotter-enabled weapons as indirect fire', () => {
    const indirectWeapons = validatedStarterBundle.units.flatMap((unit) =>
      Object.entries(unit.stats.weaponFireModes ?? {})
        .filter(([, mode]) => mode === 'indirect')
        .map(([weaponId]) => `${unit.id}:${weaponId}`)
    ).sort();
    expect(indirectWeapons).toEqual([
      'badger-mortar-carrier:mortar',
      'firefly-105:fragment-shell',
      'ironroot-colossus:spore-mortar',
      'mlrs-battery:rockets',
      'mortar-team:mortar',
      'spg-m109:howitzer',
      'tempest-counterbattery:counterbattery-shell',
      'thunderhead-155:howitzer'
    ]);
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
      const reinforcements = (scenario.events ?? []).flatMap((event) => event.reinforcements);
      for (const force of [...scenario.otherSideForces, ...(scenario.allianceForces ?? []), ...reinforcements]) {
        expect(unitIds, `scenario ${scenario.id} spawns ${force.definitionId}`).toContain(force.definitionId);
      }
    }

    for (const unit of bundle.units) {
      const ranges = Object.keys(unit.stats.weaponRanges).sort();
      expect(Object.keys(unit.stats.weaponPower).sort(), `unit ${unit.id} weaponPower keys`).toEqual(ranges);
      expect(Object.keys(unit.stats.weaponAccuracy).sort(), `unit ${unit.id} weaponAccuracy keys`).toEqual(ranges);
      for (const weapon of Object.keys(unit.stats.weaponFireModes ?? {})) {
        expect(ranges, `unit ${unit.id} weaponFireModes ${weapon}`).toContain(weapon);
      }
      for (const weapon of Object.keys(unit.stats.weaponTargets ?? {})) {
        expect(ranges, `unit ${unit.id} weaponTargets ${weapon}`).toContain(weapon);
      }
    }
  });

  it('ships at least eighty unique authored unit definitions with no dead roster entries', () => {
    const bundle = validatedStarterBundle;
    const ids = bundle.units.map((unit) => unit.id);
    const names = bundle.units.map((unit) => unit.name);
    expect(ids.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);

    const campaign = bundle.campaigns[0];
    const obtainableAlliance = new Set([
      ...campaign.startingUnits.map((unit) => unit.definitionId),
      ...bundle.research.flatMap((topic) => topic.unlocks)
    ]);
    for (const unit of bundle.units.filter((candidate) => candidate.faction === 'alliance')) {
      expect(obtainableAlliance, `Alliance unit ${unit.id} is neither starting nor research-unlocked`).toContain(unit.id);
    }

    const encounteredEnemies = new Set(bundle.scenarios.flatMap((scenario) => [
      ...scenario.otherSideForces.map((unit) => unit.definitionId),
      ...(scenario.events ?? []).flatMap((event) => event.reinforcements.map((unit) => unit.definitionId))
    ]));
    for (const unit of bundle.units.filter((candidate) => candidate.faction === 'otherSide')) {
      expect(encounteredEnemies, `Other Side unit ${unit.id} never appears in campaign content`).toContain(unit.id);
    }
  });

  it('gives the new Alliance fire-support units separate tactical jobs', () => {
    const byId = new Map(validatedStarterBundle.units.map((unit) => [unit.id, unit]));
    const firefly = byId.get('firefly-105')!;
    const badger = byId.get('badger-mortar-carrier')!;
    const thunderhead = byId.get('thunderhead-155')!;
    const tempest = byId.get('tempest-counterbattery')!;
    const radar = byId.get('horizon-radar')!;

    expect(firefly.stats.weaponTargets?.['fragment-shell']).toEqual(['infantry', 'support', 'hero']);
    expect(badger.stats.mobility).toBeGreaterThan(thunderhead.stats.mobility);
    expect(thunderhead.stats.weaponPower.howitzer).toBeGreaterThan(badger.stats.weaponPower.mortar);
    expect(tempest.stats.weaponRanges['counterbattery-shell']).toBeGreaterThan(thunderhead.stats.weaponRanges.howitzer);
    expect(tempest.stats.weaponTargets?.['counterbattery-shell']).toEqual(['vehicle', 'artillery', 'support']);
    expect(radar.stats.vision).toBe(12);
    expect(radar.stats.ammoCapacity).toBeUndefined();
    expect(Object.keys(radar.stats.weaponRanges)).toHaveLength(0);
  });

  it('reserves zero-capacity support classification for the supply truck', () => {
    const supplyDefinitions = validatedStarterBundle.units
      .filter((unit) => unit.type === 'support' && unit.stats.ammoCapacity === 0)
      .map((unit) => unit.id)
      .sort();

    expect(supplyDefinitions).toEqual(['supply-truck']);
  });

  it('requires complete and satisfiable mission-action definitions', () => {
    const missingAction = structuredClone(starterBundle);
    missingAction.scenarios[0].objectives = [{
      id: 'terminal',
      kind: 'interact',
      description: 'Use the terminal.',
      target: { q: 1, r: 1 },
      actionPoints: 2
    }];
    expect(() => loadContentBundle(missingAction)).toThrow(/Interact objective requires an action key/);

    const missingCost = structuredClone(starterBundle);
    missingCost.scenarios[0].objectives = [{
      id: 'terminal',
      kind: 'interact',
      description: 'Use the terminal.',
      target: { q: 1, r: 1 },
      actionKey: 'disruptWard'
    }];
    expect(() => loadContentBundle(missingCost)).toThrow(/Interact objective requires an AP cost/);

    const zeroCost = structuredClone(starterBundle);
    zeroCost.scenarios[0].objectives = [{
      id: 'terminal',
      kind: 'interact',
      description: 'Use the terminal.',
      target: { q: 1, r: 1 },
      actionKey: 'disruptWard',
      actionPoints: 0
    }];
    expect(() => loadContentBundle(zeroCost)).toThrow();

    const restrictedRequired = structuredClone(starterBundle);
    restrictedRequired.scenarios[0].objectives = [{
      id: 'terminal',
      kind: 'interact',
      description: 'Use the terminal.',
      target: { q: 1, r: 1 },
      unitIds: ['captain'],
      actionKey: 'disruptWard',
      actionPoints: 2
    }];
    expect(() => loadContentBundle(restrictedRequired)).toThrow(/Required interact objectives cannot restrict eligible units/);
  });

  it('requires valid tactical event triggers and references', () => {
    const triggerless = structuredClone(starterBundle);
    triggerless.scenarios[0].events = [{
      id: 'reserve',
      messageKey: 'wardBeaconSecured',
      faction: 'alliance',
      reinforcements: [{ id: 'ranger', definitionId: 'rangers', coordinate: { q: 1, r: 1 } }]
    }];
    expect(() => loadContentBundle(triggerless)).toThrow(/requires a round, attrition, or objective trigger/);

    const unknownObjective = structuredClone(starterBundle);
    unknownObjective.scenarios[0].events = [{
      id: 'reserve',
      triggerObjectiveId: 'missing-objective',
      messageKey: 'wardBeaconSecured',
      faction: 'alliance',
      reinforcements: [{ id: 'ranger', definitionId: 'rangers', coordinate: { q: 1, r: 1 } }]
    }];
    expect(() => loadContentBundle(unknownObjective)).toThrow(/Unknown objective trigger missing-objective/);

    const unknownPrerequisite = structuredClone(starterBundle);
    unknownPrerequisite.scenarios[0].events = [{
      id: 'reserve',
      triggerRound: 2,
      triggerAfterEventId: 'missing-event',
      messageKey: 'wardBeaconSecured',
      faction: 'alliance',
      reinforcements: [{ id: 'ranger', definitionId: 'rangers', coordinate: { q: 1, r: 1 } }]
    }];
    expect(() => loadContentBundle(unknownPrerequisite)).toThrow(/Unknown prerequisite event missing-event/);
  });

  it('keeps hostile reinforcement waves reachable when objective triggers are optional', () => {
    const optionalOnly = structuredClone(starterBundle);
    optionalOnly.scenarios[0].objectives.push({
      id: 'optional-terminal',
      kind: 'interact',
      description: 'Use the optional terminal.',
      target: { q: 1, r: 1 },
      optional: true,
      actionKey: 'disruptWard',
      actionPoints: 2
    });
    optionalOnly.scenarios[0].events = [{
      id: 'hidden-hostiles',
      triggerObjectiveId: 'optional-terminal',
      messageKey: 'portalSurge',
      faction: 'otherSide',
      reinforcements: [{ id: 'hidden-orc', definitionId: 'orc-warband', coordinate: { q: 2, r: 2 } }]
    }];
    expect(() => loadContentBundle(optionalOnly)).toThrow(
      /cannot depend only on optional objective optional-terminal/
    );

    const timedFallback = structuredClone(optionalOnly);
    timedFallback.scenarios[0].events![0].triggerRound = 2;
    expect(() => loadContentBundle(timedFallback)).not.toThrow();

    const requiredTrigger = structuredClone(starterBundle);
    requiredTrigger.scenarios[0].events = [{
      id: 'required-hostiles',
      triggerObjectiveId: requiredTrigger.scenarios[0].objectives[0].id,
      messageKey: 'portalSurge',
      faction: 'otherSide',
      reinforcements: [{ id: 'required-orc', definitionId: 'orc-warband', coordinate: { q: 2, r: 2 } }]
    }];
    expect(() => loadContentBundle(requiredTrigger)).not.toThrow();
  });

  it('rejects mission targets outside their battlefield', () => {
    const outsideMap = structuredClone(starterBundle);
    outsideMap.scenarios[0].objectives[0].target = {
      q: outsideMap.scenarios[0].map.width,
      r: outsideMap.scenarios[0].map.height - 1
    };
    expect(() => loadContentBundle(outsideMap)).toThrow(/is outside the battlefield/);
  });

  it('ships bridge demolitions as paid interactions and an optional Rift reserve action', () => {
    const bridgeheads = validatedStarterBundle.scenarios.filter((scenario) => (
      scenario.id === 'bridgehead'
      || ['city-sector-strasbourg', 'city-sector-vienna', 'city-sector-warsaw', 'city-sector-blacksea'].includes(scenario.id)
    ));
    expect(bridgeheads).toHaveLength(5);
    for (const scenario of bridgeheads) {
      expect(scenario.objectives.find((objective) => objective.actionKey === 'plantCharges')).toMatchObject({
        kind: 'interact',
        actionPoints: 2
      });
    }

    const rift = validatedStarterBundle.scenarios.find((scenario) => scenario.id === 'city-sector-rift');
    expect(rift?.objectives.find((objective) => objective.id === 'sector-rift-disrupt-ward')).toMatchObject({
      kind: 'interact',
      optional: true,
      actionKey: 'disruptWard',
      actionPoints: 2
    });
    expect(rift?.events?.find((event) => event.triggerObjectiveId === 'sector-rift-disrupt-ward')).toMatchObject({
      faction: 'alliance',
      messageKey: 'wardBeaconSecured'
    });
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
