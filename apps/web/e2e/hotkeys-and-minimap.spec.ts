import { test, expect } from '@playwright/test';
import { retreatToHq, startBattle } from './helpers';

test('retreat flows back to strategic view', async ({ page }) => {
  await startBattle(page);
  await expect(page.locator('.battle-screen')).toBeVisible();
  const helpToggle = page.getByTestId('keyboard-help-toggle');
  const minimapToggle = page.getByTestId('minimap-toggle');
  await expect(helpToggle).toHaveAttribute('aria-expanded', 'false');
  await helpToggle.click();
  await expect(helpToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('keyboard-help')).toBeVisible();
  await helpToggle.click();
  await expect(page.getByTestId('keyboard-help')).toBeHidden();
  await expect(minimapToggle).toHaveAttribute('aria-pressed', 'false');
  await minimapToggle.click();
  await expect(minimapToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('minimap')).toBeVisible();
  await minimapToggle.click();
  await page.getByRole('button', { name: /^Retreat$/i }).click();
  const warning = page.getByRole('alertdialog', { name: /confirm tactical retreat/i });
  await expect(warning).toContainText('Units marked for loss: 0');
  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await expect(warning).toBeHidden();
  await retreatToHq(page);
});

test('mobile tactical HUD preserves most of the screen for the battlefield', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startBattle(page);

  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect(page.getByRole('button', { name: /^Start Battle$/i })).toBeHidden();

  const hud = await page.locator('.battle-bottom-bar').boundingBox();
  expect(hud).not.toBeNull();
  expect(hud!.height).toBeLessThanOrEqual(220);
  expect(hud!.y).toBeGreaterThanOrEqual(620);
  await expect(page.getByRole('button', { name: /^Retreat$/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  const [unitPanel, controls] = await Promise.all([
    page.locator('.selected-unit-card').boundingBox(),
    page.locator('.battle-controls').boundingBox()
  ]);
  expect(unitPanel).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(unitPanel!.x + unitPanel!.width).toBeLessThanOrEqual(controls!.x);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(390);
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(844);

  const helpToggle = page.getByTestId('keyboard-help-toggle');
  const minimapToggle = page.getByTestId('minimap-toggle');
  await expect(helpToggle).toHaveAccessibleName('Toggle help (H / F1 / ?)');
  await expect(minimapToggle).toHaveAccessibleName('Toggle minimap (Tab)');
  await minimapToggle.click();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(minimapToggle).toHaveAttribute('aria-pressed', 'true');
  await helpToggle.click();
  await expect(page.getByTestId('keyboard-help')).toBeVisible();
  await expect(helpToggle).toHaveAttribute('aria-expanded', 'true');

  const utilityHitTargets = await page.evaluate(() => (
    ['minimap-toggle', 'keyboard-help-toggle'].map((testId) => {
      const control = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      const bounds = control.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return hit === control || Boolean(hit?.closest(`[data-testid="${testId}"]`));
    })
  ));
  expect(utilityHitTargets).toEqual([true, true]);
  await helpToggle.click();
  await minimapToggle.click();

  const mobileReadout = await page.evaluate(() => {
    const fontSize = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? Number.parseFloat(getComputedStyle(element).fontSize) : 0;
    };
    return {
      readout: fontSize('.unit-readout'),
      unitName: fontSize('.unit-readout strong'),
      stats: fontSize('.unit-card .unit-stats'),
      armory: fontSize('.unit-armory'),
      buttons: Array.from(document.querySelectorAll<HTMLButtonElement>('.battle-controls button')).map((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          height: bounds.height,
          fontSize: Number.parseFloat(getComputedStyle(button).fontSize)
        };
      })
    };
  });

  expect(mobileReadout.readout).toBeGreaterThanOrEqual(8.5);
  expect(mobileReadout.unitName).toBeGreaterThanOrEqual(9.5);
  expect(mobileReadout.stats).toBeGreaterThanOrEqual(9.5);
  expect(mobileReadout.armory).toBeGreaterThanOrEqual(8.25);
  expect(mobileReadout.buttons.length).toBeGreaterThanOrEqual(5);
  for (const button of mobileReadout.buttons) {
    expect(button.height).toBeGreaterThanOrEqual(40);
    expect(button.fontSize).toBeGreaterThanOrEqual(9.25);
  }

  await page.evaluate(async () => (window as any).__battleControl.setLanguage('sk'));
  await expect(page.getByRole('button', { name: /Pohotovosť/i })).toBeVisible();
  await expect(helpToggle).toHaveAccessibleName('Prepnúť pomocníka (H / F1 / ?)');
  await expect(minimapToggle).toHaveAccessibleName('Prepnúť minimapu (Tab)');
  const clippedSlovakControls = await page.locator('.battle-controls button').evaluateAll((buttons) => (
    buttons
      .filter((button) => button.scrollWidth > button.clientWidth || button.scrollHeight > button.clientHeight)
      .map((button) => button.textContent?.trim())
  ));
  expect(clippedSlovakControls).toEqual([]);
});
