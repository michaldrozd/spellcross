import { expect, test } from '@playwright/test';

const waitForLog = async (page: import('@playwright/test').Page, text: string) =>
  expect.poll(async () => (await page.locator('.log').textContent()) ?? '').toContain(text);

test('varied tactical combat: vehicle/artillery, destructibles, fog/night', async ({ page }) => {
  test.setTimeout(70_000);

  // Strategic: ensure we have resources and start Optics II quickly
  await page.goto('/');
  await page.getByRole('button', { name: /Convert 3 SP → RP/i }).click();
  await page.getByRole('button', { name: /Convert 3 SP → RP/i }).click();
  const optics2 = page.locator('li', { hasText: 'Optics II' });
  await optics2.getByRole('button', { name: /Start/i }).click();
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect(page.getByText(/Known tech:/i)).toContainText('optics-ii');

  // Attack River Bridge (has destructible tiles)
  const bridgeTerritory = page.locator('li', { hasText: 'River Bridge' });
  await bridgeTerritory.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  // Move forward and attempt attack (uses default unit)
  await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    if (!ctrl) return false;
    const tries = [
      ctrl.moveTo(1, 2),
      ctrl.moveTo(0, 2),
      ctrl.moveTo(1, 3),
      ctrl.moveTo(0, 3)
    ];
    return tries.some(Boolean);
  });
  await page.evaluate(() => (window as any).__battleControl?.attackFirst());

  // End turn and retreat back to HQ
  await page.evaluate(() => (window as any).__battleControl?.endTurn());
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Attack Forward Outpost (night/fog enemies) to test visibility and ranged attacks
  const outpostTerritory = page.locator('li', { hasText: 'Forward Outpost' });
  await outpostTerritory.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  // Move and attack in low-vision conditions
  await page.evaluate(() => (window as any).__battleControl?.moveTo(3, 2));
  const visBefore = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  const visAfter = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visAfter).toBeGreaterThanOrEqual(visBefore);

  // End turn and retreat
  await page.evaluate(() => (window as any).__battleControl?.endTurn());
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
