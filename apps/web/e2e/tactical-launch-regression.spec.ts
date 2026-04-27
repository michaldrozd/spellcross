import { expect, test } from '@playwright/test';

type CampaignControl = {
  newCampaign: (slot?: number) => boolean;
  territories: () => Array<{ id: string }>;
  startBattle: (territoryId: string) => boolean;
};

declare global {
  interface Window {
    __campaignControl?: CampaignControl;
  }
}

test('launches every campaign territory without renderer errors', async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (err) => runtimeErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') runtimeErrors.push(msg.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__campaignControl));
  await page.evaluate(() => window.__campaignControl?.newCampaign(1));
  const territoryIds = await page.evaluate(() => window.__campaignControl?.territories().map((t) => t.id) ?? []);

  for (const territoryId of territoryIds) {
    runtimeErrors.length = 0;
    await page.evaluate(() => window.__campaignControl?.newCampaign(1));
    const started = await page.evaluate((id) => window.__campaignControl?.startBattle(id), territoryId);
    expect(started, `${territoryId} should launch`).toBeTruthy();
    await expect(page.locator('.battle-screen')).toBeVisible();
    await page.waitForTimeout(250);
    expect(runtimeErrors, `${territoryId} should not emit renderer errors`).toEqual([]);
  }
});
