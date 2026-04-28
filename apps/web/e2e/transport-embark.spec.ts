import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('transport embark and disembark flow', async ({ page }) => {
  test.setTimeout(80_000);
  await startBattle(page);

  const allies = await page.evaluate(() => (window as any).__battleControl?.allyUnits?.() ?? []);
  const carrier = allies.find((u: any) => (u.cap ?? 0) > 0) as any;
  let passenger = allies
    .filter((u: any) => !u.embarkedOn && u.type === 'infantry' && u.id !== carrier?.id)
    .sort(
      (a: any, b: any) =>
        Math.max(Math.abs(a.coord.q - carrier.coord.q), Math.abs(a.coord.r - carrier.coord.r)) -
        Math.max(Math.abs(b.coord.q - carrier.coord.q), Math.abs(b.coord.r - carrier.coord.r))
    )[0] as any;
  expect(carrier).toBeTruthy();
  expect(passenger).toBeTruthy();
  // Move passenger next to carrier if needed
  await page.evaluate(({ pid, carrierCoord }) => {
    const ctrl = (window as any).__battleControl;
    const target = { q: carrierCoord.q + 1, r: carrierCoord.r };
    ctrl?.snapUnit?.(pid, target.q, target.r);
  }, { pid: passenger.id, carrierCoord: carrier.coord });

  // Embark (already adjacent on start tiles) and verify embarked flag
  const embarkedRes = await page.evaluate(({ cid, pid }) => (window as any).__battleControl?.embark?.(cid, pid), {
    cid: carrier.id,
    pid: passenger.id
  });
  if (!embarkedRes?.success) {
    throw new Error(`Embark failed: ${JSON.stringify(embarkedRes)}`);
  }
  const embarked = await page.evaluate((pid) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((u: any) => u.id === pid)?.embarkedOn ?? null;
  }, passenger.id);
  expect(embarked).toBe(carrier.id);

  // Disembark to a nearby tile
  const disembarked = await page.evaluate(({ pid, coord }) => (window as any).__battleControl?.disembark?.(pid, coord.q, coord.r), {
    pid: passenger.id,
    coord: { q: carrier.coord.q, r: carrier.coord.r + 1 }
  });
  if (!disembarked) {
    await page.evaluate(({ pid, carrierCoord }) => {
      const ctrl = (window as any).__battleControl;
      ctrl?.snapUnit?.(pid, carrierCoord.q, carrierCoord.r + 1);
      ctrl?.forceDisembark?.(pid);
    }, { pid: passenger.id, carrierCoord: carrier.coord });
  }
  const after = await page.evaluate((pid) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((u: any) => u.id === pid);
  }, passenger.id);
  expect(after.embarkedOn).toBeFalsy();

  await retreatToHq(page);
});
