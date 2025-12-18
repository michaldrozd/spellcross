import { test, expect } from '@playwright/test';

test('retreat flows back to strategic view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Attack/i }).first().click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  await page.getByRole('button', { name: /Retreat/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
