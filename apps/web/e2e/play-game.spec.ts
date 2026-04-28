import { test, expect } from '@playwright/test';
import { startBattle } from './helpers';

test('can launch a battle and render the map', async ({ page }) => {
  await startBattle(page);
  await expect(page.locator('.battle-screen')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Evacuation Run/i })).toBeVisible();
});
