import { expect, test } from '@playwright/test';

import { clickBattleTile, retreatToHq, startBattle } from './helpers';

test('ui-driven hex clicks can break destructible cover and still resolve battle flow', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'sector-strasbourg');

  const movement = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const allies = control?.allyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.definitionId === 'm113');
    if (!vehicle) return null;
    const occupied = new Set(allies.map((unit: any) => `${unit.coord.q},${unit.coord.r}`));
    const target = [
      { q: vehicle.coord.q, r: vehicle.coord.r - 1 },
      { q: vehicle.coord.q + 1, r: vehicle.coord.r },
      { q: vehicle.coord.q - 1, r: vehicle.coord.r },
      { q: vehicle.coord.q, r: vehicle.coord.r + 1 }
    ].find((coordinate) => (
      !occupied.has(`${coordinate.q},${coordinate.r}`)
      && control?.tileAt?.(coordinate.q, coordinate.r)?.passable
      && control?.pathForUnit?.(vehicle.id, coordinate.q, coordinate.r)?.success
    ));
    return target ? { vehicleId: vehicle.id, start: vehicle.coord, target } : null;
  });
  expect(movement).not.toBeNull();

  await clickBattleTile(page, movement!.start.q, movement!.start.r);
  await clickBattleTile(page, movement!.target.q, movement!.target.r);
  await expect.poll(async () => page.evaluate((vehicleId) => {
    const allies = (window as any).__battleControl?.allyUnits?.() ?? [];
    return allies.find((unit: any) => unit.id === vehicleId)?.coord ?? null;
  }, movement!.vehicleId)).toEqual(movement!.target);

  const blocker = await page.evaluate((vehicleId) => {
    const control = (window as any).__battleControl;
    const allies = control?.allyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.id === vehicleId);
    if (!vehicle) return null;
    const occupied = new Set(allies.map((unit: any) => `${unit.coord.q},${unit.coord.r}`));
    const target = [
      { q: vehicle.coord.q, r: vehicle.coord.r - 1 },
      { q: vehicle.coord.q + 1, r: vehicle.coord.r },
      { q: vehicle.coord.q - 1, r: vehicle.coord.r },
      { q: vehicle.coord.q, r: vehicle.coord.r + 1 }
    ].find((coordinate) => (
      !occupied.has(`${coordinate.q},${coordinate.r}`)
      && control?.tileAt?.(coordinate.q, coordinate.r)
    ));
    if (!target || !control.placeDestructibleVisionBlocker(target.q, target.r, 1)) return null;
    return target;
  }, movement!.vehicleId);
  expect(blocker).not.toBeNull();
  const destroyed = await page.evaluate(({ q, r }) => (
    (window as any).__battleControl?.attackTile?.(q, r)
  ), blocker!);
  if (!destroyed?.success) {
    throw new Error(`attackTile failed: ${JSON.stringify(destroyed)}`);
  }

  // Finish flow and return to HQ
  await retreatToHq(page);
});
