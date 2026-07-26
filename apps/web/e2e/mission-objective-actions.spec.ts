import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('plants bridge charges through the objective HUD and wins with enemies still present', async ({ page }) => {
  await startBattle(page, 'sector-strasbourg');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objective = control.objectives().find((candidate: any) => candidate.actionKey === 'plantCharges');
    const actor = control.allyUnits().find((unit: any) => unit.stance !== 'destroyed' && !unit.embarkedOn);
    if (!objective?.target || !actor) return null;
    control.forceAllianceTurn();
    control.snapUnit(actor.id, Math.max(0, objective.target.q - 1), objective.target.r);
    control.setActionPoints(actor.id, 5);
    control.selectUnit(actor.id);
    return { objectiveId: objective.id, actorId: actor.id };
  });
  expect(setup).not.toBeNull();

  const objectiveHud = page.locator('.objective-hud');
  await expect(objectiveHud).toBeVisible();
  const hudBox = await objectiveHud.boundingBox();
  expect(hudBox).not.toBeNull();
  expect(hudBox!.x).toBeGreaterThanOrEqual(0);
  expect(hudBox!.x + hudBox!.width).toBeLessThanOrEqual(1280);

  const action = page.getByRole('button', { name: /^Plant charges$/i });
  await expect(action).toBeEnabled();
  await action.click();

  const finalState = await page.evaluate((objectiveId) => {
    const control = (window as any).__battleControl;
    return {
      completed: control.objectives().find((objective: any) => objective.id === objectiveId)?.completed,
      allies: control.allyUnits(),
      enemies: control.enemyUnits()
    };
  }, setup!.objectiveId);
  expect(finalState.completed, JSON.stringify(finalState)).toBe(true);
  await expect.poll(async () => page.evaluate((actorId) => (
    (window as any).__battleControl.allyUnits().find((unit: any) => unit.id === actorId)?.ap
  ), setup!.actorId)).toBe(3);
  await expect(page.locator('.battle-outcome-overlay')).toContainText(/Sector Secured/i);
  await expect(page.locator('.log-entries')).toContainText(/Mission action:/i);
});

test('optional Rift ward action opens the reserve corridor without breaking the mobile HUD', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startBattle(page, 'sector-rift');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const actionReason = page.locator('.objective-action-reason').first();
  await expect(actionReason).toBeVisible();
  await expect(actionReason).toContainText(/Move onto or beside the objective/i);

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objective = control.objectives().find((candidate: any) => candidate.actionKey === 'disruptWard');
    const actor = control.allyUnits().find((unit: any) => unit.stance !== 'destroyed' && !unit.embarkedOn);
    if (!objective?.target || !actor) return null;
    const allianceBefore = control.allyUnits().length;
    control.forceAllianceTurn();
    control.snapUnit(actor.id, objective.target.q, objective.target.r);
    control.setActionPoints(actor.id, 4);
    control.selectUnit(actor.id);
    return { objectiveId: objective.id, allianceBefore };
  });
  expect(setup).not.toBeNull();

  const objectiveHud = page.locator('.objective-hud');
  await expect(objectiveHud).toBeVisible();
  const hudBox = await objectiveHud.boundingBox();
  expect(hudBox).not.toBeNull();
  expect(hudBox!.x).toBeGreaterThanOrEqual(0);
  expect(hudBox!.x + hudBox!.width).toBeLessThanOrEqual(390);

  const action = page.getByRole('button', { name: /^Disrupt ward$/i });
  await expect(action).toBeEnabled();
  await action.click();

  const autoState = await page.evaluate((objectiveId) => {
    const control = (window as any).__battleControl;
    return {
      completed: control.objectives().find((objective: any) => objective.id === objectiveId)?.completed,
      allies: control.allyUnits(),
      enemies: control.enemyUnits()
    };
  }, setup!.objectiveId);
  expect(autoState.completed, JSON.stringify(autoState)).toBe(true);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl.allyUnits().length)).toBe(setup!.allianceBefore + 1);
  await expect(page.locator('.log-entries')).toContainText(/Reinforcements/i);
  await expect(page.locator('.battle-outcome-overlay')).not.toBeVisible();
});

test('Ashen Confluence beacon calls in one Thunderhead battery without ending the operation', async ({ page }) => {
  await startBattle(page, 'sector-ashen-confluence');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objective = control.objectives().find((candidate: any) => candidate.actionKey === 'alignEchoBeacon');
    const actor = control.allyUnits().find((unit: any) => unit.stance !== 'destroyed' && !unit.embarkedOn);
    if (!objective?.target || !actor) return null;
    control.forceAllianceTurn();
    control.snapUnit(actor.id, objective.target.q, objective.target.r);
    control.setActionPoints(actor.id, 5);
    control.selectUnit(actor.id);
    return {
      objectiveId: objective.id,
      allianceBefore: control.allyUnits().length
    };
  });
  expect(setup).not.toBeNull();

  const action = page.getByRole('button', { name: /^Align echo beacon$/i });
  await expect(action).toBeEnabled();
  await action.click();

  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl.allyUnits()
      .filter((unit: any) => unit.definitionId === 'thunderhead-155').length
  ))).toBe(1);
  expect(await page.evaluate((objectiveId) => (
    (window as any).__battleControl.objectives()
      .find((objective: any) => objective.id === objectiveId)?.completed
  ), setup!.objectiveId)).toBe(true);
  expect(await page.evaluate(() => (window as any).__battleControl.allyUnits().length))
    .toBe(setup!.allianceBefore + 1);
  await expect(page.locator('.battle-phase-notice')).toContainText(/Echo Battery On Target/i);
  await expect(page.locator('.battle-outcome-overlay')).not.toBeVisible();
});

