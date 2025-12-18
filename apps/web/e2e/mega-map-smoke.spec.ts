import { test, expect } from '@playwright/test';

test('end turn button exists in tactical view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Attack/i }).first().click();
  await expect(page.getByRole('button', { name: /End Turn/i })).toBeVisible();
});
