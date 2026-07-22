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
