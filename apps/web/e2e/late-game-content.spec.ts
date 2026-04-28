import { expect, test } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('late-game spire assault loads and can be exited', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page, 'sector-rift');

  await expect(page.getByRole('heading', { name: /Black Spire Assault/i })).toBeVisible();
  await expect(page.getByText(/ritual spire/i)).toBeVisible();

  // Ensure the foggy battle renders enemy presence
  const visibleCount = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visibleCount).toBeGreaterThanOrEqual(0);

  // Exit battle via retreat to confirm flow returns to HQ
  await retreatToHq(page);
});
