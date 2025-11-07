import { test, expect } from '@playwright/test';

// Loads the large "mega" scenario and verifies basic rendering + metadata
// This is a quick smoke test to ensure the big map initializes without errors.

test('Mega map smoke: renders and exposes map metrics', async ({ page }) => {
  await page.goto('/?preset=mega');

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();

  const metrics = page.locator('[data-testid="map-metrics"]');
  await expect(metrics).toHaveAttribute('data-map-width', /\d+/);
  await expect(metrics).toHaveAttribute('data-map-height', /\d+/);

  const w = parseInt((await metrics.getAttribute('data-map-width')) || '0', 10);
  const h = parseInt((await metrics.getAttribute('data-map-height')) || '0', 10);
  expect(w).toBeGreaterThanOrEqual(100);
  expect(h).toBeGreaterThanOrEqual(60);

  // Quick minimap interaction to ensure no pointer errors
  await page.keyboard.press('Tab');
  const mm = page.getByTestId('minimap');
  await expect(mm).toBeVisible();
  const box = await mm.boundingBox();
  if (!box) throw new Error('Minimap bounding box not found');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
});

