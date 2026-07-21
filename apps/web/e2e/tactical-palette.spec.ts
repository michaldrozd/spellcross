import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('battlefield palette adapts to weather without grading the HUD', async ({ page }) => {
  test.setTimeout(90_000);
  const scenarios = [
    { territoryId: 'sector-paris', palette: 'clear' },
    { territoryId: 'sector-munich', palette: 'night' },
    { territoryId: 'sector-rift', palette: 'fog' }
  ];
  const filters: Record<string, string> = {};

  for (const scenario of scenarios) {
    await startBattle(page, scenario.territoryId);
    const sample = await page.locator('.battlefield-stage-host canvas').evaluate((canvas) => ({
      canvasFilter: getComputedStyle(canvas).filter,
      hostClass: canvas.parentElement?.className ?? '',
      hudFilter: getComputedStyle(document.querySelector('.battle-ui-layer')!).filter
    }));

    expect(sample.hostClass).toContain(`battlefield-palette-${scenario.palette}`);
    expect(sample.canvasFilter).not.toBe('none');
    expect(sample.hudFilter).toBe('none');
    filters[scenario.palette] = sample.canvasFilter;
  }

  expect(filters.night).not.toBe(filters.clear);
  expect(filters.fog).not.toBe(filters.clear);
});
