import { expect, test } from '@playwright/test';

const getTurnNumber = async (page: import('@playwright/test').Page) => {
  const eyebrow = page.locator('.card .eyebrow').first();
  const text = (await eyebrow.textContent()) ?? '';
  const match = text.match(/Turn\\s+(\\d+)/i);
  return match ? Number(match[1]) : NaN;
};

test('research, battle entry, retreat, and autosave', async ({ page }) => {
  await page.goto('/');

  // Strategic UI sanity: headings and resources render
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Command Board/i })).toBeVisible();
  await expect(page.getByText(/Money/i)).toBeVisible();

  // Start a research topic
  const esprit = page.locator('li', { hasText: 'Esprit de Corps' });
  await esprit.getByRole('button', { name: /Start/i }).click();

  // End turn to progress and complete the research
  await page.getByRole('button', { name: /End Turn/i }).click();
  await expect(page.getByText(/Known tech:/i)).toContainText('esprit-de-corps');

  // Enter a battle from the first available territory
  await page.getByRole('button', { name: /^Attack$/ }).first().click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect(page.getByText(/Objectives/i)).toBeVisible();

  // Retreat back to strategic
  const retreatButton = page.getByRole('button', { name: /^Retreat$/ });
  await retreatButton.waitFor({ state: 'visible' });
  await retreatButton.click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();

  // Advance strategic turn and verify persistence across reload
  const turnBefore = await getTurnNumber(page);
  await page.getByRole('button', { name: /^End Turn$/ }).click();
  const turnAfter = await getTurnNumber(page);
  expect(turnAfter).toBe(turnBefore + 1);
  const turnBeforeReload = await getTurnNumber(page);
  await page.reload();
  const turnAfterReload = await getTurnNumber(page);
  expect(turnAfterReload).toBe(turnBeforeReload);
});
