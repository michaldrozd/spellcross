import { expect, test, type Page } from '@playwright/test';

import { launchBattle, startFreshCampaign } from './helpers';

async function openFirstOperationPlanner(page: Page) {
  await page.locator('.territory-marker').first().click();
  await page.locator('.attack-btn-large').click();
  await expect(page.locator('.deployment-planner')).toBeVisible();
}

test('operation dossier carries briefing, battle mood, and specific victory debrief through the live flow', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await openFirstOperationPlanner(page);

  const dossier = page.locator('.operation-dossier');
  await expect(dossier).toContainText('INTELLIGENCE DOSSIER');
  await expect(dossier).toContainText('CHAPTER 1 · Broken Horizon');
  await expect(dossier).toContainText('Lantern Road');
  await expect(dossier).toContainText('Evacuation trains are loading');
  await expect(dossier).toContainText('Hunter packs are following emergency broadcasts');
  await expect(dossier).toContainText('Hold the junction');
  expect(await page.evaluate(() => (window as any).__campaignControl.audioState().narrativeCue)).toBe('briefing');

  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await expect(page.locator('.battlefield-loader')).toHaveCount(0);
  await page.waitForFunction(() => (
    (window as any).__battleControl.audioState().ambience?.theme === 'frontline'
  ));

  await page.evaluate(() => {
    const control = (window as any).__battleControl;
    control.replaceObjectives([]);
    control.killAllEnemies();
    control.resolveOutcome();
  });

  const outcome = page.locator('.battle-outcome-card');
  await expect(outcome).toBeVisible();
  const outcomeDialog = page.getByRole('dialog', { name: /Sector Secured/i });
  const continueButton = outcomeDialog.locator('.battle-outcome-continue');
  await expect(outcomeDialog).toHaveAttribute('aria-modal', 'true');
  await expect(continueButton).toBeFocused();
  await outcome.locator('.battle-outcome-stamp').click();
  await expect(page.locator('body')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(continueButton).toBeFocused();
  await outcome.locator('.battle-outcome-stamp').click();
  await page.keyboard.press('Shift+Tab');
  await expect(continueButton).toBeFocused();
  await expect(outcome).toContainText('OPERATION DEBRIEF');
  await expect(outcome).toContainText('The last train cleared the perimeter under its own power');
  expect(await page.evaluate(() => (window as any).__battleControl.audioState())).toEqual({
    narrativeCue: 'debriefVictory',
    ambience: null
  });
});

test('defeat uses the authored sector report and its own debrief cue', async ({ page }) => {
  await startFreshCampaign(page, 2);
  await launchBattle(page, 'sector-lyon');
  await page.waitForFunction(() => (
    (window as any).__battleControl.audioState().ambience?.theme === 'siege'
  ));
  await page.evaluate(() => (window as any).__battleControl.killAllAllies());

  const outcome = page.locator('.battle-outcome-card');
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText('The foundry blocks are burning and the production line is silent');
  expect(await page.evaluate(() => (window as any).__battleControl.audioState())).toEqual({
    narrativeCue: 'debriefDefeat',
    ambience: null
  });
});

test('generated raids are visible and launch with a complete fallback dossier and safe ambience', async ({ page }) => {
  await startFreshCampaign(page, 4);
  await page.evaluate(() => (window as any).__campaignControl.endTurn(3));
  await expect(page.locator('.rapid-response-operation')).toHaveCount(2);
  await page.evaluate(() => (window as any).__campaignControl.dismissPopups());

  const rapidResponse = page.locator('.rapid-response-operation').first();
  await expect(rapidResponse).toContainText('Enemy Raid near');
  await rapidResponse.click();
  await expect(page.locator('.territory-info-panel')).toContainText('Enemy forces launch a counteroffensive');
  await page.locator('.attack-btn-large').click();

  const dossier = page.locator('.operation-dossier');
  await expect(dossier).toBeVisible();
  await expect(dossier).toContainText('FIELD DIRECTIVE');
  await expect(dossier).toContainText('Unscheduled Contact');
  await expect(dossier).toContainText('Enemy strength and intent remain unconfirmed');
  await expect(dossier).toContainText('Secure the assigned sector');

  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.waitForFunction(() => (
    (window as any).__battleControl.audioState().ambience?.theme === 'frontline'
  ));
});

test('Slovak mobile dossier stays contained and fully localized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => window.localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(3));
  await openFirstOperationPlanner(page);

  const dossier = page.locator('.operation-dossier');
  await expect(dossier).toContainText('SPRAVODAJSKÝ SPIS');
  await expect(dossier).toContainText('KAPITOLA 1 · Zlomený horizont');
  await expect(dossier).toContainText('Cesta lampášov');
  await expect(dossier).toContainText('SITUÁCIA');
  await expect(dossier).toContainText('HROZBA');
  await expect(dossier).toContainText('ZÁMER VELENIA');

  const geometry = await page.evaluate(() => {
    const modal = document.querySelector('.deployment-planner')!.getBoundingClientRect();
    const dossierRect = document.querySelector('.operation-dossier')!.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      modalLeft: modal.left,
      modalRight: modal.right,
      dossierLeft: dossierRect.left,
      dossierRight: dossierRect.right
    };
  });
  expect(geometry.documentWidth).toBe(geometry.viewportWidth);
  expect(geometry.modalLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.modalRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.dossierLeft).toBeGreaterThanOrEqual(0);
  expect(geometry.dossierRight).toBeLessThanOrEqual(geometry.viewportWidth);
  await expect(page.getByRole('button', { name: /POTVRDIŤ NASADENIE/i })).toBeVisible();
});
