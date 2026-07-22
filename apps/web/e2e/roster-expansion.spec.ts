import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

test('the full Alliance roster and fire-support research are available from HQ', async ({ page }) => {
  await startFreshCampaign(page);

  await page.getByRole('button', { name: /Army/i }).click();
  expect(await page.locator('.recruit-btn').count()).toBeGreaterThanOrEqual(38);

  await page.getByRole('button', { name: /^Artillery$/i }).click();
  for (const unitName of [
    'Firefly 105 Battery',
    'Badger Mortar Carrier',
    'Thunderhead 155 SPG',
    'Tempest Counterbattery Gun'
  ]) {
    await expect(page.locator('.recruit-btn').filter({ hasText: unitName })).toBeVisible();
  }
  await expect(page.locator('.recruit-btn').filter({ hasText: 'Firefly 105 Battery' }))
    .toContainText('Mobile Fire Support');
  await expect(page.locator('img[src$="/assets/generated/thunderhead_155.png"]')).toBeVisible();

  await page.getByRole('button', { name: /Research/i }).click();
  for (const topicName of [
    'Mobile Fire Support',
    'Deep Fires Network',
    'Expeditionary Mobility',
    'Autonomous Recon Wing',
    'Aegis Project'
  ]) {
    await expect(page.locator('.research-card').filter({ hasText: topicName })).toBeAttached();
  }
});
