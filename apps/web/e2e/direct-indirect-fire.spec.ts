import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test.setTimeout(45_000);

test('spotters enable indirect fire while terrain still blocks direct fire', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const allies = control.allyUnits();
    const shooter = allies.find((unit: any) => unit.definitionId === 'm113');
    const spotter = allies.find((unit: any) => unit.id !== shooter?.id && !unit.embarkedOn);
    const target = control.enemyUnits().find((unit: any) => unit.stance !== 'destroyed');
    if (!shooter || !spotter || !target) return null;

    control.snapUnit(shooter.id, 0, 1);
    control.snapUnit(spotter.id, 2, 0);
    control.snapUnit(target.id, 2, 1);
    control.placeVisionBlocker(1, 1);
    control.setWeaponFireMode(shooter.id, 'autocannon', 'direct');
    control.forceAllianceTurn();
    control.revealAll();
    control.selectUnit(shooter.id);
    control.targetEnemy(target.id);
    return { shooterId: shooter.id, targetId: target.id };
  });
  expect(setup).not.toBeNull();

  await page.getByRole('button', { name: /^Show Ranges$/i }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.blockedRangeOverlayTiles()
  ))).toContain('2,1');
  await expect(page.locator('.unit-card.target-card')).toContainText('Line of fire blocked');
  await expect(page.getByText('Clear', { exact: true })).toBeVisible();
  await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => {
    const visiblePanels = Array.from(document.querySelector('.battle-bottom-bar')!.children)
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => element.getBoundingClientRect());
    return document.documentElement.scrollWidth <= window.innerWidth &&
      visiblePanels.every((panel) => panel.left >= 0 && panel.right <= window.innerWidth);
  })).toBe(true);

  const directResult = await page.evaluate(({ shooterId, targetId }) => (
    (window as any).__battleControl.attackUnitWith(shooterId, targetId, 'autocannon')
  ), setup!);
  expect(directResult).toMatchObject({ success: false, errorKey: 'directFireBlocked' });

  await page.evaluate(() => (window as any).__battleControl.clearSelection());
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.selectionState().selectedUnitId
  ))).toBeNull();
  await page.evaluate(({ shooterId, targetId }) => {
    const control = (window as any).__battleControl;
    control.setWeaponFireMode(shooterId, 'autocannon', 'indirect');
    control.selectUnit(shooterId);
    control.targetEnemy(targetId);
  }, setup!);

  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.blockedRangeOverlayTiles()
  ))).not.toContain('2,1');
  await expect(page.locator('.unit-card.target-card')).toContainText(/\d+%/);
  await expect(page.locator('.unit-card.target-card')).toContainText('autocannon');

  const indirectResult = await page.evaluate(({ shooterId, targetId }) => (
    (window as any).__battleControl.attackUnitWith(shooterId, targetId, 'autocannon')
  ), setup!);
  expect(indirectResult).toMatchObject({ success: true, weaponId: 'autocannon' });
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.activeAttackEffects().at(-1)?.arc
  ))).toBe(true);
});

test('demolishing a blocker immediately opens direct fire and the range overlay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const allies = control.allyUnits();
    const shooter = allies.find((unit: any) => unit.definitionId === 'm113');
    const spotter = allies.find((unit: any) => unit.id !== shooter?.id && !unit.embarkedOn);
    const target = control.enemyUnits().find((unit: any) => unit.stance !== 'destroyed');
    if (!shooter || !spotter || !target) return null;

    control.snapUnit(shooter.id, 0, 1);
    control.snapUnit(spotter.id, 2, 0);
    control.snapUnit(target.id, 2, 1);
    control.placeDestructibleVisionBlocker(1, 1, 1);
    control.setWeaponFireMode(shooter.id, 'autocannon', 'direct');
    control.forceAllianceTurn();
    control.revealAll();
    control.selectUnit(shooter.id);
    control.targetEnemy(target.id);
    return { shooterId: shooter.id, targetId: target.id };
  });
  expect(setup).not.toBeNull();

  await page.getByRole('button', { name: /^Show Ranges$/i }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.blockedRangeOverlayTiles()
  ))).toContain('2,1');
  await expect(page.locator('.unit-card.target-card')).toContainText('Line of fire blocked');

  const demolition = await page.evaluate(({ shooterId }) => (
    (window as any).__battleControl.attackTileWith(shooterId, 1, 1, 'autocannon')
  ), setup!);
  expect(demolition).toMatchObject({ success: true });
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.blockedRangeOverlayTiles()
  ))).not.toContain('2,1');
  await expect(page.locator('.unit-card.target-card')).not.toContainText('Line of fire blocked');

  const directResult = await page.evaluate(({ shooterId, targetId }) => (
    (window as any).__battleControl.attackUnitWith(shooterId, targetId, 'autocannon')
  ), setup!);
  expect(directResult).toMatchObject({ success: true, weaponId: 'autocannon' });
});
