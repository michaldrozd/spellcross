import { expect, test, type Page } from '@playwright/test';

import { startBattle } from './helpers';

async function capturePhaseNotices(page: Page) {
  await page.evaluate(() => {
    const qaWindow = window as any;
    qaWindow.__reinforcementPhaseNoticeObserver?.disconnect();
    qaWindow.__reinforcementPhaseNoticeTexts = [];
    const recordNotice = () => {
      const text = document.querySelector('.battle-phase-notice')?.textContent?.trim();
      if (text && !qaWindow.__reinforcementPhaseNoticeTexts.includes(text)) {
        qaWindow.__reinforcementPhaseNoticeTexts.push(text);
      }
    };
    qaWindow.__reinforcementPhaseNoticeObserver = new MutationObserver(recordNotice);
    qaWindow.__reinforcementPhaseNoticeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
}

async function expectCapturedPhaseNotice(page: Page, pattern: RegExp) {
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__reinforcementPhaseNoticeTexts as string[]
  ))).toEqual(expect.arrayContaining([
    expect.stringMatching(pattern)
  ]));
}

test('Commander reserve wave arrives after the first enemy force is cleared', async ({ page }) => {
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.revealAll?.());
  await capturePhaseNotices(page);

  const initialEnemyCount = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.().length ?? 0);
  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();

  await expectCapturedPhaseNotice(page, /Pursuit Force Detected/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl?.enemyUnits?.().length ?? 0)).toBe(initialEnemyCount + 2);
  await expect(page.locator('.log-line').filter({ hasText: /Reinforcements/i }).first()).toBeVisible();
});

test('Ash Crown encounter arrives as a second Rift phase', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-rift');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.revealAll?.());
  await capturePhaseNotices(page);

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expectCapturedPhaseNotice(page, /Portal Surge/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expectCapturedPhaseNotice(page, /Ash Crown Descends/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.().filter((unit: any) => unit.stance !== 'destroyed').length ?? 0
  ))).toBe(2);
});

test('Commander Berlin reserve fields the campaign winged fiend', async ({ page }) => {
  test.setTimeout(60_000);
  await startBattle(page, 'sector-berlin');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.revealAll?.());
  await capturePhaseNotices(page);

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expectCapturedPhaseNotice(page, /Portal Surge/i);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.enemyUnits?.()
      .some((unit: any) => unit.definitionId === 'winged-fiend' && unit.stance !== 'destroyed') ?? false
  ))).toBe(true);

  await page.evaluate(() => (window as any).__battleControl?.killAllEnemies?.());
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expectCapturedPhaseNotice(page, /Signal-Eater Answers/i);
});
