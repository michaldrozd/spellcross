import { expect, test, type Page } from '@playwright/test';

type MigrationLayout = {
  language: 'en' | 'sk';
  slot: number;
  viewport: { width: number; height: number };
  commanderName: string;
};

const layouts: MigrationLayout[] = [
  {
    language: 'en',
    slot: 2,
    viewport: { width: 1280, height: 720 },
    commanderName: 'Captain Adam Halden'
  },
  {
    language: 'sk',
    slot: 3,
    viewport: { width: 390, height: 844 },
    commanderName: 'Kapitán Adam Halden'
  }
];

async function openLegacyActiveBattle(page: Page, layout: MigrationLayout) {
  await page.setViewportSize(layout.viewport);
  await page.goto('/');
  await page.evaluate((language) => window.localStorage.setItem('spellcross:lang', language), layout.language);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate((slot) => (window as any).__campaignControl.newCampaign(slot), layout.slot);
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.startBattleForValidation('sector-berlin')
  ))).toBe(true);
  await page.waitForFunction(() => Boolean((window as any).__battleControl));

  const legacyTacticalId = await page.evaluate((slot) => {
    const storageKey = `spellcross:campaign-state:${slot}`;
    const snapshot = JSON.parse(window.localStorage.getItem(storageKey)!);
    const tacticalId = snapshot.activeBattle.deployment.captain;
    const serializedCommander = snapshot.activeBattle.state.sides.alliance.units.v
      .find(([id]: [string, unknown]) => id === tacticalId)[1];
    serializedCommander.definitionId = 'john-alexander';
    snapshot.activeBattle.scenario.events[0].reinforcements[0].definitionId = 'john-alexander';
    snapshot.activeBattle.deployed = true;
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return tacticalId;
  }, layout.slot);

  await page.reload();
  await page.locator('.menu-buttons .menu-btn-primary').click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  return legacyTacticalId;
}

for (const layout of layouts) {
  test(`resumes and completes a renamed-unit battle in ${layout.language} at ${layout.viewport.width}x${layout.viewport.height}`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    const missingTranslations: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
      if (message.type() === 'warning' && message.text().includes('Missing translation:')) {
        missingTranslations.push(message.text());
      }
    });

    const tacticalId = await openLegacyActiveBattle(page, layout);
    const restoredCommander = await page.evaluate((unitId) => {
      const control = (window as any).__battleControl;
      control.selectUnit(unitId);
      return control.allyUnits().find((unit: any) => unit.id === unitId);
    }, tacticalId);
    expect(restoredCommander?.definitionId).toBe('adam-halden');

    const selectedCard = page.locator('.selected-unit-card');
    await expect(selectedCard).toContainText(layout.commanderName);
    await expect(selectedCard).not.toContainText('john-alexander');

    const eventResult = await page.evaluate(() => (
      (window as any).__battleControl.runScriptedEventsAtRound(5)
    ));
    expect(eventResult).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sector-berlin-reserve-wave', units: 2 })
    ]));
    expect(await page.evaluate(() => (
      (window as any).__battleControl.enemyUnits()
        .filter((unit: any) => unit.id.startsWith('sector-berlin-reserve-wave:'))
        .map((unit: any) => unit.definitionId)
    ))).toEqual(expect.arrayContaining(['adam-halden']));

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(layout.viewport.width);
    expect(missingTranslations).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });
}
