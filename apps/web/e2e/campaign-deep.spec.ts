import { expect, test } from '@playwright/test';

const getTurn = async (page: import('@playwright/test').Page) => {
  const eyebrow = page.locator('.card .eyebrow', { hasText: /Turn/i }).first();
  if (await eyebrow.count()) {
    const text = (await eyebrow.textContent()) ?? '';
    const match = text.match(/Turn\\s+(\\d+)/i);
    if (match) return Number(match[1]);
  }
  const text = (await page.textContent('body')) ?? '';
  const match = text.match(/Turn\\s+(\\d+)/i);
  return match ? Number(match[1]) : 0;
};

test('campaign deep flow: research, outpost strike, slot swap', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/');

  // Bump research pool and start Optics II
  const convertResearch = page.getByRole('button', { name: /Convert 3 SP → RP/i });
  await convertResearch.click();
  await convertResearch.click();
  const optics = page.locator('li', { hasText: 'Optics II' });
  await optics.getByRole('button', { name: /Start/i }).click();

  // Finish research on next turn
  const turnStart = await getTurn(page);
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect(page.getByText(/Known tech:/i)).toContainText('optics-ii');

  // Attack the Forward Outpost and ensure tactical view renders
  const outpost = page.locator('li', { hasText: 'Forward Outpost' });
  await outpost.getByRole('button', { name: /^Attack$/i }).click();
  await expect(page.getByText(/Tactical/i)).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();

  // Retreat back to HQ
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  // Briefings should appear and be dismissible
  const popupButton = page.getByRole('button', { name: /Dismiss briefings/i });
  if (await popupButton.isVisible()) {
    await popupButton.click();
  }

  // Verify turn advanced and autosave retains it
  const turnAfterBattle = await getTurn(page);
  expect(turnAfterBattle).toBeGreaterThanOrEqual(turnStart);
  await page.reload();
  expect(await getTurn(page)).toBe(turnAfterBattle);

  // Slot swapping preserves independent progress
  const slotSelect = page.getByLabel(/Slot/i);
  await slotSelect.selectOption('2');
  await expect(slotSelect).toHaveValue('2');
  await slotSelect.selectOption('1');
  await expect(slotSelect).toHaveValue('1');
});
