import { test, expect } from '@playwright/test';
import { startFreshCampaign } from './helpers';

test('campaign roster renders', async ({ page }) => {
  await startFreshCampaign(page);
  await page.getByRole('button', { name: /Army/i }).click();
  await expect(page.getByText(/YOUR FORCES/i)).toBeVisible();
  await expect(page.locator('.unit-row')).not.toHaveCount(0);
});
