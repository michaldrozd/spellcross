import { expect, test } from '@playwright/test';

test('supply truck resupplies ammo mid-battle', async ({ page }) => {
  test.setTimeout(70_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();

  // Progress to unlock supply trucks via turn 6 event
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
  }

  // Attack any territory to enter battle with supply truck auto-attached
  const counterattack = page.locator('li', { hasText: 'Enemy Counterattack' });
  const attackBtn = counterattack.getByRole('button', { name: /^Attack$/i }).filter({ hasNot: page.locator('[disabled]') }).first();
  await expect(attackBtn).toBeEnabled();
  await attackBtn.click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  const initialAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  await page.evaluate(() => (window as any).__battleControl?.drainAmmo?.(3));
  const drainedAmmo = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(drainedAmmo).toBeLessThan(initialAmmo as number);

  // Move toward ally supply (truck follows as ally unit) and end turn to allow resupply
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(1, 2));
  await page.getByRole('button', { name: /^End Turn$/i }).click().catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  const refilled = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(refilled).toBeGreaterThanOrEqual(initialAmmo as number);

  const retreat = page.getByRole('button', { name: /^Retreat$/i });
  if (await retreat.isVisible()) {
    await retreat.click();
  }
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
