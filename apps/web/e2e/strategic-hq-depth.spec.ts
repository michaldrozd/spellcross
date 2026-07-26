import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

async function openParisPlanner(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Territories/i }).click();
  await page.getByText(/^Paris$/).click({ force: true });
  await page.getByRole('button', { name: /Launch Attack/i }).click();
  await expect(page.getByRole('dialog', { name: /Paris Outskirts/i })).toBeVisible();
}

function localeServiceKeys(language: 'en' | 'sk') {
  const path = resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/hq.json`);
  const locale = JSON.parse(readFileSync(path, 'utf8')) as { service: Record<string, unknown> };
  const flatten = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
    return Object.entries(value)
      .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  };
  return flatten(locale.service);
}

function localeOfficerKeys(language: 'en' | 'sk') {
  const path = resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/hq.json`);
  const locale = JSON.parse(readFileSync(path, 'utf8')) as {
    army: { officerProfiles: Record<string, unknown>; officerRanks: Record<string, unknown> };
  };
  const flatten = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
    return Object.entries(value)
      .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  };
  return [
    ...flatten(locale.army.officerProfiles, 'officerProfiles'),
    ...flatten(locale.army.officerRanks, 'officerRanks')
  ].sort();
}

function localeCampaignKeys(language: 'en' | 'sk') {
  const path = resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/campaign.json`);
  const locale = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  delete locale._note;
  const flatten = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
    return Object.entries(value)
      .flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      .sort();
  };
  return flatten(locale);
}

async function openLightInfantryService(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Army \(/i }).click();
  const infantryRow = page.locator('.unit-row').filter({ hasText: /Light Infantry/i }).first();
  await infantryRow.getByRole('button', { name: /Service/i }).click();
  return page.getByRole('dialog', { name: /Light Infantry/i });
}

test('equipment doctrine copy has exact English and Slovak key parity', () => {
  expect(localeServiceKeys('en')).toEqual(localeServiceKeys('sk'));
});

test('officer corps copy has exact English and Slovak key parity', () => {
  expect(localeOfficerKeys('en')).toEqual(localeOfficerKeys('sk'));
  expect(localeCampaignKeys('en')).toEqual(localeCampaignKeys('sk'));
});

test('visible operation planner deploys only the confirmed roster and pins the commander', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await openParisPlanner(page);

  const commander = page.locator('.deployment-unit.required').filter({ hasText: /Captain John Alexander/i });
  await expect(commander).toHaveAttribute('aria-pressed', 'true');
  await commander.click();
  await expect(commander).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Clear Optional/i }).click();
  const infantry = page.locator('.deployment-unit').filter({ hasText: /Light Infantry/i }).first();
  await infantry.click();
  await expect(page.getByText(/MANIFEST 2 \/ /i)).toBeVisible();
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));

  const deployed = await page.evaluate(() => (window as any).__battleControl.deploymentRosterIds());
  expect(deployed).toEqual(['captain', 'lance-1']);
});

test('task-group assignment persists and drives planner quick selection', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.getByRole('button', { name: /Army \(/i }).click();
  const infantryRow = page.locator('.unit-row').filter({ hasText: /Light Infantry/i }).first();
  const formationSelect = infantryRow.locator('.formation-assignment select');
  await formationSelect.selectOption('bravo');
  await expect(formationSelect).toHaveValue('bravo');

  const assignedBeforeReload = await page.evaluate(() => (window as any).__campaignControl.formations());
  expect(assignedBeforeReload.find((formation: { id: string }) => formation.id === 'bravo')?.units).toContain('lance-1');

  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  await page.getByRole('button', { name: /Army \(/i }).click();
  await expect(page.locator('.unit-row').filter({ hasText: /Light Infantry/i }).first().locator('select')).toHaveValue('bravo');

  await openParisPlanner(page);
  await page.locator('.deployment-formations').getByRole('button', { name: /Task Force Bravo/i }).click();
  await expect(page.getByText(/MANIFEST 2 \/ /i)).toBeVisible();
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  expect(await page.evaluate(() => (window as any).__battleControl.deploymentRosterIds()))
    .toEqual(['captain', 'lance-1']);
});

test('officer recruits, attaches, promotes, persists and leads only when the carrier deploys', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.evaluate(() => (window as any).__campaignControl.setMoney(10_000));
  await page.getByRole('button', { name: /Army \(/i }).click();

  let officerCard = page.locator('.officer-card').filter({ hasText: /Arden Kade/i });
  await officerCard.getByRole('button', { name: /RECRUIT/i }).click();
  const carrier = officerCard.getByRole('combobox', { name: /Assign carrier for Arden Kade/i });
  await carrier.selectOption('lance-1');
  await expect(carrier).toHaveValue('lance-1');
  await expect(page.locator('.formation-card-alpha')).toContainText(/Field Adjutant.*Arden Kade/is);

  await page.evaluate(() => (window as any).__campaignControl.setOfficerService('arden-kade', 6));
  for (const rank of ['Line Lieutenant', 'Battle Captain', 'Sector Commandant']) {
    await officerCard.getByRole('button', { name: new RegExp(`PROMOTE.*${rank}`, 'i') }).click();
  }
  await expect(officerCard).toContainText(/Sector Commandant/i);
  await expect(page.locator('.formation-card-alpha')).toContainText(/6 \/ 10 assigned/i);

  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  await page.getByRole('button', { name: /Army \(/i }).click();
  officerCard = page.locator('.officer-card').filter({ hasText: /Arden Kade/i });
  await expect(officerCard).toContainText(/Sector Commandant/i);
  await expect(officerCard.getByRole('combobox')).toHaveValue('lance-1');

  await openParisPlanner(page);
  const leader = page.locator('.deployment-unit').filter({ hasText: /FORMATION LEADER/i });
  await expect(leader).toHaveCount(1);
  await leader.click();
  await expect(page.getByText(/COMMAND AURA OFFLINE/i)).toBeVisible();
  await leader.click();
  await expect(page.getByText(/COMMAND AURA OFFLINE/i)).toHaveCount(0);

  const projected = await page.evaluate(() => (window as any).__campaignControl.effectiveUnitStats('recon-1'));
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  expect(await page.evaluate(() => (window as any).__battleControl.deployedUnitStats('recon-1')))
    .toEqual(projected);
});

test('destroyed officer carrier returns a fallen memorial, command shock and clean membership', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.evaluate(() => (window as any).__campaignControl.setMoney(10_000));
  await page.getByRole('button', { name: /Army \(/i }).click();
  const officerCard = page.locator('.officer-card').filter({ hasText: /Mirela Sorn/i });
  await officerCard.getByRole('button', { name: /RECRUIT/i }).click();
  await officerCard.getByRole('combobox', { name: /Assign carrier for Mirela Sorn/i }).selectOption('lance-1');

  await openParisPlanner(page);
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const carrierId = control.deploymentTacticalId('lance-1');
    control.destroyUnit(carrierId);
    control.replaceObjectives([]);
    control.killAllEnemies();
    control.resolveOutcome();
  });
  await expect(page.locator('.battle-outcome-card.victory, .battle-outcome-overlay.victory')).toBeVisible();
  await page.getByRole('button', { name: /Return to HQ/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  const corps = await page.evaluate(() => (window as any).__campaignControl.officers());
  expect(corps.find((officer: { profileId: string }) => officer.profileId === 'mirela-sorn'))
    .toMatchObject({ status: 'fallen', assignedUnitId: undefined });
  const formations = await page.evaluate(() => (window as any).__campaignControl.formations());
  expect(formations.find((formation: { id: string }) => formation.id === 'alpha').units).not.toContain('lance-1');

  await page.getByRole('button', { name: /Army \(/i }).click();
  await expect(page.locator('.officer-card').filter({ hasText: /Mirela Sorn/i })).toContainText(/ROLL OF HONOUR/i);
  await expect(page.locator('.formation-card-alpha')).toContainText(/5 \/ 6 assigned/i);
  await expect(page.locator('.formation-card-alpha')).toContainText(/COMMAND SHOCK −8/i);
});

test('unit service and research switching execute their visible exact previews', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.evaluate(() => {
    (window as any).__campaignControl.setArmyUnitHealth('lance-1', 2);
    (window as any).__campaignControl.setMoney(10_000);
  });
  await page.getByRole('button', { name: /Army \(/i }).click();
  const infantryRow = page.locator('.unit-row').filter({ hasText: /Light Infantry/i }).first();
  await infantryRow.getByRole('button', { name: /Service/i }).click();
  const serviceDialog = page.getByRole('dialog', { name: /Light Infantry/i });
  await expect(serviceDialog).toContainText(/2\/100 HP/i);
  await serviceDialog.locator('.service-options').first().locator('button').nth(1).click();
  await serviceDialog.locator('.service-rearm-options').getByRole('button', { name: /Ranger Recon/i }).click();

  const serviced = await page.evaluate(() => (
    (window as any).__campaignControl.army().find((unit: { id: string }) => unit.id === 'lance-1')
  ));
  expect(serviced).toMatchObject({ definitionId: 'rangers', health: 80, experience: 15, tier: 'rookie' });
  await page.locator('.unit-service-modal .hq-modal-footer').getByRole('button', { name: /^Close$/i }).click();

  await page.locator('.hq-tabs .tab').filter({ hasText: /Research/i }).click();
  const armor = page.locator('.research-card').filter({
    has: page.locator('h4', { hasText: /^Composite Plating$/i })
  });
  const esprit = page.locator('.research-card').filter({
    has: page.locator('h4', { hasText: /^Esprit de Corps$/i })
  });
  await armor.getByRole('button', { name: /Queue/i }).click();
  await page.getByRole('button', { name: /Pause Project/i }).click();
  await expect(armor).toContainText(/PAUSED/i);
  await esprit.getByRole('button', { name: /Queue/i }).click();
  await page.getByRole('button', { name: /Pause Project/i }).click();
  await armor.getByRole('button', { name: /Resume.*80 RP/i }).click();

  const research = await page.evaluate(() => (window as any).__campaignControl.research());
  expect(research.active).toEqual({ topicId: 'armor-upfit', remaining: 80 });
  expect(research.paused['esprit-de-corps']).toBe(50);
});

test('researched equipment installs, survives reload and reaches deployed battle stats', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.evaluate(() => (window as any).__campaignControl.setMoney(10_000));

  const serviceDialog = await openLightInfantryService(page);
  await expect(serviceDialog).toContainText('FIELD EQUIPMENT DOCTRINE');
  const categoryTabs = serviceDialog.locator('.equipment-category-tabs');
  const offense = categoryTabs.getByRole('button', { name: /^OFFENSE$/i });
  const protection = categoryTabs.getByRole('button', { name: /^PROTECTION$/i });
  const mobility = categoryTabs.getByRole('button', { name: /MOBILITY/i });
  await expect(offense).toHaveAttribute('aria-pressed', 'true');
  await expect(serviceDialog.locator('.equipment-option-grid > button')).toHaveCount(4);

  const helix = serviceDialog.getByRole('button', { name: /Helix Sight Bus/i });
  await expect(helix).toContainText(/Mobility.*7 → 6/is);
  await expect(helix).toContainText(/Vision.*4 → 5/is);
  await expect(helix).toContainText(/Accuracy.*72% → 76%/is);
  await helix.click();
  await expect(serviceDialog.getByRole('button', { name: /Helix Sight Bus/i })).toContainText('FITTED');

  await protection.click();
  await expect(protection).toHaveAttribute('aria-pressed', 'true');
  await expect(serviceDialog.locator('.equipment-option-grid > button')).toHaveCount(4);
  await expect(serviceDialog.getByRole('button', { name: /Signal Veil/i })).toContainText(/Armor.*2 → 3/is);
  await mobility.click();
  await expect(serviceDialog.locator('.equipment-option-grid > button')).toHaveCount(4);
  await expect(serviceDialog.getByRole('button', { name: /Trailblazer Drive/i })).toContainText(/Mobility.*6 → 8/is);

  await expect(serviceDialog.locator('.service-rearm-options').getByRole('button', { name: /Ranger Recon/i }))
    .toContainText(/removes 1 fitted doctrine package/i);
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.army().find((unit: { id: string }) => unit.id === 'lance-1').equipment
  ))).toEqual({ offense: 'helix-sight-bus' });

  await serviceDialog.locator('.hq-modal-footer').getByRole('button', { name: /^Close$/i }).click();
  await page.reload();
  await page.getByRole('button', { name: /Continue/i }).click();
  const restoredDialog = await openLightInfantryService(page);
  await expect(restoredDialog.getByRole('button', { name: /Helix Sight Bus/i })).toContainText('FITTED');
  await restoredDialog.locator('.hq-modal-footer').getByRole('button', { name: /^Close$/i }).click();

  await openParisPlanner(page);
  await page.getByRole('button', { name: /Confirm Deployment/i }).click();
  await page.waitForFunction(() => Boolean((window as any).__battleControl));
  const deployedStats = await page.evaluate(() => (window as any).__battleControl.deployedUnitStats('lance-1'));
  expect(deployedStats).toMatchObject({
    mobility: 6,
    vision: 5,
    weaponAccuracy: { rifle: 0.76 }
  });
});

test('unit conversion visibly resets fitted doctrine packages', async ({ page }) => {
  await startFreshCampaign(page, 1);
  await page.evaluate(() => (window as any).__campaignControl.setMoney(10_000));
  const serviceDialog = await openLightInfantryService(page);
  await serviceDialog.getByRole('button', { name: /Helix Sight Bus/i }).click();

  const rearm = serviceDialog.locator('.service-rearm-options').getByRole('button', { name: /Ranger Recon/i });
  await expect(rearm).toContainText(/removes 1 fitted doctrine package/i);
  await rearm.click();
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.army().find((unit: { id: string }) => unit.id === 'lance-1')
  ))).toMatchObject({ definitionId: 'rangers', equipment: {} });
});

test('mobile research controls stay contained and pause without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startFreshCampaign(page, 1);
  await page.locator('.hq-tabs .tab').filter({ hasText: /Research/i }).click();
  const armor = page.locator('.research-card').filter({
    has: page.locator('h4', { hasText: /^Composite Plating$/i })
  });
  await armor.getByRole('button', { name: /Queue/i }).click();
  await page.getByRole('button', { name: /Pause Project/i }).click();

  await expect(armor).toContainText(/PAUSED/i);
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(widths.document).toBe(widths.viewport);
});
