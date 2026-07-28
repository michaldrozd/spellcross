import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { cityScenarios, TACTICAL_MAP_SCALE_BANDS } from './city-battlefields.js';

const inBounds = (q: number, r: number, w: number, h: number) => q >= 0 && q < w && r >= 0 && r < h;

describe('Per-city battlefields', () => {
  it('generates one scenario per sector', () => {
    expect(cityScenarios.length).toBe(29);
    expect(new Set(cityScenarios.map((s) => s.id)).size).toBe(29); // unique ids
    expect(new Set(cityScenarios.map((s) => s.map.id)).size).toBe(29); // unique maps
  });

  it('gives every sector a distinct deterministic battlefield layout', () => {
    const hashes = cityScenarios.map((scenario) => createHash('sha256').update(JSON.stringify({
      width: scenario.map.width,
      height: scenario.map.height,
      tiles: scenario.map.tiles.map((tile) => [
        tile.terrain,
        tile.elevation,
        tile.cover,
        tile.movementCostModifier,
        tile.passable,
        tile.providesVisionBoost,
        tile.blocksVision
      ]),
      props: scenario.map.props?.map((prop) => [
        prop.kind,
        prop.coordinate.q,
        prop.coordinate.r,
        prop.w,
        prop.h,
        prop.levels,
        prop.texture,
        prop.scale,
        prop.flipX
      ])
    })).digest('hex'));

    expect(new Set(hashes).size).toBe(cityScenarios.length);
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
        const seen = new Set((sc.allianceForces ?? []).map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`));
        for (const u of sc.otherSideForces) {
          expect(passable(u.coordinate.q, u.coordinate.r), `${u.id} @ ${u.coordinate.q},${u.coordinate.r}`).toBe(true);
          const k = `${u.coordinate.q},${u.coordinate.r}`;
          expect(seen.has(k), `${u.id} overlaps another unit at ${k}`).toBe(false);
          seen.add(k);
        }
        expect(sc.otherSideForces.length).toBeGreaterThan(0);
      });

      it('defines valid reserve events without overlapping any arrivals', () => {
        expect(sc.events?.length).toBeGreaterThanOrEqual(1);
        const occupied = new Set([
          ...sc.otherSideForces.map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`),
          ...(sc.allianceForces ?? []).map((unit) => `${unit.coordinate.q},${unit.coordinate.r}`)
        ]);
        const precedingEvents = new Set<string>();
        for (const event of sc.events ?? []) {
          if (event.triggerAfterEventId) expect(precedingEvents.has(event.triggerAfterEventId)).toBe(true);
          const arrivals = new Set<string>();
          for (const reinforcement of event.reinforcements) {
            const key = `${reinforcement.coordinate.q},${reinforcement.coordinate.r}`;
            expect(passable(reinforcement.coordinate.q, reinforcement.coordinate.r), `${reinforcement.id} @ ${key}`).toBe(true);
            expect(occupied.has(key), `${reinforcement.id} overlaps an initial unit at ${key}`).toBe(false);
            expect(arrivals.has(key), `${reinforcement.id} overlaps another arrival at ${key}`).toBe(false);
            arrivals.add(key);
            occupied.add(key);
          }
          precedingEvents.add(event.id);
        }
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

  it('adds a key rescue team with matching reach and protect objectives in Brussels', () => {
    const scenario = cityScenarios.find((candidate) => candidate.id === 'city-sector-brussels');
    const rescueTeam = scenario?.allianceForces?.find((unit) => unit.id === 'sector-brussels-pilot');
    expect(rescueTeam?.definitionId).toBe('rangers');
    expect(rescueTeam?.isKey).toBe(true);
    expect(scenario?.objectives.filter((objective) => objective.unitIds?.includes('sector-brussels-pilot')).map((objective) => objective.kind).sort()).toEqual(['protect', 'reach']);
  });

  it('adds a key supply convoy with matching reach and protect objectives in Amsterdam', () => {
    const scenario = cityScenarios.find((candidate) => candidate.id === 'city-sector-amsterdam');
    const convoy = scenario?.allianceForces?.find((unit) => unit.id === 'sector-amsterdam-convoy');
    expect(convoy?.definitionId).toBe('supply-truck');
    expect(convoy?.isKey).toBe(true);
    expect(scenario?.objectives.filter((objective) => objective.unitIds?.includes('sector-amsterdam-convoy')).map((objective) => objective.kind).sort()).toEqual(['protect', 'reach']);
  });

  it.each([
    ['sector-amsterdam', 'early', 14],
    ['sector-ashen-confluence', 'mid', 18],
    ['sector-ash-compass', 'late', 35]
  ] as const)('authors %s as a paced %s convoy battlefield', (territoryId, band, enemyCount) => {
    const scenario = cityScenarios.find((candidate) => candidate.id === `city-${territoryId}`);
    if (!scenario) throw new Error(`missing ${territoryId}`);
    const profile = TACTICAL_MAP_SCALE_BANDS[band];
    const convoy = scenario.allianceForces?.find((unit) => unit.id === `${territoryId}-convoy`);
    const destination = scenario.objectives.find((objective) => objective.id === `${territoryId}-reach`);
    const progress = (coordinate: { q: number; r: number }) => (
      coordinate.q / Math.max(1, scenario.map.width - 1)
      + 1 - coordinate.r / Math.max(1, scenario.map.height - 1)
    ) / 2;

    expect(scenario.map).toMatchObject({ width: profile.width, height: profile.height });
    expect(scenario.map.tiles).toHaveLength(profile.width * profile.height);
    expect(scenario.startZones.alliance).toHaveLength(profile.deploymentWidth * profile.deploymentDepth);
    expect(scenario.startZones.otherSide).toHaveLength(profile.deploymentWidth * profile.deploymentDepth);
    expect(scenario.otherSideForces).toHaveLength(enemyCount);
    expect(scenario.map.tiles.length / scenario.otherSideForces.length)
      .toBeLessThanOrEqual(profile.maxCellsPerEnemy);
    expect(convoy && progress(convoy.coordinate)).toBeLessThan(0.2);
    expect(destination?.target && progress(destination.target)).toBeGreaterThan(0.72);
    expect(destination?.turnLimit).toBe(profile.travelDeadlineRound);
    expect(scenario.events?.[0]?.triggerRound).toBe(profile.reserveRound);

    const enemyProgress = scenario.otherSideForces.map((unit) => progress(unit.coordinate));
    for (const patrolProgress of profile.patrolProgress) {
      expect(
        enemyProgress.some((enemy) => Math.abs(enemy - patrolProgress) <= 0.035),
        `${territoryId} is missing its patrol at ${patrolProgress}`
      ).toBe(true);
    }

    const visionTerrain = scenario.map.tiles.filter((tile) => (
      tile.providesVisionBoost || tile.blocksVision
    )).length / scenario.map.tiles.length;
    expect(visionTerrain).toBeGreaterThan(0.12);
    expect(visionTerrain).toBeLessThan(0.75);
  });

  it.each([
    ['sector-strasbourg', 'early', 14, undefined],
    ['sector-vienna', 'early', 14, undefined],
    ['sector-warsaw', 'mid', 18, undefined],
    ['sector-blacksea', 'mid', 18, undefined],
    ['sector-sable-causeway', 'late', 35, 14],
    ['sector-glass-wake', 'late', 35, undefined]
  ] as const)(
    'authors %s as a defended %s bridgehead',
    (territoryId, band, enemyCount, specialistDeadlineRound) => {
      const scenario = cityScenarios.find((candidate) => candidate.id === `city-${territoryId}`);
      if (!scenario) throw new Error(`missing ${territoryId}`);
      const profile = TACTICAL_MAP_SCALE_BANDS[band];
      const chargePoint = scenario.objectives.find((objective) => objective.id === `${territoryId}-reach`);
      const eliminate = scenario.objectives.find((objective) => objective.id === `${territoryId}-eliminate`);
      const progress = (coordinate: { q: number; r: number }) => (
        coordinate.q / Math.max(1, scenario.map.width - 1)
        + 1 - coordinate.r / Math.max(1, scenario.map.height - 1)
      ) / 2;

      expect(scenario.map).toMatchObject({ width: profile.width, height: profile.height });
      expect(scenario.startZones.alliance).toHaveLength(profile.deploymentWidth * profile.deploymentDepth);
      expect(scenario.startZones.otherSide).toHaveLength(profile.deploymentWidth * profile.deploymentDepth);
      expect(scenario.otherSideForces).toHaveLength(enemyCount);
      expect(scenario.map.tiles.length / scenario.otherSideForces.length)
        .toBeLessThanOrEqual(profile.maxCellsPerEnemy);
      expect(chargePoint).toMatchObject({
        kind: 'interact',
        actionKey: 'plantCharges'
      });
      expect(chargePoint?.deadlineRound).toBe(specialistDeadlineRound);
      expect(chargePoint?.target && progress(chargePoint.target)).toBeGreaterThan(0.72);
      expect(eliminate).toMatchObject({ kind: 'eliminate' });
      expect(eliminate?.turnLimit).toBeUndefined();
      expect(eliminate?.deadlineRound).toBeUndefined();
      expect(scenario.events?.[0]?.triggerRound).toBe(profile.reserveRound);

      const enemyProgress = scenario.otherSideForces.map((unit) => progress(unit.coordinate));
      for (const patrolProgress of profile.patrolProgress) {
        expect(
          enemyProgress.some((enemy) => Math.abs(enemy - patrolProgress) <= 0.035),
          `${territoryId} is missing its patrol at ${patrolProgress}`
        ).toBe(true);
      }
      for (const enemy of scenario.otherSideForces) {
        expect(Math.min(...scenario.startZones.alliance.map((coordinate) => (
          Math.max(
            Math.abs(enemy.coordinate.q - coordinate.q),
            Math.abs(enemy.coordinate.r - coordinate.r)
          )
        )))).toBeGreaterThan(6);
      }
    }
  );

  it.each([
    ['sector-berlin', 'signalEaterAwakes', 'signal-eater'],
    ['sector-krakow', 'glassChoirMarches', 'glass-regent'],
    ['sector-rift', 'ashCrownDescends', 'ash-crown-sovereign'],
    ['sector-veil-heart', 'veilHeartManifests', 'black-angel']
  ] as const)('gives %s a chained signature encounter', (territoryId, messageKey, leadDefinitionId) => {
    const scenario = cityScenarios.find((candidate) => candidate.id === `city-${territoryId}`);
    expect(scenario?.events).toHaveLength(territoryId === 'sector-rift' ? 3 : 2);
    const [reserve, signature] = scenario?.events ?? [];
    expect(signature?.triggerAfterEventId).toBe(reserve?.id);
    expect(signature?.messageKey).toBe(messageKey);
    expect(signature?.reinforcements[0]?.definitionId).toBe(leadDefinitionId);
  });

  it.each([
    'sector-quiet-meridian',
    'sector-glass-wake',
    'sector-ash-compass',
    'sector-dawn-anchor'
  ])('gives aftermath operation %s a complete deterministic battlefield', (territoryId) => {
    const scenario = cityScenarios.find((candidate) => candidate.id === `city-${territoryId}`);
    expect(scenario?.map.id).toBe(`city-${territoryId}`);
    expect(scenario?.map.tiles.length).toBe((scenario?.map.width ?? 0) * (scenario?.map.height ?? 0));
    expect(scenario?.objectives.length).toBeGreaterThanOrEqual(2);
    expect(scenario?.startZones.alliance.length).toBeGreaterThan(0);
    expect(scenario?.otherSideForces.length).toBeGreaterThan(0);
  });

  it('fields the winged fiend in Berlin without changing its signature encounter', () => {
    const scenario = cityScenarios.find((candidate) => candidate.id === 'city-sector-berlin');
    const [reserve, signature] = scenario?.events ?? [];
    expect(reserve?.reinforcements.map((unit) => unit.definitionId)).toEqual([
      'ogre-brute', 'winged-fiend', 'warlock', 'salamander'
    ]);
    expect(signature?.reinforcements.map((unit) => unit.definitionId)).toEqual([
      'signal-eater', 'death-knight', 'warlock', 'hell-rider'
    ]);
  });

  it('rewards the optional Rift ward action with one Alliance ranger', () => {
    const scenario = cityScenarios.find((candidate) => candidate.id === 'city-sector-rift');
    const objective = scenario?.objectives.find((candidate) => candidate.id === 'sector-rift-disrupt-ward');
    const reward = scenario?.events?.find((event) => event.triggerObjectiveId === objective?.id);

    expect(objective).toMatchObject({ kind: 'interact', optional: true, actionKey: 'disruptWard', actionPoints: 2 });
    expect(reward).toMatchObject({ faction: 'alliance', messageKey: 'wardBeaconSecured' });
    expect(reward?.reinforcements).toHaveLength(1);
    expect(reward?.reinforcements[0]?.definitionId).toBe('rangers');
  });

  it('rewards the optional Confluence beacon action with one Alliance artillery unit', () => {
    const scenario = cityScenarios.find((candidate) => candidate.id === 'city-sector-ashen-confluence');
    const objective = scenario?.objectives.find((candidate) => candidate.id === 'sector-ashen-confluence-align-beacon');
    const reward = scenario?.events?.find((event) => event.triggerObjectiveId === objective?.id);

    expect(objective).toMatchObject({
      kind: 'interact',
      optional: true,
      actionKey: 'alignEchoBeacon',
      actionPoints: 3
    });
    expect(reward).toMatchObject({ faction: 'alliance', messageKey: 'echoBatteryArrives' });
    expect(reward?.triggerRound).toBeUndefined();
    expect(reward?.triggerEnemyRemaining).toBeUndefined();
    expect(reward?.reinforcements).toHaveLength(1);
    expect(reward?.reinforcements[0]?.definitionId).toBe('thunderhead-155');
  });

  it('authors all three event-effect families across four reachable Act II operations', () => {
    const expected = {
      'sector-lantern-vault': ['revealObjective'],
      'sector-sable-causeway': ['transformTerrain'],
      'sector-mnemonic-orchard': ['pressurePulse'],
      'sector-thorn-engine': ['transformTerrain', 'revealObjective']
    } as const;
    const scenariosWithEffects = cityScenarios.filter((scenario) => (
      scenario.events?.some((event) => event.effects?.length)
    ));
    expect(scenariosWithEffects.map((scenario) => scenario.id).sort()).toEqual(
      Object.keys(expected).map((territoryId) => `city-${territoryId}`).sort()
    );

    for (const [territoryId, effectKinds] of Object.entries(expected)) {
      const scenario = scenariosWithEffects.find((candidate) => candidate.id === `city-${territoryId}`);
      const event = scenario?.events?.find((candidate) => candidate.effects?.length);
      expect(event?.effects?.map((effect) => effect.kind)).toEqual(effectKinds);
      if (territoryId === 'sector-sable-causeway') {
        expect(event).toMatchObject({
          triggerObjectiveId: 'sector-sable-causeway-reach',
          reinforcements: []
        });
      } else {
        expect(event?.reinforcements.length).toBeGreaterThan(0);
      }
      for (const effect of event?.effects ?? []) {
        if (effect.kind === 'revealObjective') {
          expect(effect.objective.optional).toBe(true);
          expect(scenario?.objectives.some((objective) => objective.id === effect.objective.id)).toBe(false);
          expect(inBounds(
            effect.objective.target?.q ?? -1,
            effect.objective.target?.r ?? -1,
            scenario?.map.width ?? 0,
            scenario?.map.height ?? 0
          )).toBe(true);
        } else if (effect.kind === 'transformTerrain') {
          expect(effect.tiles.length).toBeGreaterThan(0);
          for (const change of effect.tiles) {
            expect(inBounds(change.coordinate.q, change.coordinate.r, scenario?.map.width ?? 0, scenario?.map.height ?? 0)).toBe(true);
            expect(change.tile.passable).toBe(true);
            expect(scenario?.map.tiles[
              change.coordinate.r * (scenario?.map.width ?? 0) + change.coordinate.q
            ]?.terrain).not.toBe(change.tile.terrain);
          }
        } else {
          expect(effect.coordinates).toHaveLength(6);
          expect(effect.targetFaction).toBe('alliance');
          expect(effect.healthDamage).toBe(12);
          expect(effect.moraleDamage).toBe(18);
          expect(effect.coordinates.every((coordinate) => (
            inBounds(coordinate.q, coordinate.r, scenario?.map.width ?? 0, scenario?.map.height ?? 0)
          ))).toBe(true);
        }
      }
    }
  });

  it('ships three essential deadline interactions with attached key specialists', () => {
    const expected = {
      'sector-lantern-vault': {
        objectiveId: 'sector-lantern-vault-calibrate-prism',
        specialistId: 'sector-lantern-vault-pilot'
      },
      'sector-sable-causeway': {
        objectiveId: 'sector-sable-causeway-reach',
        specialistId: 'sector-sable-causeway-wardbreaker'
      },
      'sector-mnemonic-orchard': {
        objectiveId: 'sector-mnemonic-orchard-ground-lattice',
        specialistId: 'sector-mnemonic-orchard-psi-specialist'
      }
    } as const;

    for (const [territoryId, signature] of Object.entries(expected)) {
      const scenario = cityScenarios.find((candidate) => candidate.id === `city-${territoryId}`);
      const objective = scenario?.objectives.find((candidate) => candidate.id === signature.objectiveId) as
        | (NonNullable<typeof scenario>['objectives'][number] & {
            essential?: boolean;
            deadlineRound?: number;
          })
        | undefined;
      const specialist = scenario?.allianceForces?.find((unit) => unit.id === signature.specialistId);

      expect(objective).toMatchObject({
        kind: 'interact',
        essential: true,
        unitIds: [signature.specialistId]
      });
      expect(objective?.deadlineRound).toBeGreaterThan(1);
      expect(specialist?.isKey).toBe(true);
      expect(specialist && scenario?.map.tiles[
        specialist.coordinate.r * scenario.map.width + specialist.coordinate.q
      ]?.passable).toBe(true);
      expect(scenario?.objectives).toContainEqual(expect.objectContaining({
        kind: 'protect',
        unitIds: [signature.specialistId]
      }));
    }
  });
});
