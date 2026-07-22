import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

test('HQ previews and applies refill experience before committing the service', async ({ page }) => {
  await startFreshCampaign(page);
  await page.getByRole('button', { name: /Army \(/i }).click();

  const captain = page.locator('.unit-row').filter({ hasText: 'Captain John Alexander' });
  await expect(captain).toContainText('Elite');
  await expect(captain).toContainText('XP 60');
  await expect(captain).toContainText('60→36 XP · Veteran');

  const refill = captain.getByRole('button', { name: /REFILL/i });
  await expect(refill).toHaveAttribute('title', 'After refill: 36 XP · Veteran');
  await refill.click();

  await expect(captain).toContainText('Veteran');
  await expect(captain).toContainText('XP 36');
  await expect(captain).toContainText('36→21 XP · Rookie');
});
