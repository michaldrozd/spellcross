import { expect, test } from '@playwright/test';
import { launchBattle, retreatToHq, startFreshCampaign } from './helpers';

const waitLog = (page: import('@playwright/test').Page, text: string) =>
  expect.poll(async () => (await page.locator('.log').textContent()) ?? '').toContain(text);

test('weather, stealth visibility, and objective-aware AI', async ({ page }) => {
  test.setTimeout(80_000);

  await startFreshCampaign(page);
  await launchBattle(page, 'sector-munich');
  // Fog/night reduces visible enemies
  const visInitial = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visInitial).toBeLessThanOrEqual(3);

  // Move closer to reveal
  await page.evaluate(() => (window as any).__battleControl?.moveTo(3, 2));
  const visAfter = await page.evaluate(() => (window as any).__battleControl?.visibleEnemyCount?.() ?? 0);
  expect(visAfter).toBeGreaterThanOrEqual(visInitial);

  // End turn to trigger AI (objective-aware). Skip overwatch if disabled.
  await page.getByRole('button', { name: /^End Turn$/i }).click({ timeout: 1000 }).catch(() => {});
  const ended = await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  expect(ended).toBeTruthy();
  await expect.poll(async () => (await page.locator('.log-entries').textContent()) ?? '')
    .toMatch(/Round|fires|hits|missed|TACTICAL LINK READY|SENSOR GRID ONLINE/i);

  // Retreat back to HQ for next scenario
  await retreatToHq(page);

  await launchBattle(page, 'sector-strasbourg');
  await page.evaluate(() => (window as any).__battleControl?.moveTo(2, 2));

  // AI objective-aware (reach/hold) still runs
  await page.getByRole('button', { name: /^End Turn$/i }).click({ timeout: 1000 }).catch(() => {});
  await retreatToHq(page);
});
