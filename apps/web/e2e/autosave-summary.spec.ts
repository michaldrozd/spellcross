import { expect, test } from '@playwright/test';
import { endStrategicTurns, startFreshCampaign } from './helpers';

test('autosave summary updates and persists across reload', async ({ page }) => {
  test.setTimeout(60_000);
  await startFreshCampaign(page);

  await expect(page.getByText(/TURN 1/i)).toBeVisible();

  await endStrategicTurns(page);
  await expect(page.getByText(/TURN 2/i)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /CONTINUE/i })).toBeVisible();
  await expect(page.locator('.menu-intel-panel')).toContainText(/Turn 2/i);

  await page.getByRole('button', { name: /CONTINUE/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  const popupButton = page.getByRole('button', { name: /Dismiss briefings/i });
  if (await popupButton.isVisible()) {
    await popupButton.click();
    await expect(popupButton).not.toBeVisible({ timeout: 2000 });
  }
});
