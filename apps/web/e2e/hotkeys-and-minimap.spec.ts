import { test, expect } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('retreat flows back to strategic view', async ({ page }) => {
  await startBattle(page);
  await expect(page.locator('.battle-screen')).toBeVisible();
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  const warning = page.getByRole('alertdialog', { name: /confirm tactical retreat/i });
  await expect(warning).toContainText('Units marked for loss: 0');
  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await expect(warning).toBeHidden();
  await retreatToHq(page);
});

test('mobile tactical HUD preserves most of the screen for the battlefield', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startBattle(page);

  const hud = await page.locator('.battle-bottom-bar').boundingBox();
  expect(hud).not.toBeNull();
  expect(hud!.height).toBeLessThanOrEqual(220);
  expect(hud!.y).toBeGreaterThanOrEqual(620);
  await expect(page.getByRole('button', { name: /^Start Battle$/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Retreat$/i })).toBeVisible();
});
