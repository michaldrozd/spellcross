import { expect, test } from '@playwright/test';

import { startBattle, startFreshCampaign } from './helpers';

test('operation planning discloses attached mission specialists without granting a free deployment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startFreshCampaign(page);
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.setTerritoryAvailable('sector-sable-causeway')
  ))).toBe(true);

  await page.locator('.map-theater-switch button').filter({ hasText: 'Shatterline' }).click();
  await page.locator('.territory-marker').filter({ hasText: 'Sable Causeway' }).click();
  await page.getByRole('button', { name: /Launch Attack/i }).click();

  const planner = page.locator('.deployment-planner');
  await expect(planner).toBeVisible();
  await expect(planner).toContainText('Commandos');
  await expect(planner).toContainText('MISSION SPECIALIST');
  await expect(planner).toContainText('Attached outside the roster limit');
  await expect(planner).toContainText(/plant the charges by round ten/i);
  await page.screenshot({ path: '/tmp/spellcross-specialist-planner-desktop.png' });

  await planner.getByRole('button', { name: /Clear Optional/i }).click();
  await expect(planner.getByRole('button', { name: /Confirm Deployment/i })).toBeDisabled();
  await planner.getByRole('button', { name: /Select to Capacity/i }).click();
  await expect(planner.getByRole('button', { name: /Confirm Deployment/i })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/spellcross-specialist-planner-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Auto Turn moves the assigned specialist and refuses an in-range regular squad', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-sable-causeway');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objective = control.objectives().find((candidate: any) => candidate.essential);
    const specialistId = objective?.eligibleUnitIds?.[0];
    const specialist = control.allyUnits().find((candidate: any) => candidate.id === specialistId);
    const regular = control.allyUnits().find((candidate: any) => candidate.id !== specialistId);
    if (!objective?.target || !objective.actionPoints || !specialist || !regular) return null;

    const distance = (left: any, right: any) => (
      Math.max(Math.abs(left.q - right.q), Math.abs(left.r - right.r))
    );
    const occupied = new Set([
      ...control.allyUnits(),
      ...control.enemyUnits()
    ].filter((unit: any) => unit.id !== specialist.id && unit.id !== regular.id)
      .map((unit: any) => `${unit.coord.q},${unit.coord.r}`));
    const aroundTarget = [];
    for (let dq = -1; dq <= 1; dq += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (dq !== 0 || dr !== 0) {
          aroundTarget.push({ q: objective.target.q + dq, r: objective.target.r + dr });
        }
      }
    }
    const regularTile = aroundTarget.find((coordinate) => {
      const tile = control.tileAt(coordinate.q, coordinate.r);
      return tile?.passable && !occupied.has(`${coordinate.q},${coordinate.r}`);
    });
    if (!regularTile) return null;
    control.snapUnit(regular.id, regularTile.q, regularTile.r);
    occupied.add(`${regularTile.q},${regularTile.r}`);

    let specialistTile;
    let specialistPath;
    for (let radius = 2; radius <= 6 && !specialistTile; radius += 1) {
      for (let q = objective.target.q - radius; q <= objective.target.q + radius && !specialistTile; q += 1) {
        for (let r = objective.target.r - radius; r <= objective.target.r + radius; r += 1) {
          const coordinate = { q, r };
          const tile = control.tileAt(q, r);
          if (
            distance(coordinate, objective.target) !== radius
            || !tile?.passable
            || occupied.has(`${q},${r}`)
          ) continue;
          control.snapUnit(specialist.id, q, r);
          const path = control.pathForUnit(specialist.id, objective.target.q, objective.target.r);
          if (
            path.success
            && path.path.length > 0
            && path.cost <= specialist.ap - objective.actionPoints
          ) {
            specialistTile = coordinate;
            specialistPath = path;
            break;
          }
        }
      }
    }
    if (!specialistTile || !specialistPath) return null;
    control.forceAllianceTurn();
    control.killAllEnemies();
    control.selectUnit(regular.id);
    return {
      objectiveId: objective.id,
      specialistId: specialist.id,
      regularId: regular.id,
      regularTile,
      specialistTile,
      specialistPath
    };
  });
  expect(setup).not.toBeNull();
  if (!setup) throw new Error('could not prepare the specialist Auto Turn scenario');

  const action = page.getByRole('button', { name: /^Plant charges$/i });
  await expect(action).toBeDisabled();
  await expect(page.locator('.objective-action-reason')).toContainText('requires a different unit');
  await page.evaluate((specialistId) => (
    (window as any).__battleControl.selectUnit(specialistId)
  ), setup.specialistId);
  await expect(action).toBeDisabled();
  await expect(page.locator('.objective-action-reason')).toContainText('Move onto or beside the objective');
  await page.screenshot({ path: '/tmp/spellcross-specialist-auto-before.png' });

  await page.evaluate(({ regularId, specialistId }) => {
    const control = (window as any).__battleControl;
    control.setActionPoints(regularId, 0);
    control.setActionPoints(specialistId, 20);
  }, setup);
  await page.getByRole('button', { name: /^Auto Turn$/i }).click();
  await expect.poll(async () => page.evaluate((objectiveId) => (
    (window as any).__battleControl.objectives()
      .find((candidate: any) => candidate.id === objectiveId)?.completed
  ), setup.objectiveId), { timeout: 20_000 }).toBe(true);
  await expect(page.locator('.auto-turn-banner')).not.toBeVisible({ timeout: 20_000 });

  const completed = await page.evaluate(({ objectiveId, specialistId, specialistTile, regularId }) => {
    const control = (window as any).__battleControl;
    const specialist = control.allyUnits().find((candidate: any) => candidate.id === specialistId);
    const regular = control.allyUnits().find((candidate: any) => candidate.id === regularId);
    return {
      objective: control.objectives().find((candidate: any) => candidate.id === objectiveId),
      actorId: control.objectiveCompletionActor(objectiveId),
      specialist,
      regular,
      specialistMoved: specialist?.coord.q !== specialistTile.q || specialist?.coord.r !== specialistTile.r
    };
  }, setup);
  expect(completed.objective.completed).toBe(true);
  expect(completed.actorId).toBe(setup.specialistId);
  expect(completed.specialistMoved).toBe(true);
  expect(completed.regular.coord).toEqual(setup.regularTile);
  await expect(page.locator('.battle-outcome-overlay')).toContainText(/Sector Secured/i);
  await page.screenshot({ path: '/tmp/spellcross-specialist-auto-complete.png' });
});

