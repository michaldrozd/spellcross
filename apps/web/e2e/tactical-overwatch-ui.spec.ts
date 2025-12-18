import { expect, test } from '@playwright/test';

test('overwatch UI shows status after preparing reaction fire', async ({ page }) => {
  test.setTimeout(80_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  await page.locator('li', { hasText: 'Crossroads Hold' }).getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  const setResult = await page.evaluate(() => (window as any).__battleControl?.setOverwatch?.());
  expect(setResult?.success ?? setResult === true).toBeTruthy();

  await page.evaluate(() => (window as any).__battleControl?.selectUnit?.());

  await expect(page.getByText(/Overwatch ready/i)).toBeVisible();
});
