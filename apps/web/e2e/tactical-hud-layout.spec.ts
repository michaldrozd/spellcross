import { expect, test, type Page } from '@playwright/test';

import { startBattle } from './helpers';

async function expectBottomDeckAligned(page: Page, maxPanelGap?: number) {
  const [unitPanel, logPanel, commandPanel, viewport] = await Promise.all([
    page.locator('.selected-unit-card').boundingBox(),
    page.locator('.battle-log-panel').boundingBox(),
    page.locator('.battle-controls').boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  ]);

  expect(unitPanel).not.toBeNull();
  expect(logPanel).not.toBeNull();
  expect(commandPanel).not.toBeNull();

  const panels = [unitPanel!, logPanel!, commandPanel!];
  const top = panels[0].y;
  const bottom = panels[0].y + panels[0].height;
  for (const panel of panels.slice(1)) {
    expect(Math.abs(panel.y - top)).toBeLessThanOrEqual(1);
    expect(Math.abs(panel.y + panel.height - bottom)).toBeLessThanOrEqual(1);
  }

  expect(unitPanel!.x + unitPanel!.width).toBeLessThan(logPanel!.x);
  expect(logPanel!.x + logPanel!.width).toBeLessThan(commandPanel!.x);
  if (maxPanelGap !== undefined) {
    expect(logPanel!.x - (unitPanel!.x + unitPanel!.width)).toBeLessThanOrEqual(maxPanelGap);
    expect(commandPanel!.x - (logPanel!.x + logPanel!.width)).toBeLessThanOrEqual(maxPanelGap);
  }
  expect(commandPanel!.x + commandPanel!.width).toBeLessThanOrEqual(viewport.width);
  expect(bottom).toBeLessThanOrEqual(viewport.height);
}

async function bottomDeckBox(page: Page) {
  const box = await page.locator('.battle-bottom-bar').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test('battle HUD keeps unit, log, and command panels in one aligned deck', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  await expect(page.locator('.selected-unit-card')).not.toHaveClass(/empty/);
  await expectBottomDeckAligned(page, 12);
  const selectedDesktopDeck = await bottomDeckBox(page);

  await page.setViewportSize({ width: 1005, height: 411 });
  await expectBottomDeckAligned(page, 12);
  const selectedShortDeck = await bottomDeckBox(page);

  expect(await page.evaluate(() => (window as any).__battleControl?.clearSelection?.())).toBe(true);
  await expect(page.locator('.selected-unit-card')).toHaveClass(/empty/);
  await expect.poll(async () => page.evaluate(
    () => (window as any).__battleControl?.selectionState?.().selectedUnitId ?? null
  )).toBeNull();
  await expectBottomDeckAligned(page, 12);
  const emptyShortDeck = await bottomDeckBox(page);
  expect(emptyShortDeck.y).toBeCloseTo(selectedShortDeck.y, 0);
  expect(emptyShortDeck.height).toBeCloseTo(selectedShortDeck.height, 0);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectBottomDeckAligned(page, 12);
  const emptyDesktopDeck = await bottomDeckBox(page);
  expect(emptyDesktopDeck.y).toBeCloseTo(selectedDesktopDeck.y, 0);
  expect(emptyDesktopDeck.height).toBeCloseTo(selectedDesktopDeck.height, 0);
});
