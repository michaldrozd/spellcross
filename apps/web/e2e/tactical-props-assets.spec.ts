import { expect, test } from '@playwright/test';

test('tactical map prop textures load from absolute asset paths', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => {
    (window as any).__campaignControl.newCampaign(1);
    (window as any).__campaignControl.startBattle('sector-strasbourg');
  });
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.waitForTimeout(500);

  const propLoads = await page.evaluate(async () => {
    const propUrls = [...new Set(
      performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/props/'))
    )].sort();

    const checks = [];
    for (const url of propUrls) {
      const res = await fetch(url, { cache: 'no-store' });
      checks.push({
        path: url.replace(location.origin, ''),
        status: res.status,
        contentType: res.headers.get('content-type') ?? ''
      });
    }
    return checks;
  });

  expect(propLoads.length).toBeGreaterThan(0);
  for (const propLoad of propLoads) {
    expect(propLoad.path.startsWith('/props/')).toBe(true);
    expect(propLoad.status).toBe(200);
    expect(propLoad.contentType).toContain('image/');
  }
});
