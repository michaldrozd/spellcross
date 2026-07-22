import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('every canonical unit can be instantiated and rendered in a live battlefield', async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await startBattle(page, 'sector-paris');
  const definitions = await page.evaluate(() => (window as any).__battleControl.rosterDefinitions());
  expect(definitions).toHaveLength(80);
  expect(new Set(definitions.map((definition: any) => definition.id)).size).toBe(80);
  expect(definitions.filter((definition: any) => definition.supply).map((definition: any) => definition.id))
    .toEqual(['supply-truck']);

  for (let offset = 0; offset < definitions.length; offset += 10) {
    const definitionIds = definitions.slice(offset, offset + 10).map((definition: any) => definition.id);
    const loaded = await page.evaluate(
      (ids) => (window as any).__battleControl.loadDefinitions(ids),
      definitionIds
    );
    expect(loaded.success, `batch ${offset / 10 + 1} should load`).toBe(true);
    expect(loaded.missing).toEqual([]);
    expect(loaded.loaded.map((unit: any) => unit.definitionId)).toEqual(definitionIds);
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForTimeout(120);
    expect(runtimeErrors, `batch ${offset / 10 + 1} should render cleanly`).toEqual([]);
  }
});

test('Alliance artillery moves, exposes its range and produces live indirect-fire effects', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'sector-paris');

  for (const definitionId of [
    'firefly-105',
    'badger-mortar-carrier',
    'thunderhead-155',
    'tempest-counterbattery'
  ]) {
    const loaded = await page.evaluate(
      (ids) => (window as any).__battleControl.loadDefinitions(ids),
      [definitionId, 'veil-magus']
    );
    const attacker = loaded.loaded.find((unit: any) => unit.faction === 'alliance');
    const defender = loaded.loaded.find((unit: any) => unit.faction === 'otherSide');
    expect(attacker?.definitionId).toBe(definitionId);
    expect(defender?.definitionId).toBe('veil-magus');

    await page.evaluate((unitId) => (window as any).__battleControl.selectUnit(unitId), attacker.id);
    const ranges = page.getByRole('button', { name: /Ranges$/i });
    await expect(ranges).toHaveAttribute('aria-pressed', 'false');
    await ranges.click();
    await expect(ranges).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => (window as any).__battleControl.rangeOverlayTiles().length))
      .toBeGreaterThan(0);

    const destination = await page.evaluate((unitId) => {
      const control = (window as any).__battleControl;
      const unit = control.allyUnits().find((candidate: any) => candidate.id === unitId);
      const candidates = [
        { q: unit.coord.q + 1, r: unit.coord.r },
        { q: unit.coord.q, r: unit.coord.r + 1 },
        { q: unit.coord.q - 1, r: unit.coord.r },
        { q: unit.coord.q, r: unit.coord.r - 1 }
      ];
      return candidates.find((candidate) => control.pathForUnit(unitId, candidate.q, candidate.r).success) ?? null;
    }, attacker.id);
    expect(destination, `${definitionId} should have a legal movement step`).not.toBeNull();
    expect(await page.evaluate(
      ({ unitId, destination }) => (window as any).__battleControl.animateUnitTo(unitId, destination.q, destination.r),
      { unitId: attacker.id, destination }
    )).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__battleControl.animationState())).toBeNull();

    const positions = await page.evaluate(() => ({
      attacker: (window as any).__battleControl.allyUnits()[0].coord,
      defender: (window as any).__battleControl.enemyUnits()[0].coord
    }));
    const targetQ = Math.min(positions.attacker.q + 2, 15);
    const targetR = positions.attacker.r;
    await page.evaluate(
      ({ attackerId, defenderId, q, r }) => {
        const control = (window as any).__battleControl;
        control.snapUnit(defenderId, q, r);
        control.forceAllianceTurn();
        control.setActionPoints(attackerId, 99);
        control.setHealth(defenderId, 1);
        control.revealAll();
      },
      { attackerId: attacker.id, defenderId: defender.id, q: targetQ, r: targetR }
    );
    const attack = await page.evaluate(
      ({ attackerId, defenderId }) => (window as any).__battleControl.attackUnitWith(attackerId, defenderId),
      { attackerId: attacker.id, defenderId: defender.id }
    );
    expect(attack.success, `${definitionId} should fire an accepted attack: ${JSON.stringify(attack)}`).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__battleControl.activeAttackEffects().length))
      .toBeGreaterThan(0);
    const effect = await page.evaluate(() => (window as any).__battleControl.activeAttackEffects().at(-1));
    expect(effect.type).toBe('explosion');
    expect(effect.arc, `${definitionId} should read as indirect fire`).toBe(true);
    expect(effect.hit).toBe(true);
    expect(effect.killed).toBe(true);
  }

  const radarFormation = await page.evaluate(
    (ids) => (window as any).__battleControl.loadDefinitions(ids),
    ['horizon-radar', 'veil-magus']
  );
  const radar = radarFormation.loaded.find((unit: any) => unit.definitionId === 'horizon-radar');
  const radarState = await page.evaluate((unitId) => {
    const control = (window as any).__battleControl;
    control.selectUnit(unitId);
    return control.allyUnits().find((unit: any) => unit.id === unitId);
  }, radar.id);
  expect(radarState.supply).toBe(false);
  expect(radarState.weapons).toEqual([]);
  await expect(page.getByRole('button', { name: /^Supply$/i })).toHaveCount(0);
});
