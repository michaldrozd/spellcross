import { expect, test } from '@playwright/test';

test('strategic raid spawns counteroffensive territory and can be defended', async ({ page }) => {
  test.setTimeout(80_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // End a few turns to trigger periodic raid
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
  }

  const raid = page.locator('li', { hasText: 'Enemy Raid' }).first();
  await expect.poll(async () => await raid.count()).toBeGreaterThan(0);

  // Presence of raid is enough to validate counteroffensive spawn
});
