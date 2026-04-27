import { expect, test } from '@playwright/test';
import { startFreshCampaign } from './helpers';

test('army recruit queue shows incoming units with readiness turn', async ({ page }) => {
  await startFreshCampaign(page);

  await page.getByRole('button', { name: /ARMY/i }).click();
  await page.getByRole('button', { name: /Captain John Alexander/i }).click();

  await expect(page.getByText('IN TRANSIT')).toBeVisible();
  await expect(page.locator('.reserve-row').filter({ hasText: /Captain John Alexander/i })).toContainText(/READY T\d+/);
  await expect(page.getByText(/Captain John Alexander enters reserve queue/i)).toBeVisible();
});
