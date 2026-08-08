import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

test('HQ previews and applies refill experience before committing the service', async ({ page }) => {
  await startFreshCampaign(page);
  await page.evaluate(() => (window as any).__campaignControl.setArmyUnitHealth('captain', 1));
  await page.getByRole('button', { name: /Army \(/i }).click();

  const captain = page.locator('.unit-row').filter({ hasText: 'Captain Adam Halden' });
  await expect(captain).toContainText('Elite');
  await expect(captain).toContainText('XP 60');

  await captain.getByRole('button', { name: /SERVICE/i }).click();
  const service = page.getByRole('dialog', { name: /Captain Adam Halden/i });
  const rookieRefill = service.locator('.service-options').first().locator('button').first();
  await expect(rookieRefill).toContainText('Returns with 36 XP · Veteran');
  await rookieRefill.click();

  await expect(service).toContainText('120/120 HP · 36 XP · Veteran');
  await expect(service.locator('.service-options').first().locator('button').first())
    .toContainText('Returns with 21 XP · Rookie');
  await expect(service.locator('.service-options').first().locator('button').first()).toBeDisabled();
});
