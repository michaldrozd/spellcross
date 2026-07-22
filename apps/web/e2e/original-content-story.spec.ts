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
  await expect(outcome).toContainText('OPERATION DEBRIEF');
  await expect(outcome).toContainText('The last train cleared the perimeter under its own power');
  expect(await page.evaluate(() => (window as any).__battleControl.audioState().narrativeCue)).toBe('debriefVictory');
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
  expect(await page.evaluate(() => (window as any).__battleControl.audioState().narrativeCue)).toBe('debriefDefeat');
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
