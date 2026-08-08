import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startBattle } from './helpers';

function locale(language: 'en' | 'sk', namespace: string) {
  return JSON.parse(readFileSync(
    resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/${namespace}.json`),
    'utf8'
  )) as Record<string, any>;
}

test('scripted event effects have complete English and Slovak copy', () => {
  const battlePaths = [
    'lanternArchiveRevealed',
    'causewayWardBreaks',
    'orchardMemoryPulse',
    'thornRegulatorOpens'
  ];
  for (const language of ['en', 'sk'] as const) {
    const battle = locale(language, 'battle');
    const log = locale(language, 'log');
    const scenarios = locale(language, 'scenarios');
    for (const eventKey of battlePaths) {
      expect(battle.scriptedEvents[eventKey].title.length).toBeGreaterThan(8);
      expect(battle.scriptedEvents[eventKey].detail.length).toBeGreaterThan(30);
    }
    expect(log.scriptedEvent.length).toBeGreaterThan(8);
    expect(scenarios['city-sector-lantern-vault'].objectives['sector-lantern-vault-chart-cache'].length)
      .toBeGreaterThan(20);
    expect(scenarios['city-sector-thorn-engine'].objectives['sector-thorn-engine-stabilize-regulator'].length)
      .toBeGreaterThan(20);
  }
});

test('an archive event updates the objective panel, battlefield, and combat log together', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-lantern-vault');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleCamera?.centerOnCoord));
  await page.evaluate(() => (window as any).__battleControl.revealAll());

  const authoredEvent = await page.evaluate(() => {
    const event = (window as any).__battleControl.scriptedEvents()
      .find((candidate: any) => candidate.id === 'sector-lantern-vault-reserve-wave');
    return {
      target: event.effects.find((effect: any) => effect.kind === 'revealObjective').objective.target,
      triggerRound: event.triggerRound
    };
  });
  expect(authoredEvent.triggerRound).toBe(5);
  await page.evaluate((target) => (
    (window as any).__battleCamera.centerOnCoord(target.q, target.r)
  ), authoredEvent.target);
  await page.waitForTimeout(120);
  await page.screenshot({
    path: test.info().outputPath('tactical-event-effects-before.png')
  });

  const before = await page.evaluate(() => (window as any).__battleControl.objectives());
  expect(before.some((objective: any) => objective.id === 'sector-lantern-vault-chart-cache')).toBe(false);

  const triggered = await page.evaluate((round) => (
    (window as any).__battleControl.runScriptedEventsAtRound(round)
  ), authoredEvent.triggerRound);
  expect(triggered).toEqual([expect.objectContaining({
    id: 'sector-lantern-vault-reserve-wave',
    effects: [expect.objectContaining({ kind: 'revealObjective' })]
  })]);
  await expect(page.locator('.battle-phase-notice')).toContainText(/Archive Signal Restored/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl.activeScenarioEventEffects()
      .filter((effect: any) => effect.kind === 'revealObjective').length
  ))).toBeGreaterThan(0);

  const revealed = await page.evaluate(() => (
    (window as any).__battleControl.objectives()
      .find((objective: any) => objective.id === 'sector-lantern-vault-chart-cache')
  ));
  expect(revealed).toMatchObject({ kind: 'reach', optional: true });
  expect(revealed.target).toEqual(authoredEvent.target);
  await page.screenshot({
    path: test.info().outputPath('tactical-event-effects-desktop.png')
  });

  const objectiveHud = page.locator('.objective-hud');
  await expect(objectiveHud).toContainText(/recover the prism charts/i);
  await expect(page.locator('.log-entries')).toContainText(/Battlefield event: Archive Signal Restored/i);

  const desktopHud = await objectiveHud.boundingBox();
  expect(desktopHud).not.toBeNull();
  expect(desktopHud!.x).toBeGreaterThanOrEqual(0);
  expect(desktopHud!.x + desktopHud!.width).toBeLessThanOrEqual(1440);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => Boolean((window as any).__battleCamera?.centerOnCoord));
  await page.evaluate((target) => (
    (window as any).__battleCamera.centerOnCoord(target.q, target.r)
  ), revealed.target);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: test.info().outputPath('tactical-event-effects-mobile.png')
  });

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobileHud = await objectiveHud.boundingBox();
  expect(mobileHud).not.toBeNull();
  expect(mobileHud!.x).toBeGreaterThanOrEqual(0);
  expect(mobileHud!.x + mobileHud!.width).toBeLessThanOrEqual(390);
});

test('terrain fractures and pressure pulses use distinct battlefield feedback', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases = [
    {
      territoryId: 'sector-sable-causeway',
      round: 4,
      kind: 'transformTerrain',
      log: 'Causeway Ward Fractures',
      screenshot: 'tactical-event-effects-terrain.png'
    },
    {
      territoryId: 'sector-mnemonic-orchard',
      kind: 'pressurePulse',
      log: 'The Orchard Remembers',
      screenshot: 'tactical-event-effects-pressure.png'
    }
  ] as const;

  for (const scenario of cases) {
    await startBattle(page, scenario.territoryId);
    await page.getByRole('button', { name: /^Start Battle$/i }).click();
    await page.waitForFunction(() => Boolean((window as any).__battleCamera?.centerOnCoord));
    await page.evaluate(() => (window as any).__battleControl.revealAll());

    const pressureBefore = scenario.kind === 'pressurePulse'
      ? await page.evaluate(() => {
          const control = (window as any).__battleControl;
          const event = control.scriptedEvents().find((candidate: any) => (
            candidate.effects?.some((effect: any) => effect.kind === 'pressurePulse')
          ));
          const pulse = event.effects.find((effect: any) => effect.kind === 'pressurePulse');
          const unit = control.allyUnits().find((candidate: any) => (
            candidate.stance !== 'destroyed' && !candidate.embarkedOn
          ));
          control.snapUnit(unit.id, pulse.coordinates[0].q, pulse.coordinates[0].r);
          control.selectUnit(unit.id);
          return {
            coordinate: pulse.coordinates[0],
            triggerRound: event.triggerRound,
            unit: control.allyUnits().find((candidate: any) => candidate.id === unit.id)
          };
        })
      : null;
    const terrainBefore = scenario.kind === 'transformTerrain'
      ? await page.evaluate(() => {
          const control = (window as any).__battleControl;
          const event = control.scriptedEvents().find((candidate: any) => (
            candidate.effects?.some((effect: any) => effect.kind === 'transformTerrain')
          ));
          const transform = event.effects.find((effect: any) => effect.kind === 'transformTerrain');
          const coordinate = transform.tiles[0].coordinate;
          return { coordinate, tile: control.tileAt(coordinate.q, coordinate.r) };
        })
      : null;
    const focusCoordinate = terrainBefore?.coordinate ?? pressureBefore?.coordinate;
    if (!focusCoordinate) throw new Error(`missing event focus for ${scenario.territoryId}`);
    await page.evaluate((target) => (
      (window as any).__battleCamera.centerOnCoord(target.q, target.r)
    ), focusCoordinate);
    await page.waitForTimeout(180);

    let effect;
    if (scenario.kind === 'transformTerrain') {
      const prepared = await page.evaluate(() => {
        const control = (window as any).__battleControl;
        const objective = control.objectives().find((candidate: any) => candidate.actionKey === 'plantCharges');
        const specialistId = objective?.eligibleUnitIds?.[0];
        if (!objective?.target || !specialistId) return false;
        control.snapUnit(specialistId, objective.target.q, objective.target.r);
        control.setActionPoints(specialistId, 20);
        control.selectUnit(specialistId);
        return true;
      });
      expect(prepared).toBe(true);
      const action = page.getByRole('button', { name: /^Plant charges$/i });
      await expect(action).toBeEnabled();
      await action.click();
      await expect.poll(async () => page.evaluate(() => (
        (window as any).__battleControl.activeScenarioEventEffects()
          .some((candidate: any) => candidate.kind === 'transformTerrain')
      ))).toBe(true);
      effect = await page.evaluate(() => {
        const active = (window as any).__battleControl.activeScenarioEventEffects()
          .find((candidate: any) => candidate.kind === 'transformTerrain');
        return active ? { ...active, coordinates: [active.coordinate] } : undefined;
      });
    } else {
      if (!pressureBefore?.triggerRound) {
        throw new Error(`missing event round for ${scenario.territoryId}`);
      }
      const triggered = await page.evaluate((round) => (
        (window as any).__battleControl.runScriptedEventsAtRound(round)
      ), pressureBefore.triggerRound);
      effect = triggered[0]?.effects.find((candidate: any) => candidate.kind === scenario.kind);
      await expect.poll(async () => page.evaluate((kind) => (
        (window as any).__battleControl.activeScenarioEventEffects()
          .filter((candidate: any) => candidate.kind === kind).length
      ), scenario.kind)).toBeGreaterThan(0);
    }
    expect(effect?.coordinates.length).toBeGreaterThan(0);
    if (terrainBefore) {
      const terrainAfter = await page.evaluate((coordinate) => (
        (window as any).__battleControl.tileAt(coordinate.q, coordinate.r)
      ), terrainBefore.coordinate);
      expect(terrainBefore.tile.terrain).not.toBe('road');
      expect(terrainAfter).toMatchObject({
        terrain: 'road',
        passable: true,
        blocksVision: false
      });
    }
    if (pressureBefore) {
      const pressureAfter = await page.evaluate((unitId) => (
        (window as any).__battleControl.allyUnits()
          .find((candidate: any) => candidate.id === unitId)
      ), pressureBefore.unit.id);
      expect(pressureAfter.health).toBe(Math.max(1, pressureBefore.unit.health - 12));
      expect(pressureAfter.morale).toBe(Math.max(0, pressureBefore.unit.morale - 18));
    }
    await page.screenshot({ path: test.info().outputPath(scenario.screenshot) });
    await expect(page.locator('.log-entries')).toContainText(scenario.log);
  }
});