test('a missed deadline and a lost specialist each fail the operation immediately', async ({ page }) => {
  await startBattle(page, 'sector-mnemonic-orchard');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  const deadline = await page.evaluate(() => (
    (window as any).__battleControl.objectives().find((candidate: any) => candidate.essential)
  ));
  expect(deadline).toMatchObject({ deadlineRound: 9, completed: false });
  await expect(page.locator('.objective-hud')).toContainText('Critical');
  await expect(page.locator('.objective-hud')).toContainText('Action required by round 9');
  await page.evaluate((round) => (
    (window as any).__battleControl.setBattleRound(round + 1)
  ), deadline.deadlineRound);
  await expect(page.locator('.battle-outcome-overlay')).toContainText(/Mission Failed/i);
  await page.screenshot({ path: '/tmp/spellcross-specialist-deadline-failed.png' });

  await startBattle(page, 'sector-lantern-vault');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  const specialistId = await page.evaluate(() => (
    (window as any).__battleControl.objectives()
      .find((candidate: any) => candidate.essential)?.eligibleUnitIds?.[0]
  ));
  expect(specialistId).toBeTruthy();
  expect(await page.evaluate((unitId) => (
    (window as any).__battleControl.destroyUnit(unitId)
  ), specialistId)).toBe(true);
  await expect(page.locator('.battle-outcome-overlay')).toContainText(/Mission Failed/i);
});
