import { expect, test } from '@playwright/test';
import { convertResearch, endStrategicTurns, launchBattle, queueResearch, retreatToHq, startFreshCampaign } from './helpers';

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
  await startFreshCampaign(page);

  await convertResearch(page);
  await queueResearch(page, 'optics-ii');

  const turnStart = await getTurn(page);
  await endStrategicTurns(page);
  await page.getByRole('button', { name: /Research/i }).click();
  await expect(page.locator('.research-card').filter({ hasText: 'Optics II' })).toContainText(/DONE|COMPLETED/);
  await page.getByRole('button', { name: /Territories/i }).click();

  await launchBattle(page, 'sector-munich');
  await expect(page.getByRole('heading', { name: /Outpost Night/i })).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();

  await retreatToHq(page);
  const popupButton = page.getByRole('button', { name: /Dismiss briefings/i });
  if (await popupButton.isVisible()) {
    await popupButton.click();
  }

  const turnAfterBattle = await getTurn(page);
  expect(turnAfterBattle).toBeGreaterThanOrEqual(turnStart);
  await page.reload();
  await page.getByRole('button', { name: /CONTINUE/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  expect(await getTurn(page)).toBe(turnAfterBattle);

  await startFreshCampaign(page, 2);
  await expect(page.getByText(/TURN 1/i)).toBeVisible();
});
