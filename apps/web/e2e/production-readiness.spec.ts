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
    control.forceAllianceTurn();
    control.selectUnit(unitId);
    return control.allyUnits().find((unit: any) => unit.id === unitId);
  }, radar.id);
  expect(radarState.supply).toBe(false);
  expect(radarState.weapons).toEqual([]);
  expect(radarState.sensorDeployed).toBe(false);
  expect(radarState.sensorVision).toBe(5);
  await expect(page.getByRole('button', { name: /^Supply$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Overwatch$/i })).toBeDisabled();

  const mobileVisionTiles = await page.evaluate(() => (window as any).__battleControl.visibleTileCount());
  const deployRadar = page.getByRole('button', { name: /^Deploy radar$/i });
  await expect(deployRadar).toHaveAttribute('aria-pressed', 'false');
  await deployRadar.click();

  const deployedState = await page.evaluate(({ unitId, q, r }) => {
    const control = (window as any).__battleControl;
    return {
      unit: control.allyUnits().find((candidate: any) => candidate.id === unitId),
      visibleTiles: control.visibleTileCount(),
      path: control.pathForUnit(unitId, q + 1, r),
      move: control.moveUnitPath(unitId, [{ q: q + 1, r }])
    };
  }, { unitId: radar.id, q: radarState.coord.q, r: radarState.coord.r });
  expect(deployedState.unit).toMatchObject({ sensorDeployed: true, sensorVision: 12, ap: 0 });
  expect(deployedState.visibleTiles).toBeGreaterThan(mobileVisionTiles);
  expect(deployedState.path).toMatchObject({ success: false, reason: 'sensor_deployed' });
  expect(deployedState.move).toMatchObject({ success: false, errorKey: 'deployedSensorCannotMove' });
  await expect(page.getByText('Radar deployed', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pack radar$/i })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  const restoredRadarId = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const restored = control.allyUnits().find((unit: any) => unit.definitionId === 'horizon-radar');
    control.selectUnit(restored.id);
    return restored.id;
  });
  await expect(page.getByRole('button', { name: /^Pack radar$/i })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).__battleControl.forceAllianceTurn());
  await page.getByRole('button', { name: /^Pack radar$/i }).click();
  const packedState = await page.evaluate((unitId) => (
    (window as any).__battleControl.allyUnits().find((unit: any) => unit.id === unitId)
  ), restoredRadarId);
  expect(packedState).toMatchObject({ sensorDeployed: false, sensorVision: 5, ap: 0 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.getByRole('button', { name: /Pokračovať/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const restored = control.allyUnits().find((unit: any) => unit.definitionId === 'horizon-radar');
    control.selectUnit(restored.id);
    control.forceAllianceTurn();
  });
  const slovakDeploy = page.getByRole('button', { name: /^Rozvinúť radar$/i });
  await expect(slovakDeploy).toBeVisible();
  await slovakDeploy.click();
  await expect(page.getByText('Dosah senzora 12', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Zbaliť radar$/i })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
