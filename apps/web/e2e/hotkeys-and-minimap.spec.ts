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

test('battlefield help explains advanced rules and remains keyboard-scrollable', async ({ page }) => {
  test.setTimeout(60_000);
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await startBattle(page, 'sector-sable-causeway');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect(page.getByRole('button', { name: /^Start Battle$/i })).toBeHidden();

  const expectedHelp = {
    en: [
      'Click a unit to select it',
      'Click a highlighted tile to move',
      'Click an enemy to attack it',
      'Overwatch holds fire until an enemy moves',
      'Start Battle ends deployment',
      'End Turn, or Auto Turn to let the AI play',
      'PIN -N is morale lost; low morale can suppress or route a unit.',
      'Deploying or packing radar spends the rest of its turn; deployed radar sees farther but cannot move.',
      'Arrow keys — Pan camera',
      'Mouse wheel — Zoom',
      'Tab — Toggle minimap when help is closed',
      'H / F1 / ? — Toggle help',
    ],
    sk: [
      'Kliknutím na jednotku ju vyberiete',
      'Kliknutím na zvýraznené políčko sa presuniete',
      'Kliknutím na nepriateľa naň zaútočíte',
      'Pohotovostná paľba čaká, kým sa nepriateľ nepohne',
      'Začiatok bitky ukončí rozmiestňovanie',
      'Ukončiť ťah, alebo Automatický ťah necháte hrať AI',
      'TLAK -N je strata morálky; nízka morálka jednotku potlačí alebo obráti na útek.',
      'Rozvinutie aj zbalenie radaru minie zvyšok ťahu; rozvinutý radar vidí ďalej, ale nemôže sa hýbať.',
      'Šípky — Posun kamery',
      'Koliesko myši — Priblíženie',
      'Tab — Prepnúť minimapu, keď je pomocník zatvorený',
      'H / F1 / ? — Prepnúť pomocníka',
    ],
  } as const;
  const cases = [
    { language: 'en', viewport: { width: 390, height: 844 } },
    { language: 'en', viewport: { width: 568, height: 320 } },
    { language: 'en', viewport: { width: 844, height: 390 } },
    { language: 'en', viewport: { width: 1280, height: 720 } },
    { language: 'sk', viewport: { width: 390, height: 844 } },
    { language: 'sk', viewport: { width: 568, height: 320 } },
    { language: 'sk', viewport: { width: 844, height: 390 } },
    { language: 'sk', viewport: { width: 1280, height: 720 } },
  ] as const;

  for (const helpCase of cases) {
    await page.setViewportSize(helpCase.viewport);
    await page.evaluate(async (language) => (window as any).__battleControl.setLanguage(language), helpCase.language);

    const toggle = page.getByTestId('keyboard-help-toggle');
    await toggle.click();
    const help = page.getByTestId('keyboard-help');
    await expect(help).toBeVisible();
    expect((await help.locator('li').allTextContents()).map((line) => line.trim())).toEqual(expectedHelp[helpCase.language]);

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="keyboard-help"]')!;
      const toggle = document.querySelector<HTMLElement>('[data-testid="keyboard-help-toggle"]')!;
      const panelBounds = panel.getBoundingClientRect();
      const toggleBounds = toggle.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        panel: {
          x: panelBounds.x,
          y: panelBounds.y,
          right: panelBounds.right,
          bottom: panelBounds.bottom,
          clientWidth: panel.clientWidth,
          scrollWidth: panel.scrollWidth,
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
          fontSize: Number.parseFloat(getComputedStyle(panel).fontSize),
        },
        toggleIntersects: !(
          toggleBounds.right <= panelBounds.left
          || toggleBounds.left >= panelBounds.right
          || toggleBounds.bottom <= panelBounds.top
          || toggleBounds.top >= panelBounds.bottom
        ),
      };
    });
    expect(geometry.documentWidth).toBe(helpCase.viewport.width);
    expect(geometry.panel.scrollWidth).toBeLessThanOrEqual(geometry.panel.clientWidth);
    expect(geometry.panel.x).toBeGreaterThan(0);
    expect(geometry.panel.y).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(helpCase.viewport.width);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(helpCase.viewport.height);
    expect(geometry.toggleIntersects).toBe(false);

    if (helpCase.viewport.width === 568) {
      expect(geometry.panel.clientHeight).toBeGreaterThanOrEqual(240);
      expect(geometry.panel.fontSize).toBeGreaterThanOrEqual(11.5);
      await toggle.focus();
      await page.keyboard.press('Tab');
      await expect(help).toBeFocused();
      const scrollBefore = await help.evaluate((panel) => panel.scrollTop);
      await page.keyboard.press('PageDown');
      await expect.poll(() => help.evaluate((panel) => panel.scrollTop)).toBeGreaterThan(scrollBefore);
      await page.keyboard.press('End');
      await expect.poll(() => help.evaluate((panel) => panel.scrollTop)).toBe(
        geometry.panel.scrollHeight - geometry.panel.clientHeight
      );
      const finalLineVisible = await help.evaluate((panel) => {
        const lines = panel.querySelectorAll('li');
        const finalLine = lines.item(lines.length - 1).getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        return finalLine.top >= bounds.top && finalLine.bottom <= bounds.bottom;
      });
      expect(finalLineVisible).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect(toggle).toBeFocused();
    }

    await toggle.click();
    await expect(help).toBeHidden();
  }

  expect(browserErrors).toEqual([]);
});
