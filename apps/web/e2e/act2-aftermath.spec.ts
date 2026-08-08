import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFreshCampaign } from './helpers';

const AFTERMATH_IDS = [
  'sector-quiet-meridian',
  'sector-glass-wake',
  'sector-ash-compass',
  'sector-dawn-anchor'
] as const;

const localeKeys = (language: 'en' | 'sk', namespace: 'territories' | 'scenarios' | 'dossiers') => {
  const locale = JSON.parse(readFileSync(
    resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/${namespace}.json`),
    'utf8'
  )) as Record<string, unknown>;
  const prefix = namespace === 'scenarios' ? 'city-' : '';
  return AFTERMATH_IDS.map((id) => `${prefix}${id}`).filter((id) => locale[id] != null);
};

async function openDawnAnchor(page: Page, slot: number) {
  await startFreshCampaign(page, slot);
  await page.evaluate(({ nextSlot, dawnAnchorId }) => {
    const storageKey = `spellcross:campaign-state:${nextSlot}`;
    const snapshot = JSON.parse(window.localStorage.getItem(storageKey)!);
    snapshot.territories = snapshot.territories.map((territory: { id: string }) => ({
      ...territory,
      status: territory.id === dawnAnchorId
        ? 'available'
        : territory.id === 'sector-hollow-tide' ? 'bypassed' : 'cleared',
      remainingTimer: territory.id === dawnAnchorId ? territory.timer : undefined
    }));
    snapshot.operationResults = { 'sector-cinder-gate': 'victory' };
    snapshot.actTimeBonusesApplied = { '2': 11 };
    snapshot.outcome = undefined;
    snapshot.turn = 28;
    snapshot.lastOperationTurn = 27;
    snapshot.globalTimer = 4;
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, { nextSlot: slot, dawnAnchorId: 'sector-dawn-anchor' });
  await page.reload();
  await page.locator('.menu-buttons .menu-btn-primary').click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
}

test('aftermath operation copy has exact English and Slovak key parity', () => {
  for (const namespace of ['territories', 'scenarios', 'dossiers'] as const) {
    expect(localeKeys('en', namespace)).toEqual([...AFTERMATH_IDS].map((id) => (
      namespace === 'scenarios' ? `city-${id}` : id
    )));
    expect(localeKeys('sk', namespace)).toEqual(localeKeys('en', namespace));
  }
});

test('Dawn Anchor closes all 28 playable operations', async ({ page }) => {
  await openDawnAnchor(page, 1);
  await expect(page.locator('.territory-marker')).toHaveCount(12);
  await page.locator('.territory-marker').filter({ hasText: 'Dawn Anchor' }).click();
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.operation-dossier')).toContainText('CHAPTER 8 · Dawn Protocol');
  await expect(page.locator('.operation-dossier')).toContainText('Dawn Anchor');
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.evaluate(() => {
    (window as any).__battleControl.replaceObjectives([]);
    (window as any).__battleControl.killAllEnemies();
    (window as any).__battleControl.resolveOutcome();
  });
  await expect(page.locator('.battle-outcome-card')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Return to HQ/i }).click();

  await expect(page.getByRole('heading', { name: 'CAMPAIGN WON', exact: true })).toBeVisible();
  await expect(page.locator('.gameover-summary')).toContainText('28/29');
});

test('twelve-operation Shatterline remains contained at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDawnAnchor(page, 1);
  await expect(page.locator('.territory-marker')).toHaveCount(12);
  await expect(page.locator('.territory-marker').filter({ hasText: 'Dawn Anchor' })).toBeVisible();
  const pageWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(pageWidths.viewport).toBe(390);
  expect(pageWidths.scroll).toBe(pageWidths.client);
});
