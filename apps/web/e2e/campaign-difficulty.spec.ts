import { expect, test } from '@playwright/test';

test('new campaign difficulty is selected, displayed, and restored from its save', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /New Game/i }).click();

  const veteran = page.getByRole('radio', { name: /Veteran/i });
  await expect(veteran).toHaveAttribute('aria-checked', 'false');
  await veteran.click();
  await expect(veteran).toHaveAttribute('aria-checked', 'true');
  await page.locator('.slot-actions').getByRole('button', { name: /New Game/i }).click();

  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await expect(page.locator('.campaign-difficulty')).toHaveText('VETERAN');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('spellcross:campaign-state:1') ?? '{}'));
  expect(persisted).toMatchObject({ difficulty: 'veteran', globalTimer: 20 });

  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await expect(page.locator('.campaign-difficulty')).toHaveText('VETERAN');
});
