import { expect, test } from '@playwright/test';
import { startFreshCampaign } from './helpers';

test('army recruit queue shows incoming units with readiness turn', async ({ page }) => {
  await startFreshCampaign(page);

  await page.getByRole('button', { name: /ARMY/i }).click();
  await expect(page.getByRole('button', { name: /Captain John Alexander/i })).toBeDisabled();
  await page.getByRole('button', { name: /Light Infantry/i }).click();

  await expect(page.getByRole('heading', { name: 'IN TRANSIT' })).toBeVisible();
  await expect(page.locator('.reserve-row').filter({ hasText: /Light Infantry/i })).toContainText(/READY T\d+/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.locator('.menu-buttons .menu-btn').first().click();
  await page.locator('.hq-tabs .tab').nth(1).click();
  const recruitCards = page.locator('.recruit-btn');
  await expect(recruitCards).toHaveCount(38);
  expect(await recruitCards.evaluateAll((cards) => cards.filter((card) => (
    (card as HTMLElement).scrollHeight > (card as HTMLElement).clientHeight + 1
  )).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
