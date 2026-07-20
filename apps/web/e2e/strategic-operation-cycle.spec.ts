import { expect, test } from '@playwright/test';
import { endStrategicTurns, launchBattle, retreatToHq, startFreshCampaign } from './helpers';

test('HQ unlocks one battlefield operation per strategic turn', async ({ page }) => {
  await startFreshCampaign(page, 3);
  await launchBattle(page, 'sector-paris');
  await retreatToHq(page);

  await page.locator('.territory-marker.territory-available .territory-hit-area').first().click();
  const launchButton = page.locator('.attack-btn-large');
  await expect(launchButton).toBeDisabled();
  await expect(launchButton).toContainText(/OPERATION COMMITTED/i);

  const secondLaunch = await page.evaluate(() => (window as any).__campaignControl.startBattle('sector-lyon'));
  expect(secondLaunch).toBe(false);
  await expect(page.locator('.battle-screen')).toHaveCount(0);

  await endStrategicTurns(page);
  await expect(launchButton).toBeEnabled();
  await expect(launchButton).toContainText(/LAUNCH ATTACK/i);
});
