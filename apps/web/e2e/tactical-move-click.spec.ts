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

test('selecting a friendly unit near enemies preserves manual camera focus', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const ally = ctrl?.allyUnits?.().find((unit: any) => !unit.embarkedOn);
    const enemy = ctrl?.enemyUnits?.().find((unit: any) => unit.stance !== 'destroyed');
    if (!ally || !enemy) return null;
    const adjacent = { q: Math.min(ally.coord.q + 1, 9), r: ally.coord.r };
    ctrl.snapUnit(enemy.id, adjacent.q, adjacent.r);
    ctrl.forceAllianceTurn();
    ctrl.selectUnit(ally.id);
    return { allyId: ally.id, allyCoord: ally.coord, enemyId: enemy.id, enemyCoord: adjacent };
  });
  expect(setup).toBeTruthy();

  await page.waitForFunction(() => Boolean((window as any).__battleCamera));
  await page.evaluate(() => (window as any).__battleCamera.centerOnCoord(8, 6));
  await page.evaluate(() => (window as any).__battleCamera.setZoom(2.5));
  await page.waitForTimeout(150);
  const beforeSelect = await page.evaluate(() => (window as any).__battleCamera.metrics());

  const selected = await page.evaluate((allyId) => (window as any).__battleControl.selectUnit(allyId), setup!.allyId);
  expect(selected).toBeTruthy();
  await page.waitForTimeout(250);
  const afterSelect = await page.evaluate(() => (window as any).__battleCamera.metrics());

  expect(afterSelect.centerX).toBeCloseTo(beforeSelect.centerX, 1);
  expect(afterSelect.centerY).toBeCloseTo(beforeSelect.centerY, 1);
  expect(afterSelect.scale).toBeCloseTo(beforeSelect.scale, 2);
});

test('explicit target preview and cancel preserve manual camera focus', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const ally = ctrl?.allyUnits?.().find((unit: any) => !unit.embarkedOn);
    const enemy = ctrl?.enemyUnits?.().find((unit: any) => unit.stance !== 'destroyed');
    if (!ally || !enemy) return null;
    ctrl.selectUnit(ally.id);
    return { allyId: ally.id, enemyId: enemy.id };
  });
  expect(setup).toBeTruthy();

  await page.waitForFunction(() => Boolean((window as any).__battleCamera));
  await page.evaluate(() => (window as any).__battleCamera.centerOnCoord(8, 6));
  await page.evaluate(() => (window as any).__battleCamera.setZoom(2.5));
  await page.waitForTimeout(150);
  const beforeTarget = await page.evaluate(() => (window as any).__battleCamera.metrics());

  const targeted = await page.evaluate((enemyId) => (window as any).__battleControl.targetEnemy(enemyId), setup!.enemyId);
  expect(targeted).toBeTruthy();
  await page.waitForTimeout(300);
  const afterTarget = await page.evaluate(() => (window as any).__battleCamera.metrics());

  expect(afterTarget.centerX).toBeCloseTo(beforeTarget.centerX, 1);
  expect(afterTarget.centerY).toBeCloseTo(beforeTarget.centerY, 1);
  expect(afterTarget.scale).toBeCloseTo(beforeTarget.scale, 2);

  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await page.waitForTimeout(250);
  const afterCancel = await page.evaluate(() => (window as any).__battleCamera.metrics());

  expect(afterCancel.centerX).toBeCloseTo(beforeTarget.centerX, 1);
  expect(afterCancel.centerY).toBeCloseTo(beforeTarget.centerY, 1);
  expect(afterCancel.scale).toBeCloseTo(beforeTarget.scale, 2);
});

test('invalid movement gives visible order feedback', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const moved = await page.evaluate(() => (window as any).__battleControl.moveSelectedTo(99, 99));
  expect(moved).toBeFalsy();
  await expect(page.getByText(/ORDER REJECTED/i)).toBeVisible();
});
