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
    return page.evaluate(() => {
      const animationState = (window as any).__battleControl?.animationState?.() ?? null;
      if (!animationState?.path?.length) return null;
      return {
        first: animationState.path[0],
        last: animationState.path[animationState.path.length - 1]
      };
    });
  }).toEqual({ first: setup!.from, last: setup!.to });

  await page.waitForTimeout(900);
  const after = await page.evaluate((unitId) => {
    const unit = ((window as any).__battleControl?.allyUnits?.() ?? []).find((candidate: any) => candidate.id === unitId);
    return unit?.coord;
  }, setup!.unitId);
  expect(after).toEqual(setup!.to);
});

test('vehicle movement finishes facing its last travelled step', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);

  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const orientationFor = (from: any, to: any) => {
      const dq = Math.sign(to.q - from.q);
      const dr = Math.sign(to.r - from.r);
      if (dq > 0 && dr === 0) return 0;
      if (dq > 0 && dr < 0) return 1;
      if (dq === 0 && dr < 0) return 2;
      if (dq < 0 && dr === 0) return 3;
      if (dq < 0 && dr > 0) return 4;
      if (dq === 0 && dr > 0) return 5;
      if (dq > 0 && dr > 0) return 6;
      if (dq < 0 && dr < 0) return 7;
      return 0;
    };
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const enemies = ctrl?.enemyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.type === 'vehicle');
    if (!vehicle) return null;
    allies
      .filter((unit: any) => unit.id !== vehicle.id)
      .forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 0, index));
    enemies.forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 9, index));
    ctrl.snapUnit(vehicle.id, 3, 3);
    ctrl.forceAllianceTurn();
    ctrl.selectUnit(vehicle.id);
    for (let r = 2; r <= 6; r++) {
      for (let q = 4; q <= 7; q++) {
        const candidatePath = ctrl.pathForUnit(vehicle.id, q, r);
        if (candidatePath?.success && candidatePath.path.length >= 2) {
          const penultimate = candidatePath.path[candidatePath.path.length - 2];
          const last = candidatePath.path[candidatePath.path.length - 1];
          return {
            vehicleId: vehicle.id,
            to: last,
            expectedOrientation: orientationFor(penultimate, last)
          };
        }
      }
    }
    return null;
  });
  expect(setup).toBeTruthy();

  const started = await page.evaluate(({ vehicleId, to }) => {
    return (window as any).__battleControl?.animateUnitTo?.(vehicleId, to.q, to.r);
  }, setup!);
  expect(started).toBeTruthy();

  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null);
  }).not.toBeNull();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null);
  }, { timeout: 5_000 }).toBeNull();

  const after = await page.evaluate((vehicleId) => {
    return ((window as any).__battleControl?.allyUnits?.() ?? []).find((unit: any) => unit.id === vehicleId);
  }, setup!.vehicleId);
  expect(after?.coord).toEqual(setup!.to);
  expect(after?.orientation).toBe(setup!.expectedOrientation);
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

