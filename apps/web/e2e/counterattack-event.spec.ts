import { expect, test } from '@playwright/test';

test('counterattack territory unlocks after timers expire', async ({ page }) => {
  test.setTimeout(70_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  // Burn turns to let an early-timer territory fail
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
  }

  // Counterattack territory should appear and be attackable
  const counter = page.locator('li', { hasText: 'Enemy Counterattack' }).filter({ has: page.getByRole('button', { name: /^Attack$/i }) }).first();
  await expect(counter).toBeVisible();
  await counter.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Counterattack/i)).toBeVisible();

  // Retreat back
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
