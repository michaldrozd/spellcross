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

async function openingFormationMetrics(page: Page) {
  return page.evaluate(() => {
    const camera = (window as any).__battleCamera;
    const allies = (window as any).__battleControl?.allyPositions?.() ?? [];
    if (!camera || allies.length === 0) return null;
    const positions = allies.map(({ q, r }: { q: number; r: number }) => camera.screenForCoord(q, r));
    return {
      centroid: positions.reduce(
        (center: { x: number; y: number }, position: { x: number; y: number }) => ({
          x: center.x + position.x / positions.length,
          y: center.y + position.y / positions.length
        }),
        { x: 0, y: 0 }
      ),
      left: Math.min(...positions.map(({ x }: { x: number }) => x)),
      right: Math.max(...positions.map(({ x }: { x: number }) => x)),
      top: Math.min(...positions.map(({ y }: { y: number }) => y)),
      bottom: Math.max(...positions.map(({ y }: { y: number }) => y)),
      documentWidth: document.documentElement.scrollWidth
    };
  });
}

async function expectOpeningFormationCentered(page: Page, width: number, height: number) {
  await expect.poll(async () => {
    const formation = await openingFormationMetrics(page);
    return formation ? Math.abs(formation.centroid.x - width / 2) : Number.POSITIVE_INFINITY;
  }).toBeLessThanOrEqual(1);
  const formation = await openingFormationMetrics(page);
  expect(formation).not.toBeNull();

  expect(Math.abs(formation!.centroid.y - height * 0.41)).toBeLessThanOrEqual(20);
  expect(formation!.left).toBeGreaterThanOrEqual(0);
  expect(formation!.right).toBeLessThanOrEqual(width);
  expect(formation!.top).toBeGreaterThanOrEqual(0);
  expect(formation!.bottom).toBeLessThanOrEqual(height);
  expect(formation!.documentWidth).toBe(width);
}

async function expectRangeLegendClearOfObjectives(page: Page) {
  const [objective, legend, deck] = await Promise.all([
    page.locator('.objective-hud').boundingBox(),
    page.locator('.battle-mode-badge').boundingBox(),
    page.locator('.battle-bottom-bar').boundingBox()
  ]);
  expect(objective).not.toBeNull();
  expect(legend).not.toBeNull();
  expect(deck).not.toBeNull();
  expect(legend!.y).toBeGreaterThanOrEqual(objective!.y + objective!.height);
  expect(legend!.y + legend!.height).toBeLessThanOrEqual(deck!.y);
}

test('battle HUD keeps unit, log, and command panels in one aligned deck', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startBattle(page);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await expectOpeningFormationCentered(page, viewport.width, viewport.height);
  }
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
  await expectOpeningFormationCentered(page, 390, 844);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectOpeningFormationCentered(page, 1920, 1080);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  await expect(page.locator('.selected-unit-card')).not.toHaveClass(/empty/);
  await expectBottomDeckAligned(page, 12);
  const selectedDesktopDeck = await bottomDeckBox(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.battle-controls > button').first().click();
  await expect(page.locator('.battle-mode-badge')).toBeVisible();
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  await page.locator('.battle-controls > button').first().click();

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
