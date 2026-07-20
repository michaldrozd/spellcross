import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('ammo consumption and resupply on supply zones', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-strasbourg');

  const ammoMeta = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.() ?? null);
  expect(ammoMeta).not.toBeNull();
  expect(ammoMeta?.cap).not.toBeNull();

  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  const vehicle = await page.evaluate(() => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((unit: any) => unit.definitionId === 'm113') ?? null;
  });
  expect(vehicle).not.toBeNull();

  // The generated map keeps its destructible bridge span north of the deployment zone. Place the IFV
  // beside it so this test exercises firing and resupply instead of spending many turns travelling.
  await page.evaluate((unitId) => (window as any).__battleControl?.snapUnit?.(unitId, 14, 10), vehicle.id);
  const attackRes = await page.evaluate(() => (window as any).__battleControl?.attackTile?.(15, 10));
  expect(attackRes?.success).toBeTruthy();
  const ammoAfter = attackRes?.ammoAfter as number;
  expect(ammoAfter).toBeLessThan(ammoMeta!.ammo as number);

  // Return to the original supply tile. Two hand-offs bring the alliance turn around again and apply
  // its start-of-turn resupply.
  await page.evaluate(({ id, coord }) => {
    const control = (window as any).__battleControl;
    control?.snapUnit?.(id, coord.q, coord.r);
    control?.endTurn?.();
    control?.endTurn?.();
  }, { id: vehicle.id, coord: vehicle.coord });
  const ammoRefilled = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(ammoRefilled).toBeGreaterThanOrEqual(ammoMeta!.cap as number);

  await retreatToHq(page);
});