test('visible friendly vehicle body wins over adjacent enemy tile hit', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const enemies = ctrl?.enemyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.type === 'vehicle' || unit.definitionId?.includes('truck'));
    const enemy = enemies.find((unit: any) => unit.stance !== 'destroyed');
    if (!vehicle || !enemy) return null;
    const vehicleCoord = { q: 4, r: 4 };
    const enemyCoord = { q: 5, r: 4 };
    allies
      .filter((unit: any) => unit.id !== vehicle.id)
      .forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 1, index));
    enemies
      .filter((unit: any) => unit.id !== enemy.id)
      .forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 8, index));
    ctrl.snapUnit(vehicle.id, vehicleCoord.q, vehicleCoord.r);
    ctrl.snapUnit(enemy.id, enemyCoord.q, enemyCoord.r);
    ctrl.forceAllianceTurn();
    ctrl.selectUnit(vehicle.id);
    ctrl.targetEnemy(enemy.id);
    return {
      vehicleId: vehicle.id,
      enemyId: enemy.id,
      vehicleCoord,
      enemyCoord
    };
  });
  expect(setup).toBeTruthy();

  await page.waitForFunction(() => Boolean((window as any).__battleCamera));
  await page.evaluate(({ q, r }) => (window as any).__battleCamera.centerOnCoord(q, r), setup!.vehicleCoord);
  await page.evaluate(() => (window as any).__battleCamera.setZoom(2.6));
  await page.waitForTimeout(250);
  const beforeClick = await page.evaluate(() => (window as any).__battleCamera.metrics());

  const vehicleBodyPoint = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const camera = (window as any).__battleCamera;
    if (!canvas || !camera) return null;
    const screen = camera.screenForCoord(q, r);
    const scale = camera.metrics().scale;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + screen.x + 8 * scale,
      y: rect.top + screen.y - 10 * scale
    };
  }, setup!.vehicleCoord);
  expect(vehicleBodyPoint).toBeTruthy();

  await page.mouse.click(vehicleBodyPoint!.x, vehicleBodyPoint!.y);
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.selectionState?.() ?? null);
  }).toMatchObject({ selectedUnitId: setup!.vehicleId, targetedEnemyId: null });
  const afterVehicleClick = await page.evaluate(() => (window as any).__battleCamera.metrics());
  expect(afterVehicleClick.centerX).toBeCloseTo(beforeClick.centerX, 1);
  expect(afterVehicleClick.centerY).toBeCloseTo(beforeClick.centerY, 1);
  expect(afterVehicleClick.scale).toBeCloseTo(beforeClick.scale, 2);

  const enemyBodyPoint = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const camera = (window as any).__battleCamera;
    if (!canvas || !camera) return null;
    const screen = camera.screenForCoord(q, r);
    const scale = camera.metrics().scale;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + screen.x,
      y: rect.top + screen.y - 12 * scale
    };
  }, setup!.enemyCoord);
  expect(enemyBodyPoint).toBeTruthy();

  await page.mouse.click(enemyBodyPoint!.x, enemyBodyPoint!.y);
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.selectionState?.() ?? null);
  }).toMatchObject({ selectedUnitId: setup!.vehicleId, targetedEnemyId: setup!.enemyId });
  const afterEnemyClick = await page.evaluate(() => (window as any).__battleCamera.metrics());
  expect(afterEnemyClick.centerX).toBeCloseTo(beforeClick.centerX, 1);
  expect(afterEnemyClick.centerY).toBeCloseTo(beforeClick.centerY, 1);
  expect(afterEnemyClick.scale).toBeCloseTo(beforeClick.scale, 2);
});

