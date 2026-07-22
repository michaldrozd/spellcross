import { expect, test } from '@playwright/test';
import { endStrategicTurns, retreatToHq, startFreshCampaign } from './helpers';

test('supply truck resupplies ammo mid-battle', async ({ page }) => {
  test.setTimeout(70_000);
  await startFreshCampaign(page);

  await endStrategicTurns(page, 6);

  await page.getByRole('button', { name: /Territories/i }).click();
  await page.getByText(/^Paris$/).click({ force: true });
  await page.getByRole('button', { name: /Launch Attack/i }).click();
  const planner = page.getByRole('dialog', { name: /Paris Outskirts/i });
  await expect(planner).toBeVisible();
  await expect(planner.locator('.deployment-support')).toContainText(/Supply Truck/i);
  await expect(planner.locator('.deployment-support')).toContainText(/Attached Support/i);
  await planner.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));

  const supplyUnits = await page.evaluate(() => (
    (window as any).__battleControl.allyUnits().filter((unit: any) => unit.definitionId === 'supply-truck')
  ));
  expect(supplyUnits).toHaveLength(1);

  const initialAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  await page.evaluate(() => (window as any).__battleControl?.drainAmmo?.(3));
  const drainedAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(drainedAmmo).toBeLessThan(initialAmmo as number);

  // Move toward ally supply (truck follows as ally unit) and end turn to allow resupply
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(1, 2));
  await page.getByRole('button', { name: /^End Turn$/i }).click({ timeout: 1000 }).catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  const refilled = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(refilled).toBeGreaterThanOrEqual(initialAmmo as number);

  await retreatToHq(page);
});
