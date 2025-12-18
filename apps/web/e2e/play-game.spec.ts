import { test, expect } from '@playwright/test';

test('can launch a battle and render the map', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Attack/i }).first().click();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByText(/Objectives/i)).toBeVisible();
});
