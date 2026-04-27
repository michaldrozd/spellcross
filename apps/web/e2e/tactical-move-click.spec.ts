import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('unit can move by clicking tiles in isometric view', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);

  // Exit deployment then force player turn with fresh AP
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  // Grab initial position of first ally from helper
  const before = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const ally = Array.from(allies ?? [])[0];
    return ally?.coord;
  });
  expect(before).toBeTruthy();

  // Click a nearby tile to attempt move
  const target = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const first = ctrl?.allyUnits?.()?.[0];
    if (!first) return null;
    const neighbors = [
      { q: first.coord.q + 1, r: first.coord.r },
      { q: first.coord.q - 1, r: first.coord.r },
      { q: first.coord.q, r: first.coord.r + 1 },
      { q: first.coord.q, r: first.coord.r - 1 }
    ];
    for (const n of neighbors) {
      const p = ctrl?.pathTo?.(n.q, n.r);
      if (p?.success && p.path.length) {
        return p.path[p.path.length - 1];
      }
    }
    return null;
  });
  expect(target).toBeTruthy();
  const moved = await page.evaluate(({ q, r }) => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const first = Array.from(allies ?? [])[0];
    if (!first) return false;
    return ctrl?.moveUnitTo?.(first.id, q, r);
  }, target!);
  expect(moved).toBeTruthy();

  // Wait a tick and ensure position updated
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits ? ctrl.allyUnits() : [];
    const ally = Array.from(allies ?? [])[0];
    return ally?.coord;
  });
  expect(after).toBeTruthy();
  expect(after?.q === target.q && after?.r === target.r).toBeTruthy();
});

test('animated movement path starts from the unit origin', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);

  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const unit = allies.find((candidate: any) => candidate.type === 'infantry') ?? allies[0];
    if (!unit) return null;
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 10; q++) {
        const path = ctrl?.pathForUnit?.(unit.id, q, r);
        if (path?.success && path.path.length) {
          return {
            unitId: unit.id,
            from: unit.coord,
            to: path.path[path.path.length - 1]
          };
        }
      }
    }
    return null;
  });
  expect(setup).toBeTruthy();

  const started = await page.evaluate(({ unitId, to }) => {
    return (window as any).__battleControl?.animateUnitTo?.(unitId, to.q, to.r);
  }, setup!);
  expect(started).toBeTruthy();

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null);
  }).not.toBeNull();

  const animationState = await page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null);
  expect(animationState?.path?.[0]).toEqual(setup!.from);
  expect(animationState?.path?.[animationState.path.length - 1]).toEqual(setup!.to);

  await page.waitForTimeout(900);
  const after = await page.evaluate((unitId) => {
    const unit = ((window as any).__battleControl?.allyUnits?.() ?? []).find((candidate: any) => candidate.id === unitId);
    return unit?.coord;
  }, setup!.unitId);
  expect(after).toEqual(setup!.to);
});
