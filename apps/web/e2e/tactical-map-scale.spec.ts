import { expect, test, type Page } from '@playwright/test';

async function waitForPresentedBattle(page: Page, territoryId: string) {
  await expect.poll(async () => page.locator('[data-testid="map-metrics"]').evaluate((metrics) => ({
    battleId: metrics.getAttribute('data-battle-id'),
    presentedBattleId: metrics.getAttribute('data-presented-battle-id'),
    width: Number(metrics.getAttribute('data-map-width')),
    height: Number(metrics.getAttribute('data-map-height'))
  }))).toMatchObject({
    battleId: territoryId,
    presentedBattleId: territoryId
  });
  const canvas = page.locator('.battle-map-layer canvas');
  await expect(canvas).toBeVisible();
  const canvasSize = await canvas.evaluate((element) => ({
    width: element.width,
    height: element.height
  }));
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);
}

test('scaled convoy battlefields present and persist in all three save slots', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
    if (message.type() === 'warning' && message.text().includes('Failed to persist campaign')) {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  const slotPayloads: Array<{ slot: number; length: number }> = [];
  for (const slot of [1, 2, 3]) {
    expect(await page.evaluate((nextSlot) => (
      (window as any).__campaignControl.newCampaign(nextSlot, 'veteran')
    ), slot)).toBe(true);
    expect(await page.evaluate(() => (
      (window as any).__campaignControl.startBattleForValidation('sector-paris')
    ))).toBe(true);
    await waitForPresentedBattle(page, 'sector-paris');

    expect(await page.evaluate(() => (
      (window as any).__campaignControl.startBattleForValidation('sector-ash-compass')
    ))).toBe(true);
    await waitForPresentedBattle(page, 'sector-ash-compass');
    const metrics = await page.locator('[data-testid="map-metrics"]').evaluate((element) => ({
      width: Number(element.getAttribute('data-map-width')),
      height: Number(element.getAttribute('data-map-height'))
    }));
    expect(metrics).toEqual({ width: 50, height: 64 });

    const length = await page.evaluate((savedSlot) => (
      window.localStorage.getItem(`spellcross:campaign-state:${savedSlot}`)?.length ?? 0
    ), slot);
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThanOrEqual(1_734_351);
    slotPayloads.push({ slot, length });
  }

  const storedSlots = await page.evaluate(() => [1, 2, 3].map((slot) => ({
    slot,
    present: Boolean(window.localStorage.getItem(`spellcross:campaign-state:${slot}`))
  })));
  expect(storedSlots).toEqual([
    { slot: 1, present: true },
    { slot: 2, present: true },
    { slot: 3, present: true }
  ]);
  expect(slotPayloads.reduce((sum, slot) => sum + slot.length, 0)).toBeLessThan(5_241_856);
  expect(new Set(slotPayloads.map((slot) => slot.length)).size).toBe(1);
  expect(runtimeErrors).toEqual([]);
});
