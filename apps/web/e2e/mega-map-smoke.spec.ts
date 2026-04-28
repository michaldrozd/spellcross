import { test, expect } from '@playwright/test';
import { startBattle } from './helpers';

test('end turn button exists in tactical view', async ({ page }) => {
  await startBattle(page);
  const commandButton = page.getByRole('button', { name: /^Start Battle$/i });
  await expect(commandButton).toBeVisible();
  await commandButton.click();
  await expect(page.getByRole('button', { name: /^End Turn$/i })).toBeVisible();
});
