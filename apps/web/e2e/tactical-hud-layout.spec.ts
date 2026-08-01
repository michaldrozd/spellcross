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

async function expectSelectedUnitVitalsVisible(page: Page) {
  const metrics = await page.evaluate(() => {
    const card = document.querySelector('.selected-unit-card')?.getBoundingClientRect();
    const monitor = document.querySelector('.unit-monitor')?.getBoundingClientRect();
    const stats = document.querySelector('.selected-unit-card .unit-stats')?.getBoundingClientRect();
    const status = document.querySelector('.selected-unit-card .unit-status')?.getBoundingClientRect();
    const armory = document.querySelector('.selected-unit-card .unit-armory')?.getBoundingClientRect();
    if (!card || !monitor || !stats || !status || !armory) return null;
    return {
      card: { top: card.top, bottom: card.bottom },
      monitor: { top: monitor.top, bottom: monitor.bottom, width: monitor.width },
      stats: { top: stats.top, bottom: stats.bottom },
      status: { top: status.top, bottom: status.bottom },
      armory: { top: armory.top, bottom: armory.bottom }
    };
  });

  expect(metrics).not.toBeNull();
  for (const panel of [metrics!.monitor, metrics!.stats, metrics!.status, metrics!.armory]) {
    expect(panel.top).toBeGreaterThanOrEqual(metrics!.card.top);
    expect(panel.bottom).toBeLessThanOrEqual(metrics!.card.bottom);
  }
  expect(metrics!.monitor.width).toBeLessThan(120);
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
  const [objective, legend, deck, deckContentTop] = await Promise.all([
    page.locator('.objective-hud').boundingBox(),
    page.locator('.battle-mode-badge').boundingBox(),
    page.locator('.battle-bottom-bar').boundingBox(),
    page.evaluate(() => {
      const deck = document.querySelector('.battle-bottom-bar');
      if (!deck) return null;
      const visiblePanels = Array.from(deck.children).filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none' && box.width > 0 && box.height > 0;
      });
      return visiblePanels.length > 0
        ? Math.min(...visiblePanels.map((element) => element.getBoundingClientRect().top))
        : null;
    })
  ]);
  expect(objective).not.toBeNull();
  expect(legend).not.toBeNull();
  expect(deck).not.toBeNull();
  expect(deckContentTop).not.toBeNull();
  const overlapWidth = Math.max(
    0,
    Math.min(objective!.x + objective!.width, legend!.x + legend!.width) - Math.max(objective!.x, legend!.x)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(objective!.y + objective!.height, legend!.y + legend!.height) - Math.max(objective!.y, legend!.y)
  );
  expect(overlapWidth * overlapHeight).toBe(0);
  expect(objective!.y + objective!.height).toBeLessThanOrEqual(deck!.y);
  expect(legend!.y + legend!.height).toBeLessThanOrEqual(deckContentTop!);
}

async function expectCompactRangeLegend(page: Page) {
  const metrics = await page.evaluate(() => {
    const badge = document.querySelector('.battle-mode-badge');
    if (!badge) return null;
    const text = [
      badge.querySelector(':scope > span'),
      badge.querySelector(':scope > strong'),
      ...badge.querySelectorAll('.range-overlay-key > span')
    ].filter((node): node is Element => Boolean(node));
    const swatches = Array.from(badge.querySelectorAll('.range-overlay-key i'));
    const badgeBox = badge.getBoundingClientRect();
    return {
      width: badgeBox.width,
      text: text.map((node) => {
        const box = node.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
      swatches: swatches.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          radius: getComputedStyle(node).borderRadius
        };
      })
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.width).toBeLessThan(60);
  expect(metrics!.text).toHaveLength(4);
  for (const label of metrics!.text) {
    expect(label.width).toBeLessThanOrEqual(1);
    expect(label.height).toBeLessThanOrEqual(1);
  }
  expect(metrics!.swatches).toHaveLength(2);
  for (const swatch of metrics!.swatches) {
    expect(swatch.width).toBeGreaterThanOrEqual(8);
    expect(swatch.height).toBeGreaterThanOrEqual(8);
  }
  expect(metrics!.swatches[0].radius).not.toBe(metrics!.swatches[1].radius);
}

async function openTargetPanel(page: Page) {
  const combatants = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const ally = control?.allyUnits?.().find((unit: any) => unit.stance !== 'destroyed' && !unit.embarkedOn);
    const enemy = control?.enemyUnits?.().find((unit: any) => unit.stance !== 'destroyed');
    if (!ally || !enemy) return null;
    control.forceAllianceTurn();
    control.selectUnit(ally.id);
    return { enemyId: enemy.id };
  });
  expect(combatants).not.toBeNull();
  expect(await page.evaluate(
    (enemyId) => (window as any).__battleControl.targetEnemy(enemyId),
    combatants!.enemyId
  )).toBe(true);
  await expect(page.locator('.unit-card.target-card')).toBeVisible();
}

