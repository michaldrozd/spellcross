import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('tactical pathing, obstacles, range, and fog visibility', async ({ page }) => {
  test.setTimeout(60_000);

  // Scenario 1: evac lane basic movement and blocked tiles
  await startBattle(page, 'sector-paris');
  const log = page.locator('.log-entries');

  // Move to a reachable tile
  const moved = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const neighborOffsets = [
      { dq: 1, dr: 0 },
      { dq: -1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: 0, dr: -1 },
      { dq: 1, dr: -1 },
      { dq: -1, dr: 1 }
    ];
    for (const unit of allies.filter((u: any) => u.type === 'infantry')) {
      for (const offset of neighborOffsets) {
        if (ctrl?.moveUnitTo?.(unit.id, unit.coord.q + offset.dq, unit.coord.r + offset.dr)) return true;
      }
    }
    return false;
  });
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('Move:');

  // Attempt to move into impassable water (should fail)
  const blocked = await page.evaluate(() => (window as any).__battleControl?.moveTo(4, 3));
  expect(blocked).toBeFalsy();

  // Attack nearest enemy within range. Battlefields are far larger than a single turn's movement, so
  // the nearest enemy usually isn't reachable yet — snap one into weapon range for a deterministic check.
  await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const ally = ctrl?.allyUnits?.()[0];
    const enemy = ctrl?.enemyUnits?.()[0];
    if (ally && enemy) ctrl.snapUnit(enemy.id, ally.coord.q, Math.max(0, ally.coord.r - 1));
  });
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toMatch(/Hit:|Miss:/);

  // Scenario 2: fog/night visibility check
  const started = await page.evaluate(() => (window as any).__campaignControl.startBattle('sector-munich'));
  expect(started).toBeTruthy();
  await expect(page.locator('.battle-screen')).toBeVisible();
  const initialVisible = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.());
  expect(initialVisible).toBeLessThan(3);

  const movedCloser = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const neighborOffsets = [
      { dq: 1, dr: 0 },
      { dq: -1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: 0, dr: -1 },
      { dq: 1, dr: -1 },
      { dq: -1, dr: 1 }
    ];
    for (const unit of allies) {
      for (const offset of neighborOffsets) {
        if (ctrl?.moveUnitTo?.(unit.id, unit.coord.q + offset.dq, unit.coord.r + offset.dr)) {
          return true;
        }
      }
    }
    return false;
  });
  expect(movedCloser).toBeTruthy();
  const afterVisible = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.());
  expect(afterVisible).toBeGreaterThanOrEqual(initialVisible);
});
