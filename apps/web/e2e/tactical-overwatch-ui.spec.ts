import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('overwatch UI shows status after preparing reaction fire', async ({ page }) => {
  test.setTimeout(80_000);
  await startBattle(page, 'sector-lyon');

  const setResult = await page.evaluate(() => (window as any).__battleControl?.setOverwatch?.());
  expect(setResult?.success ?? setResult === true).toBeTruthy();

  await page.evaluate(() => (window as any).__battleControl?.selectUnit?.());

  await expect(page.locator('.badge', { hasText: /Overwatch/i })).toBeVisible();
});
