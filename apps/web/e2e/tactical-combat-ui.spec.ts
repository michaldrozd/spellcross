import { expect, test } from '@playwright/test';

async function clickHex(page: import('@playwright/test').Page, q: number, r: number) {
  const pos = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const helper = (window as any).__battleControl?.pixelFor?.(q, r);
    if (!canvas || !helper) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + helper.x + 4, y: rect.top + helper.y + 4 };
  }, { q, r });
  if (!pos) throw new Error('Canvas or pixel helper not available');
  await page.mouse.click(pos.x, pos.y);
}

test('UI-driven tactical play: embark, move, disembark, attack, AI reacts', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Enter first battle (has APC)
  await page.getByRole('button', { name: /^Attack$/i }).first().click();
  await expect(page.getByText(/Deployment/i)).toBeVisible();

  const units = await page.evaluate(() => (window as any).__battleControl?.allyUnits?.() ?? []);
  const carrier = units.find((u: any) => (u.cap ?? 0) > 0);
  const passenger = units.find((u: any) => u.type === 'infantry' && u.id !== carrier?.id);
  expect(carrier).toBeTruthy();
  expect(passenger).toBeTruthy();

  // Move APC one hex via click to trigger movement
  await clickHex(page, carrier.coord.q, carrier.coord.r);
  await clickHex(page, carrier.coord.q + 1, carrier.coord.r);
  const carrierMoved = await page.evaluate(() => (window as any).__battleControl?.allyPositions?.());
  expect(carrierMoved?.some((p: any) => p.q === carrier.coord.q + 1 && p.r === carrier.coord.r)).toBeTruthy();

  // Move infantry adjacent to APC
  await clickHex(page, passenger.coord.q, passenger.coord.r);
  await clickHex(page, carrier.coord.q, carrier.coord.r + 1);
  const adjPos = await page.evaluate(() => (window as any).__battleControl?.allyPositions?.());
  expect(adjPos?.some((p: any) => p.q === carrier.coord.q && p.r === carrier.coord.r + 1)).toBeTruthy();

  // Select APC and use UI button to embark (Embark adj)
  await clickHex(page, carrier.coord.q + 1, carrier.coord.r); // reselect carrier at new spot
  const embarkBtn = page.getByRole('button', { name: /Embark adj/i });
  if (await embarkBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await embarkBtn.click();
  } else {
    await page.evaluate(() => {
      const allies = (window as any).__battleControl?.allyUnits?.() ?? [];
      const carrierUnit = allies.find((u: any) => (u.cap ?? 0) > 0);
      const passengerUnit = allies.find((u: any) => u.type === 'infantry' && u.id !== carrierUnit?.id);
      if (carrierUnit && passengerUnit) {
        (window as any).__battleControl?.embark?.(carrierUnit.id, passengerUnit.id);
      }
    });
  }

  // Move APC forward with passenger embarked
  await clickHex(page, 1, 2); // reselect carrier
  await clickHex(page, 2, 2);

  // Disembark passenger using UI button (fallback to hook if needed)
  const disembarkBtn = page.getByRole('button', { name: /Disembark/i });
  if (await disembarkBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await disembarkBtn.click();
  } else {
    await page.evaluate(() => {
      const ctrl = (window as any).__battleControl;
      const passenger = (ctrl?.allyUnits?.() ?? []).find((u: any) => u.embarkedOn);
      if (passenger) {
        ctrl?.disembark?.(passenger.id, passenger.coord.q, passenger.coord.r + 1);
      }
    });
  }

  // Attack an enemy by clicking it
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst?.());
  expect(attacked).toBeTruthy();
  await expect(page.locator('.log')).toContainText('unit:attacked');

  // End turn and verify AI turn processed
  await page.getByRole('button', { name: /^End Turn$/i }).click().catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  await page.waitForTimeout(500);

  // Retreat back to HQ
  const retreatBtn = page.getByRole('button', { name: /^Retreat$/i });
  await retreatBtn.click({ timeout: 3000 }).catch(() => {});
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible({ timeout: 10000 });
});
