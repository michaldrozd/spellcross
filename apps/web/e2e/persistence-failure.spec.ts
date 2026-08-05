import { expect, test, type Page } from '@playwright/test';

const layouts = [
  {
    language: 'sk',
    slot: 2,
    width: 390,
    height: 844,
    warningTitle: 'Uloženie nie je úplné',
    warningDetail: 'Posledná akcia je iba v tejto karte.',
  },
  {
    language: 'en',
    slot: 1,
    width: 390,
    height: 844,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'sk',
    slot: 2,
    width: 320,
    height: 568,
    warningTitle: 'Uloženie nie je úplné',
    warningDetail: 'Posledná akcia je iba v tejto karte.',
  },
  {
    language: 'en',
    slot: 1,
    width: 360,
    height: 640,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'en',
    slot: 1,
    width: 601,
    height: 844,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'en',
    slot: 1,
    width: 640,
    height: 360,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'en',
    slot: 1,
    width: 568,
    height: 320,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'sk',
    slot: 3,
    width: 1280,
    height: 720,
    warningTitle: 'Uloženie nie je úplné',
    warningDetail: 'Posledná akcia je iba v tejto karte.',
  },
  {
    language: 'en',
    slot: 1,
    width: 1280,
    height: 720,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
] as const;

function turnLabel(language: string, turn: number) {
  return new RegExp(`${language === 'sk' ? 'KOLO' : 'TURN'} ${turn}`, 'i');
}

async function rejectCampaignWrites(page: Page) {
  await page.evaluate(() => {
    const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
    const originalSetItem = storagePrototype.setItem;
    (window as any).__restoreCampaignStorage = () => {
      storagePrototype.setItem = originalSetItem;
    };
    storagePrototype.setItem = function rejectCampaignWrite(key: string, nextValue: string) {
      if (key.startsWith('spellcross:campaign-')) {
        throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, nextValue);
    };
  });
}

async function restoreCampaignWrites(page: Page) {
  await page.evaluate(() => (window as any).__restoreCampaignStorage());
}

function overlapArea(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
  const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
  return width * height;
}

test('storage failures keep the campaign responsive and visibly unsaved until recovery', async ({ page }) => {
  test.setTimeout(300_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await page.evaluate((language) => localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    await page.evaluate(({ slot }) => (window as any).__campaignControl.newCampaign(slot), layout);
    await expect(page.locator('.strategic-hq')).toBeVisible();

    await rejectCampaignWrites(page);

    expect(await page.evaluate(() => (window as any).__campaignControl.endTurn())).toBe(true);
    await expect(page.locator('.strategic-hq')).toContainText(turnLabel(layout.language, 2));

    const warning = page.locator('.persistence-warning');
    await expect(warning).toContainText(layout.warningTitle);
    await expect(warning).toContainText(layout.warningDetail);
    await expect(warning).toHaveAttribute('role', 'alert');
    const warningBounds = await warning.boundingBox();
    expect(warningBounds).not.toBeNull();
    expect(warningBounds!.x).toBeGreaterThanOrEqual(0);
    expect(warningBounds!.y).toBeGreaterThanOrEqual(0);
    expect(warningBounds!.x + warningBounds!.width).toBeLessThanOrEqual(layout.width);
    expect(warningBounds!.y + warningBounds!.height).toBeLessThanOrEqual(layout.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);
    if (layout.width <= 700) {
      for (const selector of ['.hq-topbar', '.hq-tabs', '.map-theater-switch', '.map-status-strip']) {
        const protectedBounds = await page.locator(selector).boundingBox();
        expect(protectedBounds).not.toBeNull();
        expect(overlapArea(warningBounds!, protectedBounds!)).toBe(0);
      }
    }

    expect(await page.evaluate(({ slot }) => ({
      state: JSON.parse(localStorage.getItem(`spellcross:campaign-state:${slot}`) ?? '{}').turn,
      summary: JSON.parse(localStorage.getItem(`spellcross:campaign-summary:${slot}`) ?? '{}').turn,
    }), layout)).toEqual({ state: 1, summary: 1 });

    await page.locator('.end-turn-btn').click();
    await expect(page.locator('.strategic-hq')).toContainText(turnLabel(layout.language, 3));
    await expect(warning).toBeVisible();

    await restoreCampaignWrites(page);
    expect(await page.evaluate(() => (window as any).__campaignControl.setMoney(260))).toBe(true);
    await expect(warning).not.toBeVisible();
    expect(await page.evaluate(({ slot }) => ({
      state: JSON.parse(localStorage.getItem(`spellcross:campaign-state:${slot}`) ?? '{}').turn,
      summary: JSON.parse(localStorage.getItem(`spellcross:campaign-summary:${slot}`) ?? '{}').turn,
    }), layout)).toEqual({ state: 3, summary: 3 });

    await page.reload();
    await expect(page.locator('.menu-intel-panel')).toContainText(turnLabel(layout.language, 3));
    await page.locator('.menu-btn-primary').click();
    await expect(page.locator('.strategic-hq')).toContainText(turnLabel(layout.language, 3));

    await rejectCampaignWrites(page);
    expect(await page.evaluate(() => (window as any).__campaignControl.endTurn())).toBe(true);
    await expect(page.locator('.strategic-hq')).toContainText(turnLabel(layout.language, 4));
    await restoreCampaignWrites(page);
    await page.locator('.back-btn').click();
    await expect(page.locator('.main-menu')).toBeVisible();
    await expect(warning).toBeVisible();
    if (layout.width <= 700) {
      const menuWarningBounds = await warning.boundingBox();
      const languageBounds = await page.locator('.menu-lang-switch').boundingBox();
      const titleBounds = await page.locator('.menu-logo h1').boundingBox();
      expect(menuWarningBounds).not.toBeNull();
      expect(languageBounds).not.toBeNull();
      expect(titleBounds).not.toBeNull();
      expect(overlapArea(menuWarningBounds!, languageBounds!)).toBe(0);
      expect(overlapArea(titleBounds!, languageBounds!)).toBe(0);
    }
    await page.locator('.menu-btn-primary').click();
    await expect(page.locator('.strategic-hq')).toContainText(turnLabel(layout.language, 3));
    await expect(warning).not.toBeVisible();

    await rejectCampaignWrites(page);
    expect(await page.evaluate(() => (window as any).__campaignControl.startBattle())).toBe(true);
    await expect(page.locator('.battle-screen')).toBeVisible();
    await expect(warning).toBeVisible();
    await expect(page.locator('.battlefield-utility-controls')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.deploy-banner')).toBeVisible();
    const battleWarningBounds = await warning.boundingBox();
    expect(battleWarningBounds).not.toBeNull();
    expect(battleWarningBounds!.x).toBeGreaterThanOrEqual(0);
    expect(battleWarningBounds!.y).toBeGreaterThanOrEqual(0);
    expect(battleWarningBounds!.x + battleWarningBounds!.width).toBeLessThanOrEqual(layout.width);
    expect(battleWarningBounds!.y + battleWarningBounds!.height).toBeLessThanOrEqual(layout.height);
    for (const selector of ['.battlefield-utility-controls', '.battle-bottom-bar', '.deploy-banner']) {
      const protectedBounds = await page.locator(selector).boundingBox();
      expect(protectedBounds).not.toBeNull();
      expect(overlapArea(battleWarningBounds!, protectedBounds!)).toBe(0);
    }
    await restoreCampaignWrites(page);
    expect(await page.evaluate(() => (window as any).__campaignControl.setMoney(270))).toBe(true);
    await expect(warning).not.toBeVisible();
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('deleting the active save keeps its unresolved write warning visible', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('spellcross:lang', 'en'));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(3));
  await expect(page.locator('.strategic-hq')).toBeVisible();

  await rejectCampaignWrites(page);
  expect(await page.evaluate(() => (window as any).__campaignControl.endTurn())).toBe(true);
  const warning = page.locator('.persistence-warning');
  await expect(warning).toBeVisible();

  await restoreCampaignWrites(page);
  await page.locator('.back-btn').click();
  await page.locator('.menu-buttons > .menu-btn:not(.menu-btn-primary)').first().click();
  await expect(page.locator('.slot-modal')).toBeVisible();
  await page.locator('.slot-actions > .menu-btn-danger').click();
  await page.locator('.slot-delete-confirm .menu-btn-danger').click();
  await expect(warning).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('spellcross:campaign-state:3'))).toBeNull();

  expect(await page.evaluate(() => (window as any).__campaignControl.setMoney(270))).toBe(true);
  await expect(warning).not.toBeVisible();
});
