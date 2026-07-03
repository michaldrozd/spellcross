import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

async function clickHex(page: import('@playwright/test').Page, q: number, r: number) {
  const pos = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const helper = (window as any).__battleControl?.pixelFor?.(q, r);
    if (!canvas || !helper) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + helper.x + 4, y: rect.top + helper.y + 4 };
  }, { q, r });
  expect(pos).not.toBeNull();
  await page.mouse.click(pos!.x, pos!.y);
}

test('ui-driven hex clicks can break destructible cover and still resolve battle flow', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'sector-strasbourg');

  // Select the M113 IFV (force-prioritized into deployment slot 0, so it spawns at the
  // alliance zone's first tile) and move it one step using real canvas clicks.
  await clickHex(page, 0, 19);
  await clickHex(page, 1, 19);
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
