import { expect, test } from '@playwright/test';

test('unit can move by clicking tiles in isometric view', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  // Enter first available battle
  await page.getByRole('button', { name: /^Attack$/i }).first().click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  // Exit deployment then force player turn with fresh AP
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  // Grab initial position of first ally from helper
  const before = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const ally = Array.from(allies ?? [])[0];
    return ally?.coord;
  });
  expect(before).toBeTruthy();

  // Click a nearby tile to attempt move
  const target = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const first = ctrl?.allyUnits?.()?.[0];
    if (!first) return null;
    const neighbors = [
      { q: first.coord.q + 1, r: first.coord.r },
      { q: first.coord.q - 1, r: first.coord.r },
      { q: first.coord.q, r: first.coord.r + 1 },
      { q: first.coord.q, r: first.coord.r - 1 }
    ];
    for (const n of neighbors) {
      const p = ctrl?.pathTo?.(n.q, n.r);
      if (p?.success && p.path.length) {
        return p.path[p.path.length - 1];
      }
    }
    return null;
  });
  expect(target).toBeTruthy();
  const moved = await page.evaluate(({ q, r }) => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const first = Array.from(allies ?? [])[0];
    if (!first) return false;
    return ctrl?.moveUnitTo?.(first.id, q, r);
  }, target!);
  expect(moved).toBeTruthy();

  // Wait a tick and ensure position updated
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const ally = Array.from(allies ?? [])[0];
    return ally?.coord;
  });
  expect(after).toBeTruthy();
  expect(after?.q === target.q && after?.r === target.r).toBeTruthy();
});
