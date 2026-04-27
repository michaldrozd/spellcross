import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('tactical edge cases: blocked movement, embarked units, and exhausted attacks', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);
  await page.getByRole('button', { name: /^Start Battle$/i }).click();
  await page.evaluate(() => (window as any).__battleControl?.forceAllianceTurn?.());

  const blockedSetup = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const vehicle = allies.find((unit: any) => unit.type === 'vehicle');
    const blocker = allies.find((unit: any) => unit.id !== vehicle?.id);
    if (!vehicle || !blocker) return null;
    const path = ctrl.pathForUnit(vehicle.id, blocker.coord.q, blocker.coord.r);
    const moved = ctrl.moveUnitTo(vehicle.id, blocker.coord.q, blocker.coord.r);
    const after = ctrl.allyUnits().find((unit: any) => unit.id === vehicle.id);
    return { vehicle, blocker, path, moved, after };
  });

  expect(blockedSetup).toBeTruthy();
  expect(blockedSetup!.path.success).toBe(false);
  expect(blockedSetup!.moved).toBe(false);
  expect(blockedSetup!.after.coord).toEqual(blockedSetup!.vehicle.coord);

  const infantryMove = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const infantry = (ctrl?.allyUnits?.() ?? []).find((unit: any) => unit.type === 'infantry' && !unit.embarkedOn);
    if (!infantry) return null;
    for (let r = 0; r < 7; r++) {
      for (let q = 0; q < 10; q++) {
        const path = ctrl.pathForUnit(infantry.id, q, r);
        if (path?.success && path.path.length && path.cost <= 7) {
          const target = path.path[path.path.length - 1];
          const moved = ctrl.moveUnitTo(infantry.id, target.q, target.r);
          const after = ctrl.allyUnits().find((unit: any) => unit.id === infantry.id);
          return { infantry, target, moved, after };
        }
      }
    }
    return null;
  });

  expect(infantryMove).toBeTruthy();
  expect(infantryMove!.moved).toBe(true);
  expect(infantryMove!.after).toBeTruthy();
  expect(infantryMove!.after.embarkedOn).toBeFalsy();
  expect(infantryMove!.after.coord).toEqual(infantryMove!.target);

  const embarked = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const allies = ctrl?.allyUnits?.() ?? [];
    const carrier = allies.find((unit: any) => (unit.cap ?? 0) > 0);
    const passenger = allies.find((unit: any) => unit.type === 'infantry' && unit.id !== carrier?.id);
    if (!carrier || !passenger) return null;
    ctrl.snapUnit(passenger.id, carrier.coord.q, carrier.coord.r + 1);
    const embark = ctrl.embark(carrier.id, passenger.id);
    const carrierAfter = ctrl.allyUnits().find((unit: any) => unit.id === carrier.id);
    const passengerAfter = ctrl.allyUnits().find((unit: any) => unit.id === passenger.id);
    return { carrier, passenger, embark, carrierAfter, passengerAfter };
  });

  expect(embarked).toBeTruthy();
  expect(embarked!.embark.success).toBe(true);
  expect(embarked!.passengerAfter.embarkedOn).toBe(embarked!.carrier.id);
  expect(embarked!.carrierAfter.carrying).toContain(embarked!.passenger.id);

  const noApAttack = await page.evaluate(() => {
    const ctrl = (window as any).__battleControl;
    const attacker = (ctrl?.allyUnits?.() ?? []).find((unit: any) => unit.type === 'vehicle');
    const defender = (ctrl?.enemyUnits?.() ?? [])[0];
    if (!attacker || !defender) return null;
    ctrl.setActionPoints(attacker.id, 0);
    ctrl.selectUnit(attacker.id);
    return ctrl.attackUnitWith(attacker.id, defender.id);
  });

  expect(noApAttack).toBeTruthy();
  expect(noApAttack!.success).toBe(false);
  expect(noApAttack!.error).toBe('Not enough action points to attack');
  await expect(page.locator('.log-entries')).toContainText('Not enough action points to attack');
  await expect(page.locator('.unit-card').first()).toContainText(/AP 0\/9|AP 0\/8|AP 0\/7/);
});
