import { expect, type Page } from '@playwright/test';

export async function startFreshCampaign(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible({ timeout: 10_000 });
}

export async function startBattle(page: Page, territoryId = 'sector-paris') {
  await startFreshCampaign(page);
  const started = await page.evaluate((id) => (window as any).__campaignControl.startBattle(id), territoryId);
  expect(started).toBeTruthy();
  await expect(page.locator('.battle-screen')).toBeVisible({ timeout: 10_000 });
}
