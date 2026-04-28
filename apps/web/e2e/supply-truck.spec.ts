import { expect, test } from '@playwright/test';
import { endStrategicTurns, launchBattle, retreatToHq, startFreshCampaign } from './helpers';

test('supply truck resupplies ammo mid-battle', async ({ page }) => {
  test.setTimeout(70_000);
  await startFreshCampaign(page);

  await endStrategicTurns(page, 6);

  const counterId = await page.evaluate(() => {
    const territories = (window as any).__campaignControl?.territories?.() ?? [];
    return territories.find((t: any) => /Counterattack/i.test(t.name))?.id ?? 'sector-paris';
  });
  await launchBattle(page, counterId);

  const initialAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  await page.evaluate(() => (window as any).__battleControl?.drainAmmo?.(3));
  const drainedAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(drainedAmmo).toBeLessThan(initialAmmo as number);

  // Move toward ally supply (truck follows as ally unit) and end turn to allow resupply
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(1, 2));
  await page.getByRole('button', { name: /^End Turn$/i }).click({ timeout: 1000 }).catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  const refilled = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(refilled).toBeGreaterThanOrEqual(initialAmmo as number);

  await retreatToHq(page);
});
