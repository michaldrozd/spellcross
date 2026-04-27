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
    const candidates = [
      { q: 2, r: 2 },
      { q: 2, r: 3 },
      { q: 3, r: 2 },
      { q: 3, r: 3 },
      { q: 1, r: 2 },
      { q: 1, r: 4 }
    ];
    for (const unit of allies.filter((u: any) => u.type === 'infantry')) {
      for (const coord of candidates) {
        if (ctrl?.moveUnitTo?.(unit.id, coord.q, coord.r)) return true;
      }
    }
    return false;
  });
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('Move ');

  // Attempt to move into impassable water (should fail)
  const blocked = await page.evaluate(() => (window as any).__battleControl?.moveTo(4, 3));
  expect(blocked).toBeFalsy();

  // Attack nearest enemy within range
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toMatch(/hit|missed/);

  // Scenario 2: fog/night visibility check
  const started = await page.evaluate(() => (window as any).__campaignControl.startBattle('sector-munich'));
  expect(started).toBeTruthy();
  await expect(page.locator('.battle-screen')).toBeVisible();
  const initialVisible = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.());
  expect(initialVisible).toBeLessThan(3);

  const movedCloser = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const candidates = [
      { q: 2, r: 2 },
      { q: 2, r: 3 },
      { q: 3, r: 2 },
      { q: 3, r: 3 },
      { q: 1, r: 2 },
      { q: 1, r: 3 }
    ];
    for (const unit of allies) {
      for (const coord of candidates) {
        if (ctrl?.moveUnitTo?.(unit.id, coord.q, coord.r)) {
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