test('Auto Turn resolves a bridge action contested by an enemy without oscillating', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-strasbourg');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const loaded = control.loadDefinitions(['leopard-2', 'orc-warband']);
    const objective = control.objectives().find((candidate: any) => candidate.actionKey === 'plantCharges');
    const actor = control.allyUnits()[0];
    const enemy = control.enemyUnits()[0];
    if (!loaded.success || !objective?.target || !actor || !enemy) return null;
    control.snapUnit(actor.id, objective.target.q - 1, objective.target.r);
    control.snapUnit(enemy.id, objective.target.q, objective.target.r);
    control.forceAllianceTurn();
    return { objectiveId: objective.id, actorId: actor.id };
  });
  expect(setup).not.toBeNull();

  await page.getByRole('button', { name: /^Auto Turn$/i }).click();
  await expect(page.locator('.auto-turn-banner')).not.toBeVisible({ timeout: 10_000 });

  const finalAutoState = await page.evaluate((objectiveId) => {
    const control = (window as any).__battleControl;
    return {
      completed: control.objectives().find((objective: any) => objective.id === objectiveId)?.completed,
      allies: control.allyUnits(),
      enemies: control.enemyUnits()
    };
  }, setup!.objectiveId);
  expect(finalAutoState.completed, JSON.stringify(finalAutoState)).toBe(true);
  expect(finalAutoState.enemies.find((enemy: any) => enemy.definitionId === 'orc-warband')?.stance).toBe('ready');
  await expect(page.locator('.battle-outcome-overlay')).toContainText(/Sector Secured/i);
  await expect(page.getByText(/computer is playing your turn/i)).not.toBeVisible();
});

test('Auto Turn ignores an absent optional specialist and advances on the required timed objective', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const originalReach = control.objectives().find((objective: any) => objective.kind === 'reach');
    const loaded = control.loadDefinitions(['heavy-infantry', 'dread-fortress']);
    const ally = loaded.loaded?.find((unit: any) => unit.faction === 'alliance');
    const enemy = loaded.loaded?.find((unit: any) => unit.faction === 'otherSide');
    if (!loaded.success || !originalReach?.target || !ally || !enemy) {
      return { error: 'scenario setup failed', loaded, objectives: control.objectives() };
    }

    const axialDistance = (a: any, b: any) => (
      Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q - b.q) + (a.r - b.r))
    ) / 2;
    const towardGoal = {
      q: originalReach.target.q - ally.q,
      r: originalReach.target.r - ally.r
    };
    const battlefieldTiles = Array.from({ length: 20 }, (_, r) => (
      Array.from({ length: 30 }, (_unused, q) => ({ q, r }))
    )).flat();
    const enemyCandidates = battlefieldTiles
      .map((tile) => ({
        tile,
        path: control.pathForUnit(ally.id, tile.q, tile.r),
        projection: (tile.q - ally.q) * towardGoal.q + (tile.r - ally.r) * towardGoal.r
      }))
      .filter((candidate) => candidate.path.success && candidate.path.cost >= 4);
    const enemyTile = enemyCandidates
      .sort((a, b) => a.projection - b.projection || b.path.cost - a.path.cost)[0]?.tile;
    if (!enemyTile) return { error: 'no enemy tile', ally, target: originalReach.target };

    control.snapUnit(enemy.id, enemyTile.q, enemyTile.r);
    control.replaceObjectives([
      {
        id: 'required-evac',
        kind: 'reach',
        description: 'Reach the emergency extraction point.',
        target: originalReach.target,
        turnLimit: 2
      },
      {
        id: 'optional-specialist-console',
        kind: 'interact',
        description: 'Optional specialist console.',
        target: enemyTile,
        unitIds: ['never-deployed-specialist'],
        optional: true,
        actionKey: 'disruptWard',
        actionPoints: 2
      }
    ]);
    control.forceAllianceTurn();
    return {
      allyId: ally.id,
      target: originalReach.target,
      before: axialDistance(ally, originalReach.target),
      enemyTile
    };
  });
  expect(setup).not.toBeNull();
  expect(setup).not.toHaveProperty('error');
  if (!setup || 'error' in setup) throw new Error(JSON.stringify(setup));

  await page.getByRole('button', { name: /^Auto Turn$/i }).click();
  await expect(page.locator('.auto-turn-banner')).not.toBeVisible({ timeout: 20_000 });

  const after = await page.evaluate(({ allyId, target }) => {
    const unit = (window as any).__battleControl.allyPositions().find((candidate: any) => candidate.id === allyId);
    if (!unit) return null;
    return {
      q: unit.q,
      r: unit.r,
      distance: (
        Math.abs(unit.q - target.q)
        + Math.abs(unit.r - target.r)
        + Math.abs((unit.q - target.q) + (unit.r - target.r))
      ) / 2
    };
  }, setup!);
  expect(after).not.toBeNull();
  expect(after!.distance, JSON.stringify({ setup, after })).toBeLessThan(setup!.before);
  expect({ q: after!.q, r: after!.r }).not.toEqual(setup!.enemyTile);
});
