import { expect, test } from '@playwright/test';

test('campaign loop with research, battle resolution, and timed events', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');

  // Start fresh and queue research
  await page.getByRole('button', { name: /^Reset$/i }).click();
  const startResearchBtn = page.getByRole('button', { name: /^Start$/i }).first();
  await startResearchBtn.click();

  // Burn a few turns to advance research and the war clock
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
  }

  // Fight the hamlet defense, wipe enemies, and secure victory
  const hamletAttack = page.locator('li:has-text("Crossroads Hold") button:has-text("Attack")').first();
  await hamletAttack.click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  await page.evaluate(() => (window as any).__battleControl?.moveFirst?.());
  await page.evaluate(() => (window as any).__battleControl?.attackFirst?.());
  await page.evaluate(() => (window as any).__battleControl?.wipeEnemies?.());
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Push additional turns to trigger scripted events and reinforcements
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^End Turn$/i }).click();
  }

  await expect(page.locator('.log-panel')).toContainText(/Reinforcements|Strategic pool|Supply trucks|counterattack/i);
  await expect(page.getByText(/War clock/i)).toBeVisible();
});
