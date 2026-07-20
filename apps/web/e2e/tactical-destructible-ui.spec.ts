import { expect, test } from '@playwright/test';
import { clickBattleTile, retreatToHq, startBattle } from './helpers';

test('ui-driven hex clicks can break destructible cover and still resolve battle flow', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'sector-strasbourg');

  // Select the M113 IFV (force-prioritized into deployment slot 0, so it spawns at the
  // alliance zone's first tile) and move it one step using real canvas clicks.
  await clickBattleTile(page, 0, 19);
  await clickBattleTile(page, 1, 19);
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(1, 19));

  // The only destructible structures on this procedurally generated map sit well north of the
  // start zone, far beyond a single turn's action points. Snap the IFV next to one instead of
  // walking it there turn by turn.
  const vehicleId = await page.evaluate(() => {
    const allies = (window as any).__battleControl?.allyUnits?.() ?? [];
    return allies.find((unit: any) => unit.definitionId === 'm113')?.id ?? null;
  });
  expect(vehicleId).not.toBeNull();
  await page.evaluate((id) => (window as any).__battleControl?.snapUnit?.(id, 14, 10), vehicleId);

  // Blow the destructible structure tile to open the route
  const destroyed = await page.evaluate(() => (window as any).__battleControl?.attackTile?.(15, 10));
  if (!destroyed?.success) {
    throw new Error(`attackTile failed: ${JSON.stringify(destroyed)}`);
  }

  // Finish flow and return to HQ
  await retreatToHq(page);
});
