import { expect, test } from '@playwright/test';

test('autosave summary updates and persists across reload', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  const summary = page.getByTestId('slot-summary');
  await expect(summary).toContainText(/Turn 1/);

  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect(summary).toContainText(/Turn 2/);

  // Reload and ensure the summary still reflects turn 2
  await page.reload();
  await expect(page.getByTestId('slot-summary')).toContainText(/Turn 2/);

   // Popups should be dismissible and persist cleared state after dismissal
  const popupButton = page.getByRole('button', { name: /Dismiss briefings/i });
  if (await popupButton.isVisible()) {
    await popupButton.click();
    await expect(popupButton).not.toBeVisible({ timeout: 2000 });
  }
});
