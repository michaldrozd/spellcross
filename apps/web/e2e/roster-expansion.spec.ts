import { expect, test } from '@playwright/test';

import {
  convertResearch,
  endStrategicTurns,
  queueResearch,
  startFreshCampaign
} from './helpers';

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
  const firefly = page.locator('.recruit-btn').filter({ hasText: 'Firefly 105 Battery' });
  await expect(firefly).toContainText('Firefly Light Battery');
  await expect(page.locator('img[src$="/assets/generated/thunderhead_155.png"]')).toBeVisible();

  await convertResearch(page, 40);
  for (const topicId of [
    'esprit-de-corps',
    'mobile-fire-support',
    'firefly-light-battery'
  ]) {
    await queueResearch(page, topicId);
    await endStrategicTurns(page);
  }
  await expect(firefly).not.toContainText('LOCKED');
  await expect(firefly).toBeEnabled();
  await page.evaluate(() => (window as any).__campaignControl.dismissPopups());

  await page.getByRole('button', { name: /^Hero$/i }).click();
  await expect(page.locator('.recruit-btn').filter({ hasText: 'Captain John Alexander' })).toBeVisible();

  await page.getByRole('button', { name: /Research/i }).click();
  for (const topicName of [
    'Mobile Fire Support',
    'Deep Fires Network',
    'Expeditionary Mobility',
    'Autonomous Recon Wing',
    'Aegis Project'
  ]) {
    const topic = page.locator('.research-card').filter({
      has: page.getByRole('heading', { name: topicName, exact: true })
    });
    await expect(topic).toBeAttached();
  }
});
