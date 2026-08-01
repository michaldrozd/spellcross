import { test, expect, type Page } from '@playwright/test';
import { startBattle } from './helpers';

async function expectCommandLabelsContained(page: Page, viewportWidth: number) {
  await expect.poll(async () => page.locator('.battle-controls button').evaluateAll((buttons) => (
    buttons.flatMap((button) => (
      button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight
        ? []
        : [button.textContent?.trim() ?? '']
    ))
  ))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewportWidth);
}

test('end turn button exists in tactical view', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await startBattle(page);
  const commandButton = page.getByRole('button', { name: /^Start Battle$/i });
  await expect(commandButton).toBeVisible();
  await commandButton.click();
  await expect(page.getByRole('button', { name: /^End Turn$/i })).toBeVisible();

  const viewports = [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1005, height: 411 },
    { width: 800, height: 600 },
    { width: 390, height: 844 }
  ];
  for (const language of ['en', 'sk'] as const) {
    expect(await page.evaluate(
      (nextLanguage) => (window as any).__battleControl.setLanguage(nextLanguage),
      language
    )).toBe(language);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectCommandLabelsContained(page, viewport.width);
    }
  }
});
