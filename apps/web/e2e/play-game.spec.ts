import { test, expect } from '@playwright/test';

// A simple "play the game" E2E: pan to a friendly unit, select it, and move one tile

test('Play: select and move via minimap + hotkeys', async ({ page }) => {
  // Use larger map to exercise camera/minimap; coordinates are based on sample-data.ts logic
  const MAP_W = 60; const MAP_H = 40;
  await page.goto(`/?width=${MAP_W}&height=${MAP_H}`);

  // Wait for canvas and metrics
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const metrics = page.locator('[data-testid="camera-metrics"]');
  await expect(metrics).toHaveCount(1);

  // Show minimap
  await page.keyboard.press('Tab');

  // Hex/axial helpers (mirror BattlefieldStage constants)
  const tileSize = 56;
  const hexWidth = tileSize;
  const hexHeight = tileSize * 0.866;
  const axialToPixel = (q: number, r: number) => ({ x: hexWidth * (q + 0.5 * r), y: hexHeight * (1.5 * r) });

  // Minimap placement and scaling
  const mmW = 160, mmH = 120;
  const stageW = MAP_W * hexWidth + hexWidth;
  const stageH = MAP_H * hexHeight + hexHeight;
  const sx = mmW / stageW; const sy = mmH / stageH;

  // Pan to the first allied unit (approx (3,3)) using the minimap
  const ally = { q: 3, r: 3 };
  const allyWorld = axialToPixel(ally.q, ally.r);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas box not found');
  // Minimap container sits at (10,10) inside the canvas
  await page.mouse.click(box.x + 10 + allyWorld.x * sx, box.y + 10 + allyWorld.y * sy);

  // Verify camera center moved near ally world position
  await expect(async () => {
    const cx = parseFloat((await metrics.getAttribute('data-center-x')) || '0');
    const cy = parseFloat((await metrics.getAttribute('data-center-y')) || '0');
    expect(Math.hypot(cx - allyWorld.x, cy - allyWorld.y)).toBeLessThan(20);
  }).toPass();

  // Select ally by clicking near screen center (camera centers on click target)
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.click(centerX, centerY);

  // Confirm Selected Unit shows a unit (definition id: light-infantry)
  await expect(page.getByText(/light-infantry/i)).toBeVisible();

  // Plan move to adjacent tile (4,3) and advance (hotkey A)
  const targetTile = { q: 4, r: 3 };
  const targetWorld = axialToPixel(targetTile.q, targetTile.r);
  const centerWorldX = parseFloat((await metrics.getAttribute('data-center-x')) || '0');
  const centerWorldY = parseFloat((await metrics.getAttribute('data-center-y')) || '0');
  await page.mouse.click(centerX + (targetWorld.x - centerWorldX), centerY + (targetWorld.y - centerWorldY));
  await page.keyboard.press('A');

  // Expect a movement entry in the Combat Log
  const logHeading = page.getByRole('heading', { name: /combat log/i });
  const logList = logHeading.locator('xpath=following-sibling::ul');
  await expect(logList).toContainText(/moved/i);
});

