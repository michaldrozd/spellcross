import { test, expect } from '@playwright/test';

// Verify hotkeys (E to end turn) and minimap toggle (Tab)

test('End Turn hotkey (E) adds/updates round entry in Combat Log', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  await expect(page.getByRole('heading', { name: /combat log/i })).toBeVisible();

  await page.keyboard.press('E');

  // Wait for Combat Log to contain a Round … acting entry
  const logHeading = page.getByRole('heading', { name: /combat log/i });
  const logList = logHeading.locator('xpath=following-sibling::ul');
  await expect(logList).toContainText(/Round\s+\d+\s+\u2013\s+(alliance|otherSide)\s+acting/i);
});


test('Minimap toggles with Tab', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  const mm = page.locator('[data-testid="minimap"]');
  await expect(mm).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(mm).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(mm).toHaveCount(0);
});

// Minimap click pans camera (validated via hidden camera-metrics data attrs)
test('Minimap click pans camera', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  // ensure stage is mounted
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const metrics = page.locator('[data-testid="camera-metrics"]');
  await expect(metrics).toHaveCount(1);
  const beforeX = parseFloat((await metrics.getAttribute('data-center-x')) || '0');
  const beforeY = parseFloat((await metrics.getAttribute('data-center-y')) || '0');

  // show minimap
  await page.keyboard.press('Tab');

  // click near bottom-right of minimap inside the canvas
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');
  await page.mouse.click(box.x + 10 + 140, box.y + 10 + 100);

  // expect camera center to change
  await expect(async () => {
    const afterX = parseFloat((await metrics.getAttribute('data-center-x')) || '0');
    const afterY = parseFloat((await metrics.getAttribute('data-center-y')) || '0');
    expect(Math.hypot(afterX - beforeX, afterY - beforeY)).toBeGreaterThan(50);
  }).toPass();
});




// Keyboard help overlay toggles via button (fallback) and responds to F1
test('Keyboard help overlay toggles via button and F1', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  const help = page.locator('[data-testid="keyboard-help"]');
  const btn = page.locator('[data-testid="keyboard-help-toggle"]');
  await expect(help).toHaveCount(0);
  await btn.click();
  await expect(help).toHaveCount(1);
  await page.keyboard.press('F1');
  await expect(help).toHaveCount(0);
});
