import { expect, test } from '@playwright/test';
import { endStrategicTurns, launchBattle, queueResearch, retreatToHq, startFreshCampaign } from './helpers';

test('campaign loop with research, battle resolution, and timed events', async ({ page }) => {
  test.setTimeout(120_000);
  await startFreshCampaign(page);

  await queueResearch(page, 'esprit-de-corps');

  await endStrategicTurns(page, 3);

  await launchBattle(page, 'sector-lyon');
  await page.evaluate(() => (window as any).__battleControl?.moveFirst?.());
  await page.evaluate(() => (window as any).__battleControl?.attackFirst?.());
  await page.evaluate(() => (window as any).__battleControl?.wipeEnemies?.());
  await retreatToHq(page);

  await endStrategicTurns(page, 3);

  await expect(page.locator('.turn-info')).toContainText(/TURN/i);
  await expect(page.locator('.turn-info')).toContainText(/WAR CLOCK/i);
});
