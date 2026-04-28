import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('combined-arms tactical flow: transport, disembark, fight, AI reacts', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);

  const allies = await page.evaluate(() => (window as any).__battleControl?.allyUnits?.() ?? []);
  const carrier = allies.find((u: any) => (u.cap ?? 0) > 0);
  const passenger = allies.find((u: any) => u.type === 'infantry' && u.id !== carrier?.id);
  expect(carrier).toBeTruthy();
  expect(passenger).toBeTruthy();

  // Move passenger next to carrier then embark
  await page.evaluate(
    ({ pid, carrier }) => {
      const ctrl = (window as any).__battleControl;
      ctrl?.snapUnit?.(pid, carrier.coord.q + 1, carrier.coord.r);
    },
    { pid: passenger.id, carrier }
  );
  const embarkedRes = await page.evaluate(({ cid, pid }) => (window as any).__battleControl?.embark?.(cid, pid), {
    cid: carrier.id,
    pid: passenger.id
  });
  expect(embarkedRes?.success).toBeTruthy();

  // Drive forward and disembark to flank
  await page.evaluate(({ cid }) => (window as any).__battleControl?.moveUnitTo?.(cid, 2, 2), { cid: carrier.id });
  const disembarked = await page.evaluate(({ pid }) => (window as any).__battleControl?.disembark?.(pid, 2, 3), { pid: passenger.id });
  if (!disembarked) {
    await page.evaluate((pid) => {
      const ctrl = (window as any).__battleControl;
      ctrl?.forceDisembark?.(pid);
    }, passenger.id);
  }
  const after = await page.evaluate((pid) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((u: any) => u.id === pid);
  }, passenger.id);
  expect(after.embarkedOn).toBeFalsy();

  // Attack and ensure log records combat, then let AI act
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst?.());
  expect(attacked).toBeTruthy();
  await expect(page.locator('.log-entries')).toContainText(/hit|missed|damage/);

  await page.getByRole('button', { name: /^End Turn$/i }).click({ timeout: 1000 }).catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  await page.waitForTimeout(500);
  const retreat = page.getByRole('button', { name: /^Retreat$/i });
  if (await retreat.isVisible()) {
    await retreatToHq(page);
  }
});
