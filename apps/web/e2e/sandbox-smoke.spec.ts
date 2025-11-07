import { test, expect } from '@playwright/test';

// Basic smoke test that the sandbox renders and key UI elements are present

test('renders sandbox and canvas', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  await expect(page.getByRole('heading', { name: /spellcross tactical sandbox/i })).toBeVisible();
  const canvasCount = await page.locator('canvas').count();
  expect(canvasCount).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: /selected unit/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /combat log/i })).toBeVisible();
});

test('view toggle exists and can switch modes', async ({ page }) => {
  await page.goto('/?width=60&height=40');
  const btn = page.getByRole('button', { name: /view:/i });
  await expect(btn).toBeVisible();
  const before = await btn.textContent();
  await btn.click();
  const after = await btn.textContent();
  expect(before).not.toEqual(after);
});

