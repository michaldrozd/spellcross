import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { startFreshCampaign } from './helpers';

const ACT_TWO_TERRITORIES = [
  'sector-cinder-gate',
  'sector-lantern-vault',
  'sector-hollow-tide'
] as const;

function loadLocale(language: 'en' | 'sk', namespace: string) {
  const path = resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/${namespace}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function objectKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value)
    .flatMap(([key, child]) => objectKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

function valueAt(locale: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((value, key) => (
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  ), locale);
}

async function openMigratedActTwo(page: Page, slot: number) {
  await startFreshCampaign(page, slot);
  await page.evaluate(({ nextSlot, actTwoTerritories }) => {
    const storageKey = `spellcross:campaign-state:${nextSlot}`;
    const snapshot = JSON.parse(window.localStorage.getItem(storageKey)!);
    const laterActIds = new Set<string>(actTwoTerritories);
    snapshot.territories = snapshot.territories
      .filter((territory: { id: string }) => !laterActIds.has(territory.id))
      .map((territory: { status: string }) => ({ ...territory, status: 'cleared' }));
    snapshot.outcome = 'victory';
    snapshot.turn = 18;
    snapshot.lastOperationTurn = 17;
    snapshot.globalTimer = 8;
    delete snapshot.operationResults;
    delete snapshot.actTimeBonusesApplied;
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, { nextSlot: slot, actTwoTerritories: ACT_TWO_TERRITORIES });

  await page.reload();
  await page.locator('.menu-buttons .menu-btn-primary').click();
  await expect(page.getByRole('heading', { name: 'CAMPAIGN WON' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Act II' })).toBeVisible();
  await expect(page.locator('.gameover-summary')).toContainText('17/20');
  await page.getByRole('button', { name: 'Continue to Act II' }).click();

  await expect(page.locator('.gameover-overlay')).toHaveCount(0);
  await expect(page.locator('.territory-act-banner')).toContainText('ACT II');
  await expect(page.locator('.territory-act-banner')).toContainText('VEILBREAK');
  await expect(page.locator('.territory-info-panel')).toContainText('Cinder Gate');
  await expect(page.locator('.turn-info')).toContainText('WAR CLOCK 10');
}

async function launchSelectedOperation(page: Page) {
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.deployment-planner')).toBeVisible();
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await expect(page.locator('.battle-screen')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
}

test('new Act II copy has exact English and Slovak key parity', () => {
  for (const namespace of ['territories', 'scenarios', 'dossiers']) {
    const en = loadLocale('en', namespace);
    const sk = loadLocale('sk', namespace);
    for (const territoryId of ACT_TWO_TERRITORIES) {
      const key = namespace === 'scenarios' ? `city-${territoryId}` : territoryId;
      expect(objectKeys(en[key]), `${namespace}:${key}`).toEqual(objectKeys(sk[key]));
      expect(objectKeys(en[key]).every((path) => (
        typeof valueAt(en[key] as Record<string, unknown>, path) === 'string'
        && String(valueAt(en[key] as Record<string, unknown>, path)).length > 0
        && typeof valueAt(sk[key] as Record<string, unknown>, path) === 'string'
        && String(valueAt(sk[key] as Record<string, unknown>, path)).length > 0
      )), `${namespace}:${key} contains complete strings`).toBe(true);
    }
  }

  const sharedPaths = {
    hq: [
      'region.shatterline',
      'status.resolved',
      'status.bypassed',
      'territory.operationResolved',
      'territory.actLabel',
      'territory.actTwoTitle'
    ],
    campaign: [
      'gameover.actTwoUnlockedFlavor',
      'gameover.operationsResolved',
      'gameover.continueActTwo'
    ]
  };
  for (const [namespace, paths] of Object.entries(sharedPaths)) {
    const en = loadLocale('en', namespace);
    const sk = loadLocale('sk', namespace);
    for (const path of paths) {
      expect(typeof valueAt(en, path), `en ${namespace}:${path}`).toBe('string');
      expect(typeof valueAt(sk, path), `sk ${namespace}:${path}`).toBe('string');
    }
  }
});

test('a migrated victory continues through Cinder Gate into Lantern Vault', async ({ page }) => {
  await openMigratedActTwo(page, 1);
  await expect(page.locator('.territory-status-badge')).toContainText('AVAILABLE');
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.operation-dossier')).toContainText('CHAPTER 5 · Veilbreak');
  await expect(page.locator('.operation-dossier')).toContainText('Cinder Gate');
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));

  await page.evaluate(() => {
    (window as any).__battleControl.replaceObjectives([]);
    (window as any).__battleControl.killAllEnemies();
    (window as any).__battleControl.resolveOutcome();
  });
  await expect(page.locator('.battle-outcome-card')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Return to HQ/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await page.waitForFunction(() => {
    const territories = (window as any).__campaignControl.territories();
    return territories.find((territory: { id: string }) => territory.id === 'sector-lantern-vault')?.status === 'available'
      && territories.find((territory: { id: string }) => territory.id === 'sector-hollow-tide')?.status === 'bypassed';
  });

  await page.evaluate(() => {
    (window as any).__campaignControl.endTurn();
    (window as any).__campaignControl.dismissPopups();
  });
  await page.locator('.territory-marker').filter({ hasText: 'Lantern Vault' }).click();
  await expect(page.locator('.territory-act-banner')).toContainText('VEILBREAK');
  await launchSelectedOperation(page);
  await expect(page.locator('.battle-screen')).toContainText('Lantern Vault');
});

test('a Cinder Gate defeat opens and launches the Hollow Tide route', async ({ page }) => {
  await openMigratedActTwo(page, 2);
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.deployment-planner')).toBeVisible();
  await page.getByRole('button', { name: /Clear Optional/i }).click();
  await page.locator('.deployment-unit:not(.required)').first().click();
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.evaluate(() => (window as any).__battleControl.killAllAllies());
  await expect(page.locator('.battle-outcome-card')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Regroup at HQ/i }).click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await page.waitForFunction(() => {
    const territories = (window as any).__campaignControl.territories();
    return territories.find((territory: { id: string }) => territory.id === 'sector-lantern-vault')?.status === 'bypassed'
      && territories.find((territory: { id: string }) => territory.id === 'sector-hollow-tide')?.status === 'available';
  });

  await page.evaluate(() => {
    (window as any).__campaignControl.endTurn();
    (window as any).__campaignControl.dismissPopups();
  });
  await page.locator('.territory-marker').filter({ hasText: 'Hollow Tide' }).click();
  await expect(page.locator('.territory-info-panel')).toContainText('Hollow Tide');
  await launchSelectedOperation(page);
  await expect(page.locator('.battle-screen')).toContainText('Hollow Tide');
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.territories()
      .find((territory: { id: string }) => territory.id === 'sector-cinder-gate')?.status
  ))).toBe('resolved');
});
