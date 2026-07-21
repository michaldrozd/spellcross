import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('range overlay follows the selected unit after movement', async ({ page }) => {
  await startBattle(page, 'sector-paris');
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const units = control?.allyUnits?.() ?? [];
    const offsets = [
      { dq: 1, dr: 0 },
      { dq: -1, dr: 0 },
      { dq: 0, dr: 1 },
      { dq: 0, dr: -1 },
      { dq: 1, dr: -1 },
      { dq: -1, dr: 1 }
    ];

    for (const unit of units.filter((candidate: any) => !candidate.embarkedOn)) {
      for (const offset of offsets) {
        const target = { q: unit.coord.q + offset.dq, r: unit.coord.r + offset.dr };
        const path = control.pathForUnit(unit.id, target.q, target.r);
        if (path?.success && path.path.length > 0) {
          control.selectUnit(unit.id);
          return { unitId: unit.id, target };
        }
      }
    }
    return null;
  });
  expect(setup).not.toBeNull();
  expect(await page.evaluate(() => (window as any).__battleControl?.rangeOverlayTiles?.() ?? [])).toEqual([]);

  await page.getByRole('button', { name: /^Show Ranges$/i }).click();
  let tilesBeforeMove: string[] = [];
  await expect.poll(async () => {
    tilesBeforeMove = await page.evaluate(() => (window as any).__battleControl?.rangeOverlayTiles?.() ?? []);
    return tilesBeforeMove.length;
  }).toBeGreaterThan(0);

  const moved = await page.evaluate(({ unitId, target }) => (
    (window as any).__battleControl?.moveUnitTo?.(unitId, target.q, target.r)
  ), setup!);
  expect(moved).toBeTruthy();

  await expect.poll(async () => page.evaluate(() => (
    (window as any).__battleControl?.rangeOverlayTiles?.() ?? []
  ))).not.toEqual(tilesBeforeMove);
  expect(await page.evaluate(() => (window as any).__battleControl?.rangeOverlayTiles?.().length ?? 0)).toBeGreaterThan(0);
});
