import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

test('army recruit queue shows incoming units with readiness turn', async ({ page }) => {
  await startFreshCampaign(page);

  await page.getByRole('button', { name: /ARMY/i }).click();
  const recruitment = page.locator('.recruit-options');
  await expect(recruitment.getByRole('button', { name: /Captain Adam Halden/i })).toBeDisabled();
  await recruitment.getByRole('button', { name: /Light Infantry/i }).click();

  await expect(page.getByRole('heading', { name: 'IN TRANSIT' })).toBeVisible();
  await expect(page.locator('.reserve-row').filter({ hasText: /Light Infantry/i })).toContainText(/READY T\d+/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.locator('.menu-buttons .menu-btn').first().click();
  await page.locator('.hq-tabs .tab').nth(1).click();
  const recruitCards = page.locator('.recruit-btn');
  await expect(recruitCards).toHaveCount(38);
  expect(await recruitCards.evaluateAll((cards) => cards.filter((card) => (
    (card as HTMLElement).scrollHeight > (card as HTMLElement).clientHeight + 1
  )).length)).toBe(0);
  const pageWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(pageWidths.viewport).toBe(390);
  expect(pageWidths.scroll).toBe(pageWidths.client);

  const layouts = [
    { language: 'en', width: 1440, height: 900 },
    { language: 'sk', width: 1440, height: 900 },
    { language: 'en', width: 390, height: 844 },
    { language: 'sk', width: 390, height: 844 },
  ] as const;

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await page.evaluate((language) => localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));
    await page.locator('.hq-tabs .tab').nth(1).click();

    const actionNames = await page.locator('.officer-recruit, .unit-actions select, .unit-actions button')
      .evaluateAll((controls) => controls.map((control) => {
        const owner = control.closest('.officer-card')?.querySelector('.officer-identity strong')
          ?? control.closest('.unit-row')?.querySelector('.unit-name');
        return {
          label: control.getAttribute('aria-label') ?? '',
          owner: owner?.textContent?.trim() ?? '',
        };
      }));

    expect(actionNames.length, `${layout.language} ${layout.width}px action count`).toBeGreaterThan(0);
    expect(
      actionNames.filter(({ label, owner }) => !label || !owner || !label.includes(owner)),
      `${layout.language} ${layout.width}px contextual action names`
    ).toEqual([]);
    expect(
      new Set(actionNames.map(({ label }) => label)).size,
      `${layout.language} ${layout.width}px unique action names`
    ).toBe(actionNames.length);

    const protrudingPortraits = await page.locator('.recruit-btn').evaluateAll((buttons) => (
      buttons.flatMap((button) => {
        const portrait = button.querySelector<HTMLElement>('.recruit-portrait');
        if (!portrait) return [];
        const buttonBox = button.getBoundingClientRect();
        const portraitBox = portrait.getBoundingClientRect();
        const protrudes = portraitBox.left < buttonBox.left - 0.5
          || portraitBox.top < buttonBox.top - 0.5
          || portraitBox.right > buttonBox.right + 0.5
          || portraitBox.bottom > buttonBox.bottom + 0.5;
        return protrudes ? [{
          unit: button.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          button: { top: buttonBox.top, bottom: buttonBox.bottom },
          portrait: { top: portraitBox.top, bottom: portraitBox.bottom }
        }] : [];
      })
    ));
    await page.screenshot({
      path: test.info().outputPath(`recruit-${layout.language}-${layout.width}x${layout.height}.png`)
    });
    expect(protrudingPortraits, `${layout.language} ${layout.width}px portrait containment`).toEqual([]);

    await page.evaluate(() => (window as any).__campaignControl.setMoney(0));
    const disabledOfficerActions = page.locator('.officer-recruit:disabled');
    await expect(disabledOfficerActions.first()).toBeVisible();
    const unaffordableNames = await disabledOfficerActions.evaluateAll((buttons) => buttons.map((button) => ({
      label: button.getAttribute('aria-label') ?? '',
      officer: button.closest('.officer-card')?.querySelector('.officer-identity strong')?.textContent?.trim() ?? '',
    })));
    expect(
      unaffordableNames.filter(({ label, officer }) => !label || !officer || !label.includes(officer)),
      `${layout.language} ${layout.width}px unaffordable officer names`
    ).toEqual([]);
    expect(
      new Set(unaffordableNames.map(({ label }) => label)).size,
      `${layout.language} ${layout.width}px unique unaffordable officer names`
    ).toBe(unaffordableNames.length);
  }
});
