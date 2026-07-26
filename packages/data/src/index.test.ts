import { describe, expect, it } from 'vitest';

import { cityScenarioIdByTerritory } from './city-battlefields.js';
import { loadContentBundle, starterBundle, validatedStarterBundle } from './index.js';

const makeOutcomeRouteBundle = () => {
  const bundle = structuredClone(starterBundle);
  const campaign = bundle.campaigns[0];
  const source = campaign.territories.find((territory) => territory.id === 'sector-paris');
  const victory = campaign.territories.find((territory) => territory.id === 'sector-lyon');
  const defeat = campaign.territories.find((territory) => territory.id === 'sector-brussels');
  if (!source || !victory || !defeat) throw new Error('expected route test territories');

  source.requires = undefined;
  victory.requires = undefined;
  victory.route = { territoryId: source.id, result: 'victory' };
  defeat.requires = undefined;
  defeat.route = { territoryId: source.id, result: 'defeat' };
  campaign.territories = [source, victory, defeat];
  campaign.actTimeBonuses = undefined;
  return bundle;
};

describe('data bundle', () => {
  it('validates starter bundle structure', () => {
    const bundle = loadContentBundle(starterBundle);
    expect(bundle.units.length).toBeGreaterThan(5);
    expect(bundle.research.length).toBeGreaterThan(0);
    expect(bundle.scenarios.length).toBeGreaterThan(1);
    expect(bundle.campaigns.length).toBe(1);
    expect(bundle.dossiers).toHaveLength(bundle.campaigns[0].territories.length);
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
      for (const req of territory.requiresAny ?? []) {
        expect(territoryIds, `territory ${territory.id} requires any ${req}`).toContain(req);
      }
      if (territory.route) {
        expect(territoryIds, `territory ${territory.id} routes from ${territory.route.territoryId}`)
          .toContain(territory.route.territoryId);
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

  it('gives every authored campaign sector one complete operation dossier', () => {
    const campaignTerritoryIds = validatedStarterBundle.campaigns[0].territories
      .map((territory) => territory.id)
      .sort();
    const dossierTerritoryIds = validatedStarterBundle.dossiers
      .map((dossier) => dossier.territoryId)
      .sort();

    expect(dossierTerritoryIds).toEqual(campaignTerritoryIds);
    expect(new Set(dossierTerritoryIds).size).toBe(dossierTerritoryIds.length);
    for (const dossier of validatedStarterBundle.dossiers) {
      expect(dossier.codename.length).toBeGreaterThan(4);
      expect(dossier.situation.length).toBeGreaterThan(40);
      expect(dossier.threat.length).toBeGreaterThan(40);
      expect(dossier.command.length).toBeGreaterThan(40);
      expect(dossier.victory.length).toBeGreaterThan(40);
      expect(dossier.defeat.length).toBeGreaterThan(40);
    }
  });

  it('rejects missing, duplicate, and unknown operation dossiers', () => {
    const missing = structuredClone(starterBundle);
    missing.dossiers = missing.dossiers.slice(1);
    expect(() => loadContentBundle(missing)).toThrow(/has no operation dossier/);

    const duplicate = structuredClone(starterBundle);
    duplicate.dossiers.push(structuredClone(duplicate.dossiers[0]));
    expect(() => loadContentBundle(duplicate)).toThrow(/Duplicate operation dossier/);

    const unknown = structuredClone(starterBundle);
    unknown.dossiers[0].territoryId = 'sector-nowhere';
    expect(() => loadContentBundle(unknown)).toThrow(/unknown territory sector-nowhere/);
  });

  it('accepts paired campaign outcome routes with a completion path for either result', () => {
    expect(() => loadContentBundle(makeOutcomeRouteBundle())).not.toThrow();
  });

  it('rejects unknown and self-referencing campaign route sources', () => {
    const unknown = makeOutcomeRouteBundle();
    unknown.campaigns[0].territories[1].route!.territoryId = 'sector-nowhere';
    expect(() => loadContentBundle(unknown)).toThrow(/routes from unknown territory sector-nowhere/);

    const self = makeOutcomeRouteBundle();
    const routedTerritory = self.campaigns[0].territories[1];
    routedTerritory.route!.territoryId = routedTerritory.id;
    expect(() => loadContentBundle(self)).toThrow(/cannot route from itself/);
  });

  it('rejects one-sided and deadlocked campaign outcome routes', () => {
    const oneSided = makeOutcomeRouteBundle();
    oneSided.campaigns[0].territories[2].route = undefined;
    expect(() => loadContentBundle(oneSided)).toThrow(/must define victory and defeat continuations/);

    const deadlocked = makeOutcomeRouteBundle();
    deadlocked.campaigns[0].territories[1].requires = ['sector-brussels'];
    expect(() => loadContentBundle(deadlocked)).toThrow(/cannot complete for route state/);
  });

  it('validates converging any-of campaign prerequisites', () => {
    const valid = makeOutcomeRouteBundle();
    const convergence = structuredClone(valid.campaigns[0].territories[0]);
    convergence.id = 'sector-convergence';
    convergence.name = 'Convergence';
    convergence.route = undefined;
    convergence.requires = undefined;
    convergence.requiresAny = ['sector-lyon', 'sector-brussels'];
    valid.campaigns[0].territories.push(convergence);
    valid.territories.push({
      ...structuredClone(valid.territories[0]),
      id: convergence.id,
      name: convergence.name
    });
    valid.dossiers.push({
      ...structuredClone(valid.dossiers[0]),
      territoryId: convergence.id,
      codename: 'Convergence Test'
    });
    expect(() => loadContentBundle(valid)).not.toThrow();

    const mixed = structuredClone(valid);
    mixed.campaigns[0].territories.at(-1)!.requires = ['sector-paris'];
    expect(() => loadContentBundle(mixed)).toThrow(/cannot combine requires and requiresAny/);

    const undersized = structuredClone(valid);
    undersized.campaigns[0].territories.at(-1)!.requiresAny = ['sector-lyon'];
    expect(() => loadContentBundle(undersized)).toThrow(/requiresAny must name at least two territories/);

    const duplicate = structuredClone(valid);
    duplicate.campaigns[0].territories.at(-1)!.requiresAny = ['sector-lyon', 'sector-lyon'];
    expect(() => loadContentBundle(duplicate)).toThrow(/requiresAny contains duplicate territory sector-lyon/);

    const unknown = structuredClone(valid);
    unknown.campaigns[0].territories.at(-1)!.requiresAny = ['sector-lyon', 'sector-nowhere'];
    expect(() => loadContentBundle(unknown)).toThrow(/requires unknown territory sector-nowhere/);

    const self = structuredClone(valid);
    self.campaigns[0].territories.at(-1)!.requiresAny = ['sector-lyon', 'sector-convergence'];
    expect(() => loadContentBundle(self)).toThrow(/cannot require itself/);

    const cyclic = structuredClone(valid);
    const lyon = cyclic.campaigns[0].territories.find((territory) => territory.id === 'sector-lyon')!;
    const brussels = cyclic.campaigns[0].territories.find((territory) => territory.id === 'sector-brussels')!;
    lyon.requiresAny = ['sector-convergence', 'sector-brussels'];
    brussels.requiresAny = ['sector-convergence', 'sector-lyon'];
    expect(() => loadContentBundle(cyclic)).toThrow(/cannot complete for route state/);
  });

  it('requires one time-credit target for an authored later act', () => {
    const valid = makeOutcomeRouteBundle();
    valid.campaigns[0].territories[1].act = 2;
    valid.campaigns[0].territories[2].act = 2;
    valid.campaigns[0].actTimeBonuses = [{
      act: 2,
      turns: { story: 2, commander: 2, veteran: 2 }
    }];
    expect(() => loadContentBundle(valid)).not.toThrow();

    const duplicate = structuredClone(valid);
    duplicate.campaigns[0].actTimeBonuses!.push(structuredClone(duplicate.campaigns[0].actTimeBonuses![0]));
    expect(() => loadContentBundle(duplicate)).toThrow(/duplicate time credit for act 2/);

    const missingAct = structuredClone(valid);
    for (const territory of missingAct.campaigns[0].territories) territory.act = undefined;
    expect(() => loadContentBundle(missingAct)).toThrow(/time credit for missing act 2/);
  });

  it('ships Veilbreak as a converging consequence route with a complete endgame', () => {
    const campaign = validatedStarterBundle.campaigns[0];
    const cinderGate = campaign.territories.find((territory) => territory.id === 'sector-cinder-gate');
    const lanternVault = campaign.territories.find((territory) => territory.id === 'sector-lantern-vault');
    const hollowTide = campaign.territories.find((territory) => territory.id === 'sector-hollow-tide');
    const confluence = campaign.territories.find((territory) => territory.id === 'sector-ashen-confluence');
    const causeway = campaign.territories.find((territory) => territory.id === 'sector-sable-causeway');
    const orchard = campaign.territories.find((territory) => territory.id === 'sector-mnemonic-orchard');
    const thornEngine = campaign.territories.find((territory) => territory.id === 'sector-thorn-engine');
    const veilHeart = campaign.territories.find((territory) => territory.id === 'sector-veil-heart');

    expect(cinderGate).toMatchObject({ act: 2, requires: ['sector-rift'], region: 'Shatterline' });
    expect(lanternVault).toMatchObject({
      act: 2,
      route: { territoryId: 'sector-cinder-gate', result: 'victory' }
    });
    expect(hollowTide).toMatchObject({
      act: 2,
      route: { territoryId: 'sector-cinder-gate', result: 'defeat' }
    });
    expect(confluence).toMatchObject({
      act: 2,
      requiresAny: ['sector-lantern-vault', 'sector-hollow-tide']
    });
    expect(causeway).toMatchObject({ act: 2, requires: ['sector-ashen-confluence'] });
    expect(orchard).toMatchObject({ act: 2, requires: ['sector-ashen-confluence'] });
    expect(thornEngine).toMatchObject({
      act: 2,
      requires: ['sector-sable-causeway', 'sector-mnemonic-orchard']
    });
    expect(veilHeart).toMatchObject({ act: 2, requires: ['sector-thorn-engine'] });
    expect(campaign.actTimeBonuses).toEqual([{
      act: 2,
      turns: { story: 7, commander: 7, veteran: 7 }
    }]);
    expect(campaign.territories.filter((territory) => territory.act === 2)).toHaveLength(8);
    expect(validatedStarterBundle.dossiers.filter((dossier) => dossier.chapter >= 5)).toHaveLength(8);
  });

  it('ships at least eighty unique authored unit definitions', () => {
    const bundle = validatedStarterBundle;
    const ids = bundle.units.map((unit) => unit.id);
    const names = bundle.units.map((unit) => unit.name);
    expect(ids.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
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
