import { expect, test } from '@playwright/test';
import { endStrategicTurns, launchBattle, retreatToHq, startFreshCampaign } from './helpers';

test('counterattack territory unlocks after timers expire', async ({ page }) => {
  test.setTimeout(70_000);
  await startFreshCampaign(page);

  await endStrategicTurns(page, 5);

  const counterId = await page.evaluate(() => {
    const territories = (window as any).__campaignControl?.territories?.() ?? [];
    return territories.find((t: any) => /Counterattack/i.test(t.name))?.id ?? null;
  });
  expect(counterId).toBeTruthy();
  await launchBattle(page, counterId);
  await expect(page.getByRole('heading', { name: /Counterattack/i })).toBeVisible();

  await retreatToHq(page);
});
