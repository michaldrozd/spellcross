import { expect, test } from '@playwright/test';

test('strategic map marker remains the pointer target on hover', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));

  const markers = page.locator('.strategic-map-svg .territory-hit-area');
  await expect(markers.first()).toBeVisible();

  const count = Math.min(await markers.count(), 10);
  for (let i = 0; i < count; i++) {
    const marker = markers.nth(i);
    const territoryId = await marker.locator('..').getAttribute('data-territory-id');
    expect(territoryId).toBeTruthy();

    await marker.hover();
    const centerOwner = await marker.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      )?.closest('.territory-marker')?.getAttribute('data-territory-id') ?? null;
    });
    expect(centerOwner).toBe(territoryId);
  }
});
