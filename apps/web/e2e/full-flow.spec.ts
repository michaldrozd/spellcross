import { expect, test } from '@playwright/test';
import { startFreshCampaign } from './helpers';

const getTurnNumber = async (page: import('@playwright/test').Page) => {
  const turnInfo = page.locator('.turn-info').first();
  const text = (await turnInfo.textContent()) ?? '';
  const match = text.match(/TURN\s+(\d+)/i);
  return match ? Number(match[1]) : NaN;
};

test('research, battle entry, retreat, and autosave', async ({ page }) => {
  test.setTimeout(60_000);
  await startFreshCampaign(page);

  // Strategic UI sanity: headings and resources render
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Territories/i })).toBeVisible();
  await expect(page.getByText(/Credits/i)).toBeVisible();

  // Start a research topic
  await page.getByRole('button', { name: /Research/i }).click();
  const esprit = page.locator('.research-card').filter({
    has: page.locator('h4', { hasText: /^Esprit de Corps$/ })
  });
  await esprit.getByRole('button', { name: /Queue Project/i }).click();
  await expect(esprit).toContainText(/ACTIVE|IN PROGRESS/);

  // End turn to progress and complete the research
  await page.getByRole('button', { name: /End Turn/i }).click();
  await page.getByRole('button', { name: /Research/i }).click();
  await expect(esprit).toContainText(/DONE|COMPLETED/);

  // Enter a battle from the first available territory
  await page.getByRole('button', { name: /Territories/i }).click();
  await page.getByText(/^Paris$/).click({ force: true });
  await page.getByRole('button', { name: /Launch Attack/i }).click();
  await expect(page.getByRole('button', { name: /^Start Battle$/i })).toBeVisible();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect(page.getByText(/Evacuation Run/i)).toBeVisible();

  // Retreat back to strategic
  const retreatButton = page.getByRole('button', { name: /^Retreat$/ });
  await retreatButton.waitFor({ state: 'visible' });
  await retreatButton.click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Advance strategic turn and verify persistence across reload
  const turnBefore = await getTurnNumber(page);
  await page.getByRole('button', { name: /End Turn/i }).click();
  const turnAfter = await getTurnNumber(page);
  expect(turnAfter).toBe(turnBefore + 1);
  const turnBeforeReload = await getTurnNumber(page);
  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  const turnAfterReload = await getTurnNumber(page);
  expect(turnAfterReload).toBe(turnBeforeReload);
});
