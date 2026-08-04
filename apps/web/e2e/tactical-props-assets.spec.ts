import { expect, test } from '@playwright/test';

test('tactical map prop textures load from absolute asset paths', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  const propLoads = new Map<string, { path: string; status: number; contentType: string }>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/props/')) return;
    propLoads.set(path, {
      path,
      status: response.status(),
      contentType: response.headers()['content-type'] ?? ''
    });
  });
  await page.evaluate(() => {
    (window as any).__campaignControl.newCampaign(1);
    (window as any).__campaignControl.startBattle('sector-strasbourg');
  });
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await expect.poll(() => propLoads.size).toBeGreaterThan(0);

  for (const propLoad of propLoads.values()) {
    expect(propLoad.path.startsWith('/props/')).toBe(true);
    expect(propLoad.status).toBe(200);
    expect(propLoad.contentType).toContain('image/');
  }
});
