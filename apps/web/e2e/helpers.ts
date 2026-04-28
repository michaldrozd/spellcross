import { expect, type Page } from '@playwright/test';

export async function startFreshCampaign(page: Page, slot = 1) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate((nextSlot) => (window as any).__campaignControl.newCampaign(nextSlot), slot);
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible({ timeout: 10_000 });
}

export async function launchBattle(page: Page, territoryId = 'sector-paris') {
  const started = await page.evaluate((id) => (window as any).__campaignControl.startBattle(id), territoryId);
  expect(started).toBeTruthy();
  await expect(page.locator('.battle-screen')).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
}

export async function startBattle(page: Page, territoryId = 'sector-paris') {
  await startFreshCampaign(page);
  await launchBattle(page, territoryId);
}

export async function endStrategicTurns(page: Page, count = 1) {
  const ended = await page.evaluate((turns) => (window as any).__campaignControl.endTurn(turns), count);
  expect(ended).toBeTruthy();
}

export async function queueResearch(page: Page, topicId: string) {
  const queued = await page.evaluate((id) => (window as any).__campaignControl.startResearch(id), topicId);
  expect(queued).toBeTruthy();
}

export async function convertResearch(page: Page, amount = 3) {
  const converted = await page.evaluate((value) => (window as any).__campaignControl.convertResearch(value), amount);
  expect(converted).toBeTruthy();
}

export async function retreatToHq(page: Page) {
  const retreat = page.getByRole('button', { name: /^Retreat$/i });
  if (await retreat.isVisible({ timeout: 1500 }).catch(() => false)) {
    await retreat.click();
  }
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible({ timeout: 10_000 });
}
