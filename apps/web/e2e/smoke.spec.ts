import { expect, test } from '@playwright/test';

test('loads strategic view', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.locator('.menu-lang-btn').nth(1).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('spellcross:lang'))).toBe('sk');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk');
  await page.locator('.menu-lang-btn').nth(0).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));

  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /OPS\s+Territories/i })).toBeVisible();
  await expect(page.locator('.strategic-map-svg')).toBeVisible();
});
