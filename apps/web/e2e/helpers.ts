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

export async function clickBattleTile(page: Page, q: number, r: number) {
  await page.waitForFunction(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const tileCenter = (window as any).__battleCamera?.screenForCoord?.(q, r);
    if (!canvas || !tileCenter) return false;
    const rect = canvas.getBoundingClientRect();
    return tileCenter.x >= 0 && tileCenter.y >= 0 && tileCenter.x <= rect.width && tileCenter.y <= rect.height;
  }, { q, r });
  const position = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const tileCenter = (window as any).__battleCamera?.screenForCoord?.(q, r);
    if (!canvas || !tileCenter) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + tileCenter.x, y: rect.top + tileCenter.y };
  }, { q, r });
  expect(position).not.toBeNull();
  await page.mouse.click(position!.x, position!.y);
  await page.waitForTimeout(100);
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
