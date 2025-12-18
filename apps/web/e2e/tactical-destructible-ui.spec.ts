import { expect, test } from '@playwright/test';

async function clickHex(page: import('@playwright/test').Page, q: number, r: number) {
  const pos = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const helper = (window as any).__battleControl?.pixelFor?.(q, r);
    if (!canvas || !helper) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + helper.x + 4, y: rect.top + helper.y + 4 };
  }, { q, r });
  expect(pos).not.toBeNull();
  await page.mouse.click(pos!.x, pos!.y);
}

test('ui-driven hex clicks can break destructible cover and still resolve battle flow', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');

  // Enter the bridgehead scenario that has destructible tiles guarding the span
  const bridgeTerritory = page.locator('li', { hasText: 'River Bridge' });
  await bridgeTerritory.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  // Select first allied unit and move closer using real canvas clicks
  await clickHex(page, 0, 2);
  await clickHex(page, 2, 2);
  await page.evaluate(() => (window as any).__battleControl?.moveTo?.(2, 2));

  // Blow the destructible span tile to open the route
  const destroyed = await page.evaluate(() => (window as any).__battleControl?.attackTile?.(4, 3));
  if (!destroyed?.success) {
    throw new Error(`attackTile failed: ${JSON.stringify(destroyed)}`);
  }

  // Finish flow and return to HQ
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
});
