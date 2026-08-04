import { expect, test } from '@playwright/test';

const layouts = [
  {
    language: 'en',
    slot: 1,
    width: 1280,
    height: 720,
    turn: /TURN 2/i,
    savedTurn: /Turn 2/i,
    warningTitle: 'Save incomplete',
    warningDetail: 'Your latest action is only in this tab.',
  },
  {
    language: 'sk',
    slot: 2,
    width: 390,
    height: 844,
    turn: /KOLO 2/i,
    savedTurn: /Kolo 2/i,
    warningTitle: 'Uloženie nie je úplné',
    warningDetail: 'Posledná akcia je iba v tejto karte.',
  },
] as const;

test('storage failures keep the campaign responsive and visibly unsaved until recovery', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await page.evaluate((language) => localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    await page.evaluate(({ slot }) => (window as any).__campaignControl.newCampaign(slot), layout);
    await expect(page.locator('.strategic-hq')).toBeVisible();

    await page.evaluate(() => {
      const storagePrototype = Object.getPrototypeOf(localStorage) as Storage;
      const originalSetItem = storagePrototype.setItem;
      (window as any).__restoreCampaignStorage = () => {
        storagePrototype.setItem = originalSetItem;
      };
      storagePrototype.setItem = function rejectCampaignWrites(key: string, nextValue: string) {
        if (key.startsWith('spellcross:campaign-')) {
          throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, nextValue);
      };
    });

    expect(await page.evaluate(() => (window as any).__campaignControl.endTurn())).toBe(true);
    await expect(page.locator('.strategic-hq')).toContainText(layout.turn);

    const warning = page.getByRole('alert');
    await expect(warning).toContainText(layout.warningTitle);
    await expect(warning).toContainText(layout.warningDetail);
    const warningBounds = await warning.boundingBox();
    expect(warningBounds).not.toBeNull();
    expect(warningBounds!.x).toBeGreaterThanOrEqual(0);
    expect(warningBounds!.x + warningBounds!.width).toBeLessThanOrEqual(layout.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(layout.width);

    expect(await page.evaluate(({ slot }) => ({
      state: JSON.parse(localStorage.getItem(`spellcross:campaign-state:${slot}`) ?? '{}').turn,
      summary: JSON.parse(localStorage.getItem(`spellcross:campaign-summary:${slot}`) ?? '{}').turn,
    }), layout)).toEqual({ state: 1, summary: 1 });

    await page.evaluate(() => (window as any).__restoreCampaignStorage());
    expect(await page.evaluate(() => (window as any).__campaignControl.setMoney(260))).toBe(true);
    await expect(warning).not.toBeVisible();
    expect(await page.evaluate(({ slot }) => ({
      state: JSON.parse(localStorage.getItem(`spellcross:campaign-state:${slot}`) ?? '{}').turn,
      summary: JSON.parse(localStorage.getItem(`spellcross:campaign-summary:${slot}`) ?? '{}').turn,
    }), layout)).toEqual({ state: 2, summary: 2 });

    await page.reload();
    await expect(page.locator('.menu-intel-panel')).toContainText(layout.savedTurn);
    await page.locator('.menu-btn-primary').click();
    await expect(page.locator('.strategic-hq')).toContainText(layout.turn);
  }

  expect(pageErrors).toEqual([]);
});
