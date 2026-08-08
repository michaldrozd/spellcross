import { chromium, expect, test } from '@playwright/test';
import hardwareGpu from '../../../playwright.hardware.mjs';

type CampaignControl = {
  newCampaign: (slot?: number) => boolean;
  territories: () => Array<{ id: string }>;
  startBattle: (territoryId: string) => boolean;
  startBattleForValidation: (territoryId: string) => boolean;
};

declare global {
  interface Window {
    __campaignControl?: CampaignControl;
  }
}

test('launches every campaign territory without renderer errors', async ({ page }) => {
  test.setTimeout(60_000);
  const runtimeErrors: string[] = [];
  page.on('pageerror', (err) => runtimeErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') runtimeErrors.push(msg.text());
    if (msg.type() === 'warning' && msg.text().includes('Failed to persist campaign')) {
      runtimeErrors.push(msg.text());
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__campaignControl));
  await page.evaluate(() => window.__campaignControl?.newCampaign(1));
  const territoryIds = await page.evaluate(() => window.__campaignControl?.territories().map((t) => t.id) ?? []);

  expect(territoryIds.length).toBeGreaterThanOrEqual(29);
  const launches = await page.evaluate(async (ids) => {
    const outcomes: Array<{
      territoryId: string;
      started: boolean;
      battleIdentity: string | null;
      presentedBattleIdentity: string | null;
      canvasReady: boolean;
    }> = [];

    for (const territoryId of ids) {
      const started = window.__campaignControl?.startBattleForValidation(territoryId) === true;
      const renderState = await new Promise<{
        battleIdentity: string | null;
        presentedBattleIdentity: string | null;
        canvasReady: boolean;
      }>(
        (resolve) => {
          const deadline = performance.now() + 5_000;
          let matchingFrames = 0;
          const inspectFrame = () => {
            const metrics = document.querySelector('[data-testid="map-metrics"]');
            const canvas = document.querySelector('.battle-map-layer canvas');
            const canvasBounds = canvas?.getBoundingClientRect();
            const battleIdentity = metrics?.getAttribute('data-battle-id') ?? null;
            const presentedBattleIdentity = metrics?.getAttribute('data-presented-battle-id') ?? null;
            const canvasReady = canvas instanceof HTMLCanvasElement
              && canvas.width > 0
              && canvas.height > 0
              && Boolean(canvasBounds?.width && canvasBounds.height);
            matchingFrames = battleIdentity === territoryId
              && presentedBattleIdentity === territoryId
              && canvasReady
              ? matchingFrames + 1
              : 0;
            if (matchingFrames >= 2 || performance.now() >= deadline) {
              resolve({ battleIdentity, presentedBattleIdentity, canvasReady });
              return;
            }
            requestAnimationFrame(inspectFrame);
          };
          requestAnimationFrame(inspectFrame);
        }
      );
      outcomes.push({
        territoryId,
        started,
        ...renderState
      });
    }
    return outcomes;
  }, territoryIds);

  for (const launch of launches) {
    expect(launch.started, `${launch.territoryId} should launch`).toBe(true);
    expect(launch.battleIdentity, `${launch.territoryId} should own the live renderer`)
      .toBe(launch.territoryId);
    expect(launch.presentedBattleIdentity, `${launch.territoryId} should reach the presented frame`)
      .toBe(launch.territoryId);
    expect(launch.canvasReady, `${launch.territoryId} should render a visible canvas`).toBe(true);
  }
  expect(runtimeErrors, 'campaign territory launches should not emit renderer errors').toEqual([]);
});

test('shows a WebGL requirement instead of crashing when WebGL is unavailable', async ({}, testInfo) => {
  const browser = await chromium.launch({
    ...hardwareGpu.launchOptions,
    args: [
      ...(hardwareGpu.launchOptions?.args ?? []),
      '--disable-webgl',
      '--disable-3d-apis'
    ]
  });
  const page = await browser.newPage();
  const runtimeErrors: string[] = [];
  page.on('pageerror', (err) => runtimeErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') runtimeErrors.push(msg.text());
  });

  try {
    const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:4173');
    await page.goto(baseURL);
    await page.waitForFunction(() => Boolean(window.__campaignControl));
    await page.evaluate(() => window.__campaignControl?.newCampaign(1));
    const started = await page.evaluate(() => window.__campaignControl?.startBattle('sector-paris'));

    expect(started).toBeTruthy();
    await expect(page.locator('.battle-screen')).toBeVisible();
    await expect(page.getByTestId('webgl-required')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});
