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

  const blocker = await page.evaluate((unitId) => {
    const control = (window as any).__battleControl;
    const units = control?.allyUnits?.() ?? [];
    const vehicleUnit = units.find((unit: any) => unit.id === unitId);
    if (!vehicleUnit) return null;
    const occupied = new Set(units.map((unit: any) => `${unit.coord.q},${unit.coord.r}`));
    const target = [
      { q: vehicleUnit.coord.q, r: vehicleUnit.coord.r - 1 },
      { q: vehicleUnit.coord.q + 1, r: vehicleUnit.coord.r },
      { q: vehicleUnit.coord.q - 1, r: vehicleUnit.coord.r },
      { q: vehicleUnit.coord.q, r: vehicleUnit.coord.r + 1 }
    ].find((coordinate) => (
      !occupied.has(`${coordinate.q},${coordinate.r}`)
      && control?.tileAt?.(coordinate.q, coordinate.r)
    ));
    if (!target || !control.placeDestructibleVisionBlocker(target.q, target.r, 1)) return null;
    return target;
  }, vehicle.id);
  expect(blocker).not.toBeNull();
  const attackRes = await page.evaluate(({ q, r }) => (
    (window as any).__battleControl?.attackTile?.(q, r)
  ), blocker!);
  expect(attackRes?.success).toBeTruthy();
  expect(attackRes?.attackerId).toBe(vehicle.id);
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
