import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('tactical play via control hooks: move, attack, end turn, retreat', async ({ page }) => {
  test.setTimeout(45_000);
  await startBattle(page);
  const log = page.locator('.log-entries');

  // Use exposed battle control hooks to move and attack
  const moved = await page.evaluate(() => (window as any).__battleControl?.moveFirst());
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('Move ');

  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toMatch(/hit|missed/);

  // End turn (AI runs) then retreat
  await page.evaluate(() => (window as any).__battleControl?.endTurn());
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
});
