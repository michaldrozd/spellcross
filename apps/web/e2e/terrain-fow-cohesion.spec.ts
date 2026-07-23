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
    const memoryAlphaValue = await renderProfile.getAttribute('data-fow-memory-alpha');
    const memoryTintValue = await renderProfile.getAttribute('data-fow-memory-tint');
    expect(memoryAlphaValue).toBe('1');
    expect(memoryTintValue).toMatch(/^[0-9a-f]{6}$/);
    const memoryAlpha = Number(memoryAlphaValue);
    const memoryTint = Number.parseInt(memoryTintValue!, 16);
    const memoryTintChannels = [
      (memoryTint >> 16) & 0xff,
      (memoryTint >> 8) & 0xff,
      memoryTint & 0xff
    ];
    expect(memoryAlpha).toBeGreaterThanOrEqual(0.9);
    expect(memoryAlpha).toBeLessThanOrEqual(1);
    expect(Math.min(...memoryTintChannels)).toBeGreaterThanOrEqual(96);
    expect(Math.max(...memoryTintChannels)).toBeLessThanOrEqual(160);
    expect(Math.max(...memoryTintChannels) - Math.min(...memoryTintChannels)).toBeLessThanOrEqual(16);
    await expect(renderProfile).toHaveAttribute('data-terrain-detail-texture', '256x256');
    await expect(renderProfile).toHaveAttribute('data-contact-shadow-layers', '3');
    const gridAlpha = Number(await renderProfile.getAttribute('data-terrain-grid-alpha'));
    expect(gridAlpha).toBeGreaterThan(0);
    expect(gridAlpha).toBeLessThan(0.03);
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
