import { expect, test } from '@playwright/test';

test('strategic map marker hover does not flicker', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));

  const markers = page.locator('.strategic-map-svg .territory-hit-area');
  await expect(markers.first()).toBeVisible();

  const count = Math.min(await markers.count(), 10);
  for (let i = 0; i < count; i++) {
    const box = await markers.nth(i).boundingBox();
    expect(box).toBeTruthy();
    if (!box) continue;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
    await page.waitForTimeout(40);

    const hoveredMarkers = await page.evaluate(
      () => document.querySelectorAll('.strategic-map-svg .territory-marker:hover').length
    );
    expect(hoveredMarkers).toBe(1);
  }
});
