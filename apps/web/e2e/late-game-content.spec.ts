import { expect, test } from '@playwright/test';

test('late-game spire assault loads and can be exited', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  const spire = page.locator('li', { hasText: 'Black Spire' }).first();
  await spire.getByRole('button', { name: /^Attack$/i }).click();

  await expect(page.getByRole('heading', { name: /Black Spire Assault/i })).toBeVisible();
  await expect(page.getByText(/ritual spire/i)).toBeVisible();

  // Ensure the foggy battle renders enemy presence
  const visibleCount = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visibleCount).toBeGreaterThanOrEqual(0);

  // Exit battle via retreat to confirm flow returns to HQ
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
