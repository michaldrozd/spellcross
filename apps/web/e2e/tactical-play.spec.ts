import { expect, test } from '@playwright/test';

test('tactical play via control hooks: move, attack, end turn, retreat', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/');

  // Enter first battle
  await page.getByRole('button', { name: /^Attack$/i }).first().click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  const log = page.locator('.log');

  // Use exposed battle control hooks to move and attack
  const moved = await page.evaluate(() => (window as any).__battleControl?.moveFirst());
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('unit:moved');

  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('unit:attacked');

  // End turn (AI runs) then retreat
  await page.evaluate(() => (window as any).__battleControl?.endTurn());
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
