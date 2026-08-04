import { expect, test, type Locator, type Page } from '@playwright/test';

const layouts = [
  { language: 'en', width: 1280, height: 720 },
  { language: 'sk', width: 390, height: 844 },
] as const;

async function expectStatic(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      transitionDuration: style.transitionDuration,
      animations: element.getAnimations().length,
    };
  })).toEqual({
    animationName: 'none',
    transitionDuration: '0s',
    animations: 0,
  });
}

test('reduced motion keeps strategic, deployment and outcome surfaces static', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await page.evaluate((language) => localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    await expectStatic(page, page.locator('.menu-btn').first());
    expect(await page.locator('.menu-backdrop').evaluate((element) => (
      getComputedStyle(element, '::before').animationName
    ))).toBe('none');

    await page.evaluate(() => (window as any).__campaignControl.newCampaign(3));
    await expectStatic(page, page.locator('.pulse-ring').first());

    expect(await page.evaluate(() => (window as any).__campaignControl.startBattle('sector-paris'))).toBe(true);
    await page.waitForFunction(() => Boolean((window as any).__battleControl));
    await expectStatic(page, page.locator('.deploy-banner'));

    await page.locator('.battle-controls button.primary-btn').click({ force: true });
    await page.evaluate(() => {
      const control = (window as any).__battleControl;
      control.replaceObjectives([]);
      control.killAllEnemies();
      control.resolveOutcome();
    });

    const outcome = page.locator('.battle-outcome-overlay');
    await expectStatic(page, outcome);
    await expectStatic(page, page.locator('.battle-outcome-card'));
    await expectStatic(page, page.locator('.battle-outcome-stamp'));
    await expect(outcome).toHaveCSS('opacity', '1');
    await expect(page.locator('.battle-outcome-card')).toHaveCSS('transform', 'none');
    await expect(page.locator('.battle-outcome-stamp')).toHaveCSS('transform', 'none');
  }
});
