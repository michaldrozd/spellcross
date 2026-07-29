import { expect, test, type Page } from '@playwright/test';

const LARGEST_AUTHORED_TERRITORIES = [
  'sector-sable-causeway',
  'sector-glass-wake',
  'sector-ash-compass',
  'sector-thorn-engine',
  'sector-dawn-anchor'
] as const;

const LARGEST_PERSISTED_TERRITORY = 'sector-ash-compass';

const SIMPLE_ASSAULT_SAMPLES = [
  { territoryId: 'sector-munich', width: 30, height: 54, enemyCount: 14 },
  { territoryId: 'sector-veil-heart', width: 40, height: 54, enemyCount: 18 }
] as const;

const RESCUE_SAMPLES = [
  { territoryId: 'sector-brussels', width: 30, height: 54, enemyCount: 14 },
  { territoryId: 'sector-lantern-vault', width: 40, height: 54, enemyCount: 18 },
  { territoryId: 'sector-quiet-meridian', width: 40, height: 54, enemyCount: 18 }
] as const;

async function waitForPresentedBattle(page: Page, territoryId: string) {
  await expect.poll(async () => page.locator('[data-testid="map-metrics"]').evaluate((metrics) => ({
    battleId: metrics.getAttribute('data-battle-id'),
    presentedBattleId: metrics.getAttribute('data-presented-battle-id'),
    width: Number(metrics.getAttribute('data-map-width')),
    height: Number(metrics.getAttribute('data-map-height'))
  }))).toMatchObject({
    battleId: territoryId,
    presentedBattleId: territoryId
  });
  const canvas = page.locator('.battle-map-layer canvas');
  await expect(canvas).toBeVisible();
  const canvasSize = await canvas.evaluate((element) => ({
    width: element.width,
    height: element.height
  }));
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);
  return page.locator('[data-testid="map-metrics"]').evaluate((element) => ({
    width: Number(element.getAttribute('data-map-width')),
    height: Number(element.getAttribute('data-map-height'))
  }));
}

test('largest scaled battlefields present within the per-slot budget', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
    if (message.type() === 'warning' && message.text().includes('Failed to persist campaign')) {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  const largestCandidates: Array<{ territoryId: string; length: number }> = [];
  for (const territoryId of LARGEST_AUTHORED_TERRITORIES) {
    expect(await page.evaluate(() => (
      (window as any).__campaignControl.newCampaign(1, 'veteran')
    ))).toBe(true);
    expect(await page.evaluate((candidate) => (
      (window as any).__campaignControl.startBattleForValidation(candidate)
    ), territoryId)).toBe(true);
    expect(await waitForPresentedBattle(page, territoryId)).toEqual({ width: 60, height: 70 });
    largestCandidates.push({
      territoryId,
      length: await page.evaluate(() => (
        window.localStorage.getItem('spellcross:campaign-state:1')?.length ?? 0
      ))
    });
  }
  const largestTerritoryId = largestCandidates
    .slice()
    .sort((left, right) => right.length - left.length)[0]?.territoryId;
  expect(largestTerritoryId).toBe(LARGEST_PERSISTED_TERRITORY);
  expect(Math.max(...largestCandidates.map(({ length }) => length)))
    .toBeLessThanOrEqual(1_734_351);
  expect(runtimeErrors).toEqual([]);
});

test('largest persisted battlefield survives all three save slots', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
    if (message.type() === 'warning' && message.text().includes('Failed to persist campaign')) {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  const slotPayloads: Array<{ slot: number; length: number }> = [];
  for (const slot of [1, 2, 3]) {
    expect(await page.evaluate((nextSlot) => (
      (window as any).__campaignControl.newCampaign(nextSlot, 'veteran')
    ), slot)).toBe(true);
    if (slot === 1) {
      expect(await page.evaluate(() => (
        (window as any).__campaignControl.startBattleForValidation('sector-paris')
      ))).toBe(true);
      await waitForPresentedBattle(page, 'sector-paris');
    }

    expect(await page.evaluate((territoryId) => (
      (window as any).__campaignControl.startBattleForValidation(territoryId)
    ), LARGEST_PERSISTED_TERRITORY)).toBe(true);
    expect(await waitForPresentedBattle(page, LARGEST_PERSISTED_TERRITORY))
      .toEqual({ width: 60, height: 70 });

    const length = await page.evaluate((savedSlot) => (
      window.localStorage.getItem(`spellcross:campaign-state:${savedSlot}`)?.length ?? 0
    ), slot);
    expect(length).toBeGreaterThan(0);
    expect(length).toBeLessThanOrEqual(1_734_351);
    slotPayloads.push({ slot, length });
  }

  const storedSlots = await page.evaluate(() => [1, 2, 3].map((slot) => ({
    slot,
    present: Boolean(window.localStorage.getItem(`spellcross:campaign-state:${slot}`))
  })));
  expect(storedSlots).toEqual([
    { slot: 1, present: true },
    { slot: 2, present: true },
    { slot: 3, present: true }
  ]);
  expect(slotPayloads.reduce((sum, slot) => sum + slot.length, 0)).toBeLessThan(5_241_856);
  expect(new Set(slotPayloads.map((slot) => slot.length)).size).toBe(1);
  expect(runtimeErrors).toEqual([]);
});

