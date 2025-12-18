import { expect, test } from '@playwright/test';

test('tactical pathing, obstacles, range, and fog visibility', async ({ page }) => {
  test.setTimeout(60_000);

  // Scenario 1: evac lane basic movement and blocked tiles
  await page.goto('/');
  await page.getByRole('button', { name: /^Attack$/i }).first().click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  const log = page.locator('.log');

  // Move to a reachable tile
  const moved = await page.evaluate(() => {
    const allies = (window as any).__battleControl?.allyUnits?.() ?? [];
    const inf = allies.find((u: any) => u.type === 'infantry') ?? allies[0];
    return (window as any).__battleControl?.moveUnitTo?.(inf.id, 2, 2);
  });
  expect(moved).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('unit:moved');

  // Attempt to move into impassable water (should fail)
  const blocked = await page.evaluate(() => (window as any).__battleControl?.moveTo(4, 3));
  expect(blocked).toBeFalsy();

  // Attack nearest enemy within range
  const attacked = await page.evaluate(() => (window as any).__battleControl?.attackFirst());
  expect(attacked).toBeTruthy();
  await expect.poll(async () => (await log.textContent()) ?? '').toContain('unit:attacked');

  // Scenario 2: fog/night visibility check
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await page.getByRole('button', { name: /^Attack$/i, exact: true }).nth(1).click(); // Forward Outpost
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  const initialVisible = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.());
  expect(initialVisible).toBeLessThan(3);

  const movedCloser = await page.evaluate(() => {
    const allies = (window as any).__battleControl?.allyUnits?.() ?? [];
    const inf = allies.find((u: any) => u.type === 'infantry') ?? allies[0];
    return (window as any).__battleControl?.moveUnitTo?.(inf.id, 3, 2);
  });
  expect(movedCloser).toBeTruthy();
  const afterVisible = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.());
  expect(afterVisible).toBeGreaterThanOrEqual(initialVisible);
});
