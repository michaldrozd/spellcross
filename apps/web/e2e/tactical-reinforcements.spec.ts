import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('Commander reserve wave arrives after the first enemy force is cleared', async ({ page }) => {
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.revealAll?.());

  const initialEnemyCount = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.().length ?? 0);
  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();

  await expect(page.locator('.battle-phase-notice')).toContainText(/Pursuit Force Detected/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl?.enemyUnits?.().length ?? 0)).toBe(initialEnemyCount + 2);
  await expect(page.locator('.log-line').filter({ hasText: /Reinforcements/i }).first()).toBeVisible();
});

test('Ash Crown encounter arrives as a second Rift phase', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-rift');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.revealAll?.());

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect(page.locator('.battle-phase-notice')).toContainText(/Portal Surge/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect(page.locator('.battle-phase-notice')).toContainText(/Ash Crown Descends/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);
});
