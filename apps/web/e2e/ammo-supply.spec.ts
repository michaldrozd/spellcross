import { expect, test } from '@playwright/test';

test('ammo consumption and resupply on supply zones', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');

  const bridgeTerritory = page.locator('li', { hasText: 'River Bridge' });
  await bridgeTerritory.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  const ammoMeta = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.() ?? null);
  expect(ammoMeta).not.toBeNull();
  expect(ammoMeta?.cap).not.toBeNull();

  // Fire at the destructible span to consume ammo
  const attackRes = await page.evaluate(() => (window as any).__battleControl?.attackTile?.(4, 3));
  expect(attackRes?.success).toBeTruthy();
  const ammoAfter = attackRes?.ammoAfter as number;
  expect(ammoAfter).toBeLessThan(ammoMeta!.ammo as number);

  // Move back to a start/supply tile and end turn to resupply fully
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(0, 2));
  await page.getByRole('button', { name: /^End Turn$/i }).click().catch(() => {});
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  const ammoRefilled = await page.evaluate(() => (window as any).__battleControl?.ammoFirst?.()?.ammo ?? null);
  expect(ammoRefilled).toBeGreaterThanOrEqual(ammoMeta!.cap as number);

  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
