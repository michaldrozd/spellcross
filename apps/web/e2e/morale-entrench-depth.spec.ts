import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test.setTimeout(45_000);

test('dig-in, suppression, routed retreat, and rally stay playable and contained', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const allies = control.allyUnits();
    const shooter = allies.find((unit: any) => unit.definitionId === 'm113')
      ?? allies.find((unit: any) => unit.type !== 'air' && unit.weapons.length > 0);
    const target = control.enemyUnits().find((unit: any) => unit.stance !== 'destroyed');
    if (!shooter || !target) return null;
    control.forceAllianceTurn();
    control.revealAll();
    control.snapUnit(shooter.id, 0, 0);
    for (const enemy of control.enemyUnits()) control.snapUnit(enemy.id, 3, 2);
    control.selectUnit(shooter.id);
    return { shooterId: shooter.id, targetId: target.id };
  });
  expect(setup).not.toBeNull();

  await expect(page.getByRole('button', { name: /^Dig in$/i })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^Rally$/i })).toBeDisabled();
  expect(await page.evaluate(() => {
    const panels = Array.from(document.querySelector('.battle-bottom-bar')!.children)
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => element.getBoundingClientRect());
    return document.documentElement.scrollWidth <= window.innerWidth
      && panels.every((panel) => panel.left >= 0 && panel.right <= window.innerWidth);
  })).toBe(true);

  await page.getByRole('button', { name: /^Dig in$/i }).click();
  await expect.poll(() => page.evaluate((unitId) => {
    const unit = (window as any).__battleControl.allyUnits().find((candidate: any) => candidate.id === unitId);
    return { entrench: unit?.entrench, ap: unit?.ap };
  }, setup!.shooterId)).toMatchObject({ entrench: 1, ap: 0 });
  await expect(page.locator('.battle-log-panel')).toContainText('Entrenched');

  const cornered = await page.evaluate(({ shooterId, targetId }) => {
    const control = (window as any).__battleControl;
    control.forceAllianceTurn();
    control.setUnitMorale(shooterId, 20);
    control.snapUnit(shooterId, 0, 0);
    control.snapUnit(targetId, 1, 0);
    return {
      move: control.moveUnitPath(shooterId, [{ q: 0, r: 1 }]),
      rally: control.rally(shooterId)
    };
  }, setup!);
  expect(cornered.move).toMatchObject({ success: false, errorKey: 'routedMustRetreat' });
  expect(cornered.rally).toMatchObject({ success: false, errorKey: 'enemyTooCloseToRally' });

  await page.evaluate(({ shooterId }) => {
    const control = (window as any).__battleControl;
    for (const enemy of control.enemyUnits()) control.snapUnit(enemy.id, 3, 2);
    control.clearSelection();
    control.selectUnit(shooterId);
  }, setup!);
  await expect(page.getByRole('button', { name: /^Rally$/i })).toBeEnabled();
  await page.getByRole('button', { name: /^Rally$/i }).click();
  await expect.poll(() => page.evaluate((unitId) => {
    const unit = (window as any).__battleControl.allyUnits().find((candidate: any) => candidate.id === unitId);
    return { morale: unit?.morale, stance: unit?.stance, ap: unit?.ap };
  }, setup!.shooterId)).toEqual({ morale: 28, stance: 'suppressed', ap: 0 });
  await expect(page.locator('.battle-log-panel')).toContainText('Rallied');

  await page.evaluate(({ shooterId, targetId }) => {
    const control = (window as any).__battleControl;
    control.forceAllianceTurn();
    control.setUnitMorale(shooterId, 100);
    control.setUnitMorale(targetId, 44);
    control.snapUnit(shooterId, 0, 0);
    control.snapUnit(targetId, 1, 0);
    control.selectUnit(shooterId);
    control.targetEnemy(targetId);
  }, setup!);
  await expect(page.getByRole('button', { name: /^Suppress$/i })).toBeEnabled();

  const suppressed = await page.evaluate(({ shooterId, targetId }) => (
    (window as any).__battleControl.suppressUnitWith(shooterId, targetId)
  ), setup!);
  expect(suppressed).toMatchObject({ success: true });
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.activeAttackEffects().at(-1)
  ))).toMatchObject({ suppressive: true });
  await expect.poll(() => page.evaluate((unitId) => (
    (window as any).__battleControl.enemyUnits().find((unit: any) => unit.id === unitId)?.stance
  ), setup!.targetId)).not.toBe('ready');
  await expect(page.locator('.battle-log-panel')).toContainText('Suppression');
});