test('scaled simple assaults present their early and mid mission shapes', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  for (const sample of SIMPLE_ASSAULT_SAMPLES) {
    expect(await page.evaluate(() => (
      (window as any).__campaignControl.newCampaign(1, 'veteran')
    ))).toBe(true);
    expect(await page.evaluate((territoryId) => (
      (window as any).__campaignControl.startBattleForValidation(territoryId)
    ), sample.territoryId)).toBe(true);
    expect(await waitForPresentedBattle(page, sample.territoryId)).toEqual({
      width: sample.width,
      height: sample.height
    });

    const mission = await page.evaluate(() => {
      const control = (window as any).__battleControl;
      const objectives = control.objectives();
      return {
        enemyCount: control.enemyUnits().length,
        objectives: objectives.map((objective: any) => ({
          kind: objective.kind,
          deadlineRound: objective.deadlineRound,
          essential: objective.essential
        }))
      };
    });
    expect(mission.enemyCount).toBe(sample.enemyCount);
    expect(mission.objectives.map((objective) => objective.kind).sort())
      .toEqual(['eliminate', 'hold']);
    expect(mission.objectives.some((objective) => (
      objective.essential || objective.deadlineRound !== undefined
    ))).toBe(false);
  }

  expect(runtimeErrors).toEqual([]);
});

test('scaled Paris evacuation presents its protected captain route', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.newCampaign(1, 'veteran')
  ))).toBe(true);
  expect(await page.evaluate(() => (
    (window as any).__campaignControl.startBattleForValidation('sector-paris')
  ))).toBe(true);
  expect(await waitForPresentedBattle(page, 'sector-paris')).toEqual({
    width: 30,
    height: 54
  });

  const mission = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objectives = control.objectives();
    const reach = objectives.find((objective: any) => objective.kind === 'reach');
    const protect = objectives.find((objective: any) => objective.kind === 'protect');
    const captainId = reach?.eligibleUnitIds?.[0];
    return {
      enemyCount: control.enemyUnits().length,
      captain: control.allyUnits().find((unit: any) => unit.id === captainId),
      reach,
      protect
    };
  });

  expect(mission.enemyCount).toBe(14);
  expect(mission.captain).toMatchObject({
    definitionId: 'john-alexander',
    stance: 'ready'
  });
  expect(mission.captain.health).toBeGreaterThan(0);
  expect(mission.reach).toMatchObject({
    kind: 'reach',
    essential: false,
    deadlineRound: undefined
  });
  expect(mission.protect).toMatchObject({
    kind: 'protect',
    eligibleUnitIds: [mission.captain.id],
    essential: false,
    deadlineRound: undefined
  });
  expect(runtimeErrors).toEqual([]);
});

test('scaled rescue corridors present their protected teams and mission contracts', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));

  for (const sample of RESCUE_SAMPLES) {
    expect(await page.evaluate(() => (
      (window as any).__campaignControl.newCampaign(1, 'veteran')
    ))).toBe(true);
    expect(await page.evaluate((territoryId) => (
      (window as any).__campaignControl.startBattleForValidation(territoryId)
    ), sample.territoryId)).toBe(true);
    expect(await waitForPresentedBattle(page, sample.territoryId)).toEqual({
      width: sample.width,
      height: sample.height
    });

    const mission = await page.evaluate(() => {
      const control = (window as any).__battleControl;
      const objectives = control.objectives();
      const reach = objectives.find((objective: any) => objective.kind === 'reach');
      const protect = objectives.find((objective: any) => objective.kind === 'protect');
      const interaction = objectives.find((objective: any) => (
        objective.kind === 'interact' && !objective.optional
      ));
      const rescueUnitId = reach?.eligibleUnitIds?.[0];
      return {
        enemyCount: control.enemyUnits().length,
        rescue: control.allyUnits().find((unit: any) => unit.id === rescueUnitId),
        reach,
        protect,
        interaction
      };
    });

    expect(mission.enemyCount).toBe(sample.enemyCount);
    expect(mission.rescue).toMatchObject({
      definitionId: 'rangers',
      stance: 'ready'
    });
    expect(mission.rescue.health).toBeGreaterThan(0);
    expect(mission.reach).toMatchObject({ kind: 'reach' });
    expect(mission.reach.deadlineRound).toBeUndefined();
    expect(mission.protect).toMatchObject({
      kind: 'protect',
      eligibleUnitIds: [mission.rescue.id]
    });
    if (sample.territoryId === 'sector-lantern-vault') {
      expect(mission.interaction).toMatchObject({
        eligibleUnitIds: [mission.rescue.id],
        essential: true,
        deadlineRound: 7,
        actionPoints: 2
      });
    } else {
      expect(mission.interaction).toBeUndefined();
    }
  }

  expect(runtimeErrors).toEqual([]);
});