async function expectTargetDeckContained(
  page: Page,
  visibility: { selected: boolean; log: boolean }
) {
  const deck = page.locator('.battle-bottom-bar');
  const selected = page.locator('.selected-unit-card');
  const target = page.locator('.unit-card.target-card');
  const log = page.locator('.battle-log-panel');
  const controls = page.locator('.battle-controls');

  await expect(selected)[visibility.selected ? 'toBeVisible' : 'toBeHidden']();
  await expect(log)[visibility.log ? 'toBeVisible' : 'toBeHidden']();
  await expect(target).toBeVisible();
  await expect(controls).toBeVisible();

  const deckBox = await deck.boundingBox();
  expect(deckBox).not.toBeNull();
  const visiblePanels = [target, controls];
  if (visibility.selected) visiblePanels.push(selected);
  if (visibility.log) visiblePanels.push(log);
  for (const panel of visiblePanels) {
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(deckBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(deckBox!.x + deckBox!.width);
    expect(box!.y).toBeGreaterThanOrEqual(deckBox!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(deckBox!.y + deckBox!.height);
  }

  const targetActions = await page.locator('.unit-card.target-card .target-actions').boundingBox();
  const targetBox = await target.boundingBox();
  expect(targetActions).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(targetActions!.x).toBeGreaterThanOrEqual(targetBox!.x);
  expect(targetActions!.x + targetActions!.width).toBeLessThanOrEqual(targetBox!.x + targetBox!.width);
  expect(targetActions!.y + targetActions!.height).toBeLessThanOrEqual(targetBox!.y + targetBox!.height);
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

  await page.setViewportSize({ width: 600, height: 375 });
  expect(await page.evaluate(() => (window as any).__battleControl.replaceObjectives([
    { id: 'layout-eliminate', kind: 'eliminate', description: 'Eliminate every hostile unit.' },
    { id: 'layout-reinforcements', kind: 'eliminate', description: 'Stop the hostile reinforcements.' },
    { id: 'layout-perimeter', kind: 'eliminate', description: 'Secure the tactical perimeter.' }
  ]))).toBe(true);
  await expect(page.locator('.objective-hud li')).toHaveCount(3);
  await expect(page.locator('.battle-controls > button').first()).toHaveAttribute('aria-pressed', 'true');
  await expectCompactRangeLegend(page);
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
  await expectCompactRangeLegend(page);
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');

  await page.setViewportSize({ width: 667, height: 375 });
  await expectCompactRangeLegend(page);
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
  await expectCompactRangeLegend(page);
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  await page.locator('.battle-controls > button').first().click();

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 800, height: 600 }
  ]) {
    await page.setViewportSize(viewport);
    await expectBottomDeckAligned(page, 12);
    await expectSelectedUnitVitalsVisible(page);
    expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
    await expectSelectedUnitVitalsVisible(page);
    expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  }

  await page.setViewportSize({ width: 700, height: 450 });
  await expect(page.locator('.battle-log-panel')).toBeHidden();
  await expectSelectedUnitVitalsVisible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(700);
  await page.locator('.battle-controls > button').first().click();
  await expect(page.locator('.battle-mode-badge')).toBeVisible();
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
  await expectSelectedUnitVitalsVisible(page);
  await expectRangeLegendClearOfObjectives(page);
  expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  await page.locator('.battle-controls > button').first().click();

  await openTargetPanel(page);
  for (const layout of [
    { width: 601, height: 844, selected: false, log: false },
    { width: 667, height: 375, selected: false, log: false },
    { width: 700, height: 450, selected: false, log: false },
    { width: 736, height: 414, selected: true, log: false },
    { width: 759, height: 390, selected: true, log: false },
    { width: 760, height: 390, selected: true, log: false },
    { width: 844, height: 390, selected: true, log: false },
    { width: 900, height: 600, selected: true, log: false },
    { width: 901, height: 600, selected: true, log: false },
    { width: 1005, height: 411, selected: true, log: true },
    { width: 1280, height: 411, selected: true, log: true }
  ]) {
    await page.setViewportSize(layout);
    await expectTargetDeckContained(page, layout);
    expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('sk'))).toBe('sk');
    await expectTargetDeckContained(page, layout);
    expect(await page.evaluate(() => (window as any).__battleControl.setLanguage('en'))).toBe('en');
  }
  await page.locator('.unit-card.target-card .target-actions button').last().click();
  await expect(page.locator('.unit-card.target-card')).toBeHidden();

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
