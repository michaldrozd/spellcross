import { expect, test } from '@playwright/test';
import { endStrategicTurns, startFreshCampaign } from './helpers';

test('strategic raid spawns counteroffensive territory and can be defended', async ({ page }) => {
  test.setTimeout(80_000);
  await startFreshCampaign(page);

  await endStrategicTurns(page, 10);

  const raidCount = await page.evaluate(() => {
    const territories = (window as any).__campaignControl?.territories?.() ?? [];
    return territories.filter((t: any) => /Enemy Raid/i.test(t.name)).length;
  });
  expect(raidCount).toBeGreaterThan(0);
});
