import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('supply truck uses directional motion and a full-length wheeled sound cue', async ({ page }) => {
  test.setTimeout(45_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await startBattle(page, 'sector-paris');
  const idleSheet = page.waitForResponse((response) => (
    response.url().includes('/assets/generated/supply_truck_directional_idle_sheet.png') && response.ok()
  ));
  const loaded = await page.evaluate(() => (
    (window as any).__battleControl.loadDefinitions(['supply-truck', 'veil-magus'])
  ));
  const truck = loaded.loaded.find((unit: any) => unit.definitionId === 'supply-truck');
  const enemy = loaded.loaded.find((unit: any) => unit.definitionId === 'veil-magus');
  expect(truck).toBeTruthy();
  await idleSheet;

  const setup = await page.evaluate(({ truckId, enemyId }) => {
    const control = (window as any).__battleControl;
    control.snapUnit(truckId, 8, 8);
    control.snapUnit(enemyId, 18, 18);
    control.forceAllianceTurn();
    control.setActionPoints(truckId, 99);
    control.selectUnit(truckId);

    const orientation = (from: any, to: any) => {
      const dq = Math.sign(to.q - from.q);
      const dr = Math.sign(to.r - from.r);
      if (dq > 0 && dr === 0) return 0;
      if (dq > 0 && dr < 0) return 1;
      if (dq === 0 && dr < 0) return 2;
      if (dq < 0 && dr === 0) return 3;
      if (dq < 0 && dr > 0) return 4;
      if (dq === 0 && dr > 0) return 5;
      if (dq > 0 && dr > 0) return 6;
      return 7;
    };
    const routes: Array<{ target: { q: number; r: number }; path: any[]; turns: number }> = [];
    for (let r = 1; r < 19; r += 1) {
      for (let q = 1; q < 19; q += 1) {
        const planned = control.pathForUnit(truckId, q, r);
        if (!planned.success || planned.path.length < 7 || planned.path.length > 8) continue;
        const fullPath = [{ q: 8, r: 8 }, ...planned.path];
        let turns = 0;
        for (let index = 0; index + 2 < fullPath.length; index += 1) {
          if (orientation(fullPath[index], fullPath[index + 1]) !== orientation(fullPath[index + 1], fullPath[index + 2])) turns += 1;
        }
        routes.push({ target: { q, r }, path: planned.path, turns });
      }
    }
    routes.sort((left, right) => right.turns - left.turns || right.path.length - left.path.length);
    return {
      presentation: control.movementPresentationForDefinition('supply-truck'),
      route: routes[0] ?? null
    };
  }, { truckId: truck.id, enemyId: enemy.id });

  expect(setup.presentation).toEqual({
    audioProfile: 'wheel',
    directionalSprite: 'supply_truck_directional'
  });
  expect(setup.route?.path.length).toBeGreaterThanOrEqual(7);
  expect(setup.route?.turns).toBeGreaterThan(0);

  await expect.poll(() => page.evaluate(() => (
    performance.getEntriesByType('resource').some((entry) => (
      entry.name.includes('/assets/generated/supply_truck_directional_walk_sheet.png')
    ))
  ))).toBe(true);
  const started = await page.evaluate(({ truckId, target }) => {
    const control = (window as any).__battleControl;
    const accepted = control.animateUnitTo(truckId, target.q, target.r);
    return {
      accepted,
      animation: control.animationState(),
      audio: control.movementAudioState()
    };
  }, { truckId: truck.id, target: setup.route!.target });

  expect(started.accepted).toBe(true);
  expect(started.animation.path).toHaveLength(setup.route!.path.length + 1);
  expect(started.animation.segmentTurnDuration).toBe(320);
  expect(started.audio.profile).toBe('wheel');
  expect(started.audio.requestedDurationMs).toBeGreaterThan(2_600);
  expect(started.audio.scheduledDurationSeconds).toBeCloseTo(started.audio.requestedDurationMs / 1000, 3);
  await expect.poll(
    () => page.evaluate(() => (window as any).__battleControl.animationState()),
    { timeout: 15_000 }
  ).toBeNull();

  const finalCoordinate = await page.evaluate((truckId) => (
    (window as any).__battleControl.allyUnits().find((unit: any) => unit.id === truckId)?.coord
  ), truck.id);
  expect(finalCoordinate).toEqual(setup.route!.target);
  expect(runtimeErrors).toEqual([]);
});
