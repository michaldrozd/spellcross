import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test.setTimeout(45_000);

test('a deciding shell reveals the localized outcome only when its impact lands', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(async () => {
    const control = (window as any).__battleControl;
    await control.setLanguage('en');
    const loaded = control.loadDefinitions(['spg-m109', 'ironroot-colossus']);
    const attacker = loaded.loaded.find((unit: any) => unit.definitionId === 'spg-m109');
    const defender = loaded.loaded.find((unit: any) => unit.definitionId === 'ironroot-colossus');
    if (!attacker || !defender) return null;

    control.snapUnit(attacker.id, 8, 8);
    control.snapUnit(defender.id, 10, 8);
    control.setActionPoints(attacker.id, 99);
    control.setHealth(defender.id, 1);
    control.revealAll();
    control.replaceObjectives([
      { id: 'eliminate', kind: 'eliminate', description: 'Destroy all hostile units.' }
    ]);
    control.clearScriptedEvents();
    const qaWindow = window as any;
    qaWindow.__realDateNow = Date.now;
    qaWindow.__outcomeImpactNow = Date.now();
    Date.now = () => qaWindow.__outcomeImpactNow;
    const attack = control.attackUnitWith(attacker.id, defender.id, 'howitzer');
    control.endTurn();
    const victory = control.checkVictory();
    control.resolveOutcome();
    await control.setLanguage('sk');
    return { attack, victory };
  });

  expect(setup).toMatchObject({
    attack: { success: true, weaponId: 'howitzer' },
    victory: { status: 'victory', surviving: 0 }
  });
  await expect(page.locator('.battle-phase-notice')).toContainText('Zásah potvrdený', { timeout: 5_000 });
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.activeAttackEffects().at(-1)
  ))).toMatchObject({ arc: true, killed: true, sourceVisible: true, targetVisible: true });
  await expect(page.locator('.battle-outcome-overlay')).toHaveCount(0);
  await expect(page.locator('.battle-presentation-input-guard')).toBeVisible();
  await expect(page.locator('.log-entries')).not.toContainText('Zničené');

  await page.evaluate(() => {
    (window as any).__outcomeImpactNow += 800;
  });
  await expect(page.locator('.log-entries')).toContainText('Zničené');
  await expect(page.locator('.battle-outcome-overlay')).toBeVisible();
  await expect(page.locator('.battle-presentation-input-guard')).toHaveCount(0);
  await expect(page.locator('.battle-outcome-stamp')).toHaveText('SEKTOR ZABEZPEČENÝ');
  await expect(page.locator('.battle-outcome-overlay')).not.toContainText('SECTOR SECURED');

  await page.evaluate(() => {
    Date.now = (window as any).__realDateNow;
  });
});

test('hidden AI fire uses a generic phase notice without exposing its source', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(async () => {
    const control = (window as any).__battleControl;
    await control.setLanguage('en');
    const loaded = control.loadDefinitions(['light-infantry', 'ironroot-colossus']);
    const defender = loaded.loaded.find((unit: any) => unit.definitionId === 'light-infantry');
    const attacker = loaded.loaded.find((unit: any) => unit.definitionId === 'ironroot-colossus');
    if (!attacker || !defender) return null;

    control.snapUnit(defender.id, 10, 8);
    control.snapUnit(attacker.id, 8, 8);
    control.setActionPoints(attacker.id, 99);
    control.setAllianceVision([{ q: 10, r: 8 }]);
    control.clearScriptedEvents();
    return { attackerId: attacker.id };
  });

  expect(setup?.attackerId).toBeTruthy();
  await page.evaluate(() => {
    const qaWindow = window as any;
    qaWindow.__phaseNoticeTexts = [];
    const recordNotice = () => {
      const text = document.querySelector('.battle-phase-notice')?.textContent?.trim();
      if (text && !qaWindow.__phaseNoticeTexts.includes(text)) qaWindow.__phaseNoticeTexts.push(text);
    };
    qaWindow.__phaseNoticeObserver = new MutationObserver(recordNotice);
    qaWindow.__phaseNoticeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });
  await page.getByRole('button', { name: /^End Turn$/i }).click();
  await expect.poll(() => page.evaluate(() => (
    (window as any).__phaseNoticeTexts as string[]
  )), { timeout: 10_000 }).toContain('Enemy PhaseEnemy forces attacking');
  await expect.poll(() => page.evaluate(() => (
    (window as any).__battleControl.activeAttackEffects().at(-1)
  )), { timeout: 10_000 }).toMatchObject({ arc: true, sourceVisible: false, targetVisible: true });
  expect(await page.evaluate(() => (
    (window as any).__phaseNoticeTexts as string[]
  ))).not.toEqual(expect.arrayContaining([expect.stringContaining('Ironroot Colossus')]));
  await expect(page.locator('.log-entries')).not.toContainText('Ironroot Colossus');
  await page.evaluate(() => (window as any).__phaseNoticeObserver.disconnect());
});

test('reduced motion reveals a deciding kill log and outcome together', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const loaded = control.loadDefinitions(['spg-m109', 'ironroot-colossus']);
    const attacker = loaded.loaded.find((unit: any) => unit.definitionId === 'spg-m109');
    const defender = loaded.loaded.find((unit: any) => unit.definitionId === 'ironroot-colossus');
    if (!attacker || !defender) return null;

    control.snapUnit(attacker.id, 8, 8);
    control.snapUnit(defender.id, 10, 8);
    control.setActionPoints(attacker.id, 99);
    control.setHealth(defender.id, 1);
    control.revealAll();
    control.replaceObjectives([
      { id: 'eliminate', kind: 'eliminate', description: 'Destroy all hostile units.' }
    ]);
    control.clearScriptedEvents();
    const attack = control.attackUnitWith(attacker.id, defender.id, 'howitzer');
    control.resolveOutcome();
    return { attack };
  });

  expect(setup).toMatchObject({ attack: { success: true, weaponId: 'howitzer' } });
  await expect(page.locator('.battle-phase-notice')).toContainText(/Hit Confirmed|Zásah potvrdený/);
  await expect(page.locator('.log-entries')).toContainText(/Destroyed|Zničené/);
  await expect(page.locator('.battle-outcome-overlay')).toBeVisible();
});
