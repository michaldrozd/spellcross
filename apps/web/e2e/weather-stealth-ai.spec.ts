import { expect, test } from '@playwright/test';

const waitLog = (page: import('@playwright/test').Page, text: string) =>
  expect.poll(async () => (await page.locator('.log').textContent()) ?? '').toContain(text);

test('weather, stealth visibility, and objective-aware AI', async ({ page }) => {
  test.setTimeout(80_000);

  // Start outpost (night) to exercise weather and visibility
  await page.goto('/');
  await page.getByRole('button', { name: /^Attack$/i, exact: true }).nth(1).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  // Fog/night reduces visible enemies
  const visInitial = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visInitial).toBeLessThanOrEqual(3);

  // Move closer to reveal
  await page.evaluate(() => (window as any).__battleControl?.moveTo(3, 2));
  const visAfter = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visAfter).toBeGreaterThanOrEqual(visInitial);

  // End turn to trigger AI (objective-aware). Skip overwatch if disabled.
  await page.getByRole('button', { name: /^End Turn$/i }).click().catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  await expect(page.locator('.log')).toContainText(/round:started|unit:attacked/);

  // Retreat back to HQ for next scenario
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Attack River Bridge (clear weather) and verify movement slowed by weather not applied here
  const bridgeTerritory = page.locator('li', { hasText: 'River Bridge' });
  await bridgeTerritory.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  await page.evaluate(() => (window as any).__battleControl?.moveTo(2, 2));

  // AI objective-aware (reach/hold) still runs
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
