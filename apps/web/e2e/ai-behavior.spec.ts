import { expect, test } from '@playwright/test';

import { startBattle } from './helpers';

test('AI advances toward objectives and pressures after player ends turn', async ({ page }) => {
  test.setTimeout(80_000);
  await startBattle(page, 'sector-lyon');

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const objective = control?.objectives?.().find((candidate: any) => candidate.kind === 'hold');
    return {
      enemies: control?.enemyUnits?.() ?? [],
      objective: objective?.target ?? null
    };
  });
  expect(setup.objective).not.toBeNull();

  // Exit deployment then let a few turn cycles run (player ends, AI responds)
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: /^(Start Battle|End Turn)$/i }).click();
    await page.waitForTimeout(200);
  }

  const after = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.() ?? []);
  expect(after.length).toBeGreaterThan(0);

  const movedCloser = after.some((unit) => {
    const before = setup.enemies.find((candidate: any) => candidate.id === unit.id);
    if (!before) return false;
    const distBefore = Math.max(
      Math.abs(before.coord.q - setup.objective!.q),
      Math.abs(before.coord.r - setup.objective!.r)
    );
    const distAfter = Math.max(
      Math.abs(unit.coord.q - setup.objective!.q),
      Math.abs(unit.coord.r - setup.objective!.r)
    );
    return distAfter < distBefore;
  });

  expect(movedCloser).toBe(true);
});
