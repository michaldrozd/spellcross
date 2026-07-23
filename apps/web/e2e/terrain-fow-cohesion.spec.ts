import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('terrain and fog presentation stays active across battlefield families', async ({ page }) => {
  test.setTimeout(90_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  for (const territoryId of ['sector-paris', 'sector-munich', 'sector-rift']) {
    await startBattle(page, territoryId);
    const renderProfile = page.getByTestId('battlefield-render-profile');
    await expect(renderProfile).toHaveAttribute('data-fow-memory', 'solid-muted');
    await expect(renderProfile).toHaveAttribute('data-terrain-detail', 'macro-seeded');
    await expect(page.locator('.battlefield-stage-host canvas')).toBeVisible();
  }

  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl.forceAllianceTurn());
  await page.getByRole('button', { name: /^Show Ranges$/i }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.rangeOverlayTiles().length
  ))).toBeGreaterThan(0);
  await expect(page.locator('.battle-mode-badge')).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
