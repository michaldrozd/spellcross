import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('M113 and Gepard keep their dedicated directional art through movement', async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await startBattle(page, 'sector-paris');
  const loaded = await page.evaluate(() => (
    (window as any).__battleControl.loadDefinitions(['m113', 'gepard-aa', 'veil-magus'])
  ));
  const m113 = loaded.loaded.find((unit: any) => unit.definitionId === 'm113');
  const gepard = loaded.loaded.find((unit: any) => unit.definitionId === 'gepard-aa');
  const enemy = loaded.loaded.find((unit: any) => unit.definitionId === 'veil-magus');
  expect(m113).toBeTruthy();
  expect(gepard).toBeTruthy();

  const setup = await page.evaluate(({ m113Id, gepardId, enemyId }) => {
    const control = (window as any).__battleControl;
    control.snapUnit(m113Id, 7, 7);
    control.snapUnit(gepardId, 12, 7);
    control.snapUnit(enemyId, 20, 16);
    control.setActionPoints(m113Id, 99);
    control.setActionPoints(gepardId, 99);
    control.forceAllianceTurn();

    const routeFor = (unitId: string, origin: { q: number; r: number }) => {
      const candidates = [
        { q: origin.q + 3, r: origin.r + 2 },
        { q: origin.q + 3, r: origin.r - 2 },
        { q: origin.q - 3, r: origin.r + 2 },
        { q: origin.q - 3, r: origin.r - 2 }
      ];
      return candidates
        .map((target) => ({ target, planned: control.pathForUnit(unitId, target.q, target.r) }))
        .find(({ planned }) => planned?.success && planned.path.length >= 3) ?? null;
    };

    return {
      presentations: {
        m113: control.movementPresentationForDefinition('m113'),
        gepard: control.movementPresentationForDefinition('gepard-aa')
      },
      m113Route: routeFor(m113Id, { q: 7, r: 7 }),
      gepardRoute: routeFor(gepardId, { q: 12, r: 7 })
    };
  }, { m113Id: m113.id, gepardId: gepard.id, enemyId: enemy.id });

  expect(setup.presentations).toEqual({
    m113: { audioProfile: 'track', directionalSprite: 'm113_apc' },
    gepard: { audioProfile: 'track', directionalSprite: 'gepard_directional' }
  });
  expect(setup.m113Route).toBeTruthy();
  expect(setup.gepardRoute).toBeTruthy();

  for (const movement of [
    { unitId: m113.id, route: setup.m113Route! },
    { unitId: gepard.id, route: setup.gepardRoute! }
  ]) {
    const started = await page.evaluate(({ unitId, target }) => {
      const control = (window as any).__battleControl;
      control.selectUnit(unitId);
      return control.animateUnitTo(unitId, target.q, target.r);
    }, { unitId: movement.unitId, target: movement.route.target });
    expect(started).toBe(true);
    await expect.poll(
      () => page.evaluate(() => (window as any).__battleControl.animationState()),
      { timeout: 15_000 }
    ).toBeNull();
    const finalCoordinate = await page.evaluate((unitId) => (
      (window as any).__battleControl.allyUnits().find((unit: any) => unit.id === unitId)?.coord
    ), movement.unitId);
    expect(finalCoordinate).toEqual(movement.route.target);
  }

  await expect.poll(() => page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    return {
      m113: resources.some((name) => name.includes('/assets/generated/m113_apc_walk_sheet.png')),
      gepard: resources.some((name) => name.includes('/assets/generated/gepard_directional_walk_sheet.png'))
    };
  })).toEqual({ m113: true, gepard: true });
  expect(runtimeErrors).toEqual([]);
});
