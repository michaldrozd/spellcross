import { expect, test, type Page } from '@playwright/test';

type LifecycleLayout = {
  language: 'en' | 'sk';
  slot: number;
  viewport: { width: number; height: number };
};

const layouts: LifecycleLayout[] = [
  { language: 'en', slot: 2, viewport: { width: 1440, height: 900 } },
  { language: 'sk', slot: 3, viewport: { width: 390, height: 844 } }
];

async function captureState(page: Page, layout: LifecycleLayout, state: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), state)
    .toBeLessThanOrEqual(layout.viewport.width);
  await page.screenshot({
    path: test.info().outputPath(`${layout.language}-${layout.viewport.width}x${layout.viewport.height}-${state}.png`)
  });
}

async function waitForPresentation(locator: ReturnType<Page['locator']>) {
  await locator.evaluate(async (element) => {
    const finiteAnimations = element.getAnimations({ subtree: true }).filter((animation) => {
      const iterations = animation.effect?.getComputedTiming().iterations;
      return iterations !== Infinity;
    });
    await Promise.all(finiteAnimations.map((animation) => animation.finished));
  });
}

for (const layout of layouts) {
  test(`complete ${layout.language} player lifecycle stays clean at ${layout.viewport.width}x${layout.viewport.height}`, async ({ page }) => {
    test.setTimeout(60_000);
    const runtimeErrors: string[] = [];
    const missingTranslations: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
      if (message.type() === 'warning' && message.text().includes('Missing translation:')) {
        missingTranslations.push(message.text());
      }
    });
    page.on('requestfailed', (request) => failedRequests.push(request.url()));

    await page.setViewportSize(layout.viewport);
    await page.goto('/');
    await page.evaluate((language) => window.localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'NOT A SPELLCROSS' })).toBeVisible();
    expect(await page.getAttribute('html', 'lang')).toBe(layout.language);
    await captureState(page, layout, 'home');

    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    await page.evaluate((slot) => (window as any).__campaignControl.newCampaign(slot), layout.slot);
    await expect(page.locator('.strategic-hq')).toBeVisible();
    await captureState(page, layout, 'hq');

    await page.locator('.hq-tabs .tab').nth(2).click();
    await expect(page.locator('.research-card').first()).toBeVisible();
    await captureState(page, layout, 'research');

    await page.locator('.hq-tabs .tab').first().click();
    await page.locator('.territory-marker').first().click();
    await page.locator('.attack-btn-large').click();
    const planner = page.locator('.deployment-planner');
    await expect(planner).toBeVisible();
    await expect(planner).toHaveAttribute('role', 'dialog');
    await captureState(page, layout, 'deployment');

    await planner.locator('.deployment-confirm').click();
    await page.waitForFunction(() => Boolean((window as any).__battleControl));
    await expect(page.locator('.battle-screen')).toBeVisible();
    await captureState(page, layout, 'tactical-deployment');

    await page.locator('.battle-controls > .primary-btn').click();
    await expect(page.locator('.battle-controls')).not.toHaveClass(/deployment/);
    await captureState(page, layout, 'tactical-active');

    await page.evaluate(() => {
      const control = (window as any).__battleControl;
      control.replaceObjectives([]);
      control.killAllEnemies();
      control.resolveOutcome();
    });
    const outcome = page.getByRole('dialog');
    await expect(outcome).toBeVisible();
    await expect(outcome).toHaveAttribute('aria-modal', 'true');
    await waitForPresentation(outcome);
    await captureState(page, layout, 'debrief');

    await outcome.locator('.battle-outcome-continue').click();
    await expect(page.locator('.strategic-hq')).toBeVisible();
    await captureState(page, layout, 'returned-hq');

    await page.reload();
    await expect(page.locator('.main-menu')).toBeVisible();
    await expect(page.locator('.menu-intel-panel')).not.toContainText(/battle pending|bitka čaká/i);
    await captureState(page, layout, 'saved-home');
    await page.locator('.menu-buttons .menu-btn-primary').click();
    await expect(page.locator('.strategic-hq')).toBeVisible();

    expect(missingTranslations).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });
}