test('empty movement tile beside selected vehicle is not stolen by vehicle hit area', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const enemies = ctrl?.enemyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.type === 'vehicle' || unit.definitionId?.includes('truck'));
    if (!vehicle) return null;
    const vehicleCoord = { q: 4, r: 4 };
    allies
      .filter((unit: any) => unit.id !== vehicle.id)
      .forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 1, index));
    enemies.forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 8, index));
    ctrl.snapUnit(vehicle.id, vehicleCoord.q, vehicleCoord.r);
    ctrl.forceAllianceTurn();
    ctrl.selectUnit(vehicle.id);
    const candidateTiles = [
      { q: vehicleCoord.q - 1, r: vehicleCoord.r },
      { q: vehicleCoord.q, r: vehicleCoord.r - 1 },
      { q: vehicleCoord.q - 1, r: vehicleCoord.r + 1 }
    ];
    const movementTile = candidateTiles.find((coord) => ctrl.pathForUnit(vehicle.id, coord.q, coord.r)?.success);
    if (!movementTile) return null;
    return { vehicleId: vehicle.id, vehicleCoord, movementTile };
  });
  expect(setup).toBeTruthy();

  await page.waitForFunction(() => Boolean((window as any).__battleCamera));
  await page.evaluate(({ q, r }) => (window as any).__battleCamera.centerOnCoord(q, r), setup!.vehicleCoord);
  await page.evaluate(() => (window as any).__battleCamera.setZoom(2.6));
  await page.waitForTimeout(250);

  for (const offset of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 18, y: 0 }]) {
    await page.evaluate((vehicleId) => (window as any).__battleControl?.selectUnit(vehicleId), setup!.vehicleId);
    const tilePoint = await page.evaluate(({ q, r, offset }) => {
      const canvas = document.querySelector('canvas');
      const camera = (window as any).__battleCamera;
      if (!canvas || !camera) return null;
      const screen = camera.screenForCoord(q, r);
      const scale = camera.metrics().scale;
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + screen.x + offset.x * scale,
        y: rect.top + screen.y + offset.y * scale
      };
    }, { ...setup!.movementTile, offset });
    expect(tilePoint).toBeTruthy();

    await page.mouse.click(tilePoint!.x, tilePoint!.y);
    await expect.poll(async () => {
      return page.evaluate(() => ({
        selection: (window as any).__battleControl?.selectionState?.() ?? null,
        planning: (window as any).__battleControl?.planningState?.() ?? null
      }));
    }).toMatchObject({
      selection: { selectedUnitId: setup!.vehicleId, targetedEnemyId: null },
      planning: { plannedDestination: setup!.movementTile }
    });
  }
});

test('diagonal isometric movement tiles can be planned and committed by clicking', async ({ page }) => {
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.deployMode?.() ?? true);
  }).toBe(false);
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const setup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const infantry = ctrl?.allyUnits?.().find((unit: any) => unit.type === 'infantry' && !unit.embarkedOn);
    if (!infantry) return null;
    ctrl.allyUnits()
      .filter((unit: any) => unit.id !== infantry.id)
      .forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 0, index));
    ctrl.enemyUnits().forEach((unit: any, index: number) => ctrl.snapUnit(unit.id, 9, index));
    ctrl.snapUnit(infantry.id, 4, 4);
    ctrl.forceAllianceTurn();
    ctrl.selectUnit(infantry.id);
    const diagonalTiles = [
      { q: 3, r: 3 },
      { q: 5, r: 5 },
      { q: 5, r: 3 },
      { q: 3, r: 5 }
    ];
    const target = diagonalTiles.find((coord) => ctrl.pathForUnit(infantry.id, coord.q, coord.r)?.success);
    return target ? { unitId: infantry.id, start: { q: 4, r: 4 }, target } : null;
  });
  expect(setup).toBeTruthy();

  await page.waitForFunction(() => Boolean((window as any).__battleCamera));
  await page.evaluate(({ q, r }) => (window as any).__battleCamera.centerOnCoord(q, r), setup!.start);
  await page.evaluate(() => (window as any).__battleCamera.setZoom(2.6));
  await page.waitForTimeout(250);

  const targetPoint = await page.evaluate(({ q, r }) => {
    const canvas = document.querySelector('canvas');
    const camera = (window as any).__battleCamera;
    if (!canvas || !camera) return null;
    const screen = camera.screenForCoord(q, r);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + screen.x, y: rect.top + screen.y };
  }, setup!.target);
  expect(targetPoint).toBeTruthy();

  await page.mouse.click(targetPoint!.x, targetPoint!.y);
  await expect.poll(async () => {
    return page.evaluate(() => (window as any).__battleControl?.planningState?.() ?? null);
  }).toMatchObject({ plannedDestination: setup!.target });

  await page.mouse.click(targetPoint!.x, targetPoint!.y);
  await expect.poll(async () => {
    return page.evaluate((unitId) => {
      const unit = ((window as any).__battleControl?.allyUnits?.() ?? []).find((candidate: any) => candidate.id === unitId);
      return unit?.coord;
    }, setup!.unitId);
  }, { timeout: 4_000 }).toEqual(setup!.target);
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
