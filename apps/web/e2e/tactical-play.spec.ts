import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('tactical play via control hooks: move, attack, end turn, retreat', async ({ page }) => {
  test.setTimeout(45_000);
  await startBattle(page);
  const log = page.locator('.log-entries');

  // Use exposed battle control hooks to move and attack
  const moved = await page.evaluate(() => (window as any).__battleControl?.moveFirst());
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('Move:');

  // Battlefields are much larger than a single turn's movement range, so the nearest enemy usually
  // isn't reachable yet — snap one into weapon range for a deterministic attack check.
  await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const ally = ctrl?.allyUnits?.()[0];
    const enemy = ctrl?.enemyUnits?.()[0];
    if (ally && enemy) ctrl.snapUnit(enemy.id, ally.coord.q, Math.max(0, ally.coord.r - 1));
  });
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toMatch(/Hit:|Miss:/);

  // End turn (AI runs) then retreat
  await page.evaluate(() => (window as any).__battleControl?.endTurn());
  await retreatToHq(page);
});
