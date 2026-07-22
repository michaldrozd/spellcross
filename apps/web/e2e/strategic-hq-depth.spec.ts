import { expect, test } from '@playwright/test';

import { startFreshCampaign } from './helpers';

async function openParisPlanner(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Territories/i }).click();
  await page.getByText(/^Paris$/).click({ force: true });
  await page.getByRole('button', { name: /Launch Attack/i }).click();
  await expect(page.getByRole('dialog', { name: /Paris Outskirts/i })).toBeVisible();
}

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
