import { expect, test, type Page } from '@playwright/test';

import { startFreshCampaign } from './helpers';

const COMPLETED_ACT_TWO = new Set([
  'sector-cinder-gate',
  'sector-lantern-vault',
  'sector-ashen-confluence',
  'sector-sable-causeway',
  'sector-mnemonic-orchard',
  'sector-thorn-engine'
]);

async function openVeilHeartFront(page: Page, slot: number) {
  await startFreshCampaign(page, slot);
  await page.evaluate(({ nextSlot, completedActTwo }) => {
    const storageKey = `spellcross:campaign-state:${nextSlot}`;
    const snapshot = JSON.parse(window.localStorage.getItem(storageKey)!);
    const completed = new Set<string>(completedActTwo);
    snapshot.territories = snapshot.territories.map((territory: { id: string; act?: number }) => {
      if (territory.id === 'sector-hollow-tide') return { ...territory, status: 'bypassed', remainingTimer: undefined };
      if (territory.id === 'sector-veil-heart') return { ...territory, status: 'available', remainingTimer: territory.timer };
      if (territory.act !== 2 || completed.has(territory.id)) {
        return { ...territory, status: 'cleared', remainingTimer: undefined };
      }
      return territory;
    });
    snapshot.operationResults = { 'sector-cinder-gate': 'victory' };
    snapshot.actTimeBonusesApplied = { '2': 7 };
    snapshot.outcome = undefined;
    snapshot.turn = 24;
    snapshot.lastOperationTurn = 23;
    snapshot.globalTimer = 9;
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
  }, { nextSlot: slot, completedActTwo: Array.from(COMPLETED_ACT_TWO) });
  await page.reload();
  await page.locator('.menu-buttons .menu-btn-primary').click();
  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await page.waitForFunction(() => (
    (window as any).__campaignControl.territories()
      .find((territory: { id: string }) => territory.id === 'sector-veil-heart')?.status === 'available'
  ));
}

test('the Shatterline theater presents the complete converging Act II front', async ({ page }) => {
  await openVeilHeartFront(page, 1);

  const actOne = page.getByRole('button', { name: 'European Front' });
  const actTwo = page.getByRole('button', { name: 'Shatterline' });
  await expect(actOne).toHaveAttribute('aria-pressed', 'false');
  await expect(actTwo).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.strategic-map-svg')).toHaveAttribute('data-theater', '2');
  await expect(page.locator('.shatterline-cartography')).toBeVisible();
  await expect(page.locator('.territory-marker')).toHaveCount(12);
  await expect(page.locator('.territory-marker').filter({ hasText: 'Veil Heart' })).toBeVisible();

  await actOne.click();
  await expect(page.locator('.strategic-map-svg')).toHaveAttribute('data-theater', '1');
  await expect(page.locator('.europe-cartography')).toBeVisible();
  await expect(page.locator('.territory-marker')).toHaveCount(17);
});

test('the theater switch remains contained and usable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openVeilHeartFront(page, 1);

  const switcher = page.locator('.map-theater-switch');
  const bounds = await switcher.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Shatterline' })).toBeEnabled();
  await expect(page.locator('.strategic-map-container')).toHaveCSS('overflow', 'hidden');
});

test('destroying the Veil Heart opens the Dawn Protocol aftermath', async ({ page }) => {
  test.setTimeout(60_000);
  await openVeilHeartFront(page, 1);
  await page.locator('.territory-marker').filter({ hasText: 'Veil Heart' }).click();
  await expect(page.locator('.territory-info-panel')).toContainText('Veil Heart');
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.operation-dossier')).toContainText('CHAPTER 8 · The Second Horizon');
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await expect(page.locator('.battle-screen')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));

  await page.evaluate(() => {
    (window as any).__battleControl.replaceObjectives([]);
    (window as any).__battleControl.killAllEnemies();
    (window as any).__battleControl.resolveOutcome();
  });
  await expect(page.locator('.battle-outcome-card')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /Return to HQ/i }).click();

  await expect(page.getByRole('heading', { name: /FIELD HQ/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CAMPAIGN WON', exact: true })).toHaveCount(0);
  await expect(page.locator('.territory-marker').filter({ hasText: 'Quiet Meridian' })).toBeVisible();
});
