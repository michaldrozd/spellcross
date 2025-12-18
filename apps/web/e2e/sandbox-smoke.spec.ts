import { test, expect } from '@playwright/test';

test('campaign roster renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Army/i)).toBeVisible();
  await expect(page.locator('.roster li')).not.toHaveCount(0);
});
