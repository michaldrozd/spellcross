import { expect, test } from '@playwright/test';

test('AI advances toward objectives and pressures after player ends turn', async ({ page }) => {
  test.setTimeout(80_000);
  await page.goto('/');
  await page.getByRole('button', { name: /^Reset$/i }).click();
  await page.locator('li', { hasText: 'Crossroads Hold' }).getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();

  // Record initial enemy positions
  const initial = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.() ?? []);
  const objective = { q: 3, r: 2 };

  // Exit deployment then let a few turn cycles run (player ends, AI responds)
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
    await page.waitForTimeout(200);
  }

  const after = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.() ?? []);
  expect(after.length).toBeGreaterThan(0);

  // Validate either movement toward the objective or logged action
  const movedCloser = after.some((unit) => {
    const before = initial.find((i: any) => i.id === unit.id);
    if (!before) return false;
    const distBefore = Math.max(Math.abs(before.coord.q - objective.q), Math.abs(before.coord.r - objective.r));
    const distAfter = Math.max(Math.abs(unit.coord.q - objective.q), Math.abs(unit.coord.r - objective.r));
    return distAfter < distBefore;
  });

  if (!movedCloser) {
    await expect(page.getByText(/attack|move/i)).toBeVisible();
  }
});
