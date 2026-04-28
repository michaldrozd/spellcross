import { test, expect } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('retreat flows back to strategic view', async ({ page }) => {
  await startBattle(page);
  await expect(page.locator('.battle-screen')).toBeVisible();
  await retreatToHq(page);
});
