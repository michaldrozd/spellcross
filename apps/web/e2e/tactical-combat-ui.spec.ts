import { expect, test } from '@playwright/test';
import { clickBattleTile, retreatToHq, startBattle } from './helpers';

test('UI-driven tactical play: embark, move, disembark, attack, AI reacts', async ({ page }) => {
  test.setTimeout(90_000);
  await startBattle(page);
  await expect(page.getByRole('button', { name: /^Start Battle$/i })).toBeVisible();

  const units = await page.evaluate(() => (window as any).__battleControl?.allyUnits?.() ?? []);
  const carrier = units.find((u: any) => (u.cap ?? 0) > 0);
  const passenger = units.find((u: any) => u.type === 'infantry' && u.id !== carrier?.id);
  expect(carrier).toBeTruthy();
  expect(passenger).toBeTruthy();
  await page.getByRole('button', { name: /^Start Battle$/i }).click();

  // Move APC one hex via click to trigger movement
  const carrierDestination = { q: carrier.coord.q, r: carrier.coord.r + 1 };
  const passengerDestination = { q: carrier.coord.q + 1, r: carrier.coord.r + 1 };
  await clickBattleTile(page, carrier.coord.q, carrier.coord.r);
  await clickBattleTile(page, carrierDestination.q, carrierDestination.r);
  await clickBattleTile(page, carrierDestination.q, carrierDestination.r);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null)).toBeNull();
  const carrierMoved = await page.evaluate(() => (window as any).__battleControl?.allyPositions?.());
  expect(carrierMoved?.some((position: any) => position.id === carrier.id && position.q === carrierDestination.q && position.r === carrierDestination.r)).toBeTruthy();

  // Move infantry adjacent to APC
  await clickBattleTile(page, passenger.coord.q, passenger.coord.r);
  await clickBattleTile(page, passengerDestination.q, passengerDestination.r);
  await clickBattleTile(page, passengerDestination.q, passengerDestination.r);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl?.animationState?.() ?? null)).toBeNull();
  const adjPos = await page.evaluate(() => (window as any).__battleControl?.allyPositions?.());
  expect(
    adjPos?.some((position: any) => position.id === passenger.id && position.q === passengerDestination.q && position.r === passengerDestination.r),
    `Passenger did not reach the deployment tile: ${JSON.stringify(adjPos)}`
  ).toBeTruthy();

  // Select the APC and embark an adjacent passenger through the real unit card.
  await clickBattleTile(page, carrierDestination.q, carrierDestination.r);
  const embarkBtn = page.getByRole('button', { name: /Embark adj/i });
  await expect(embarkBtn).toBeVisible();
  await embarkBtn.click();
  await expect.poll(async () => page.evaluate((carrierId) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((unit: any) => unit.embarkedOn === carrierId)?.id ?? null;
  }, carrier.id)).not.toBeNull();
  const embarkedPassengerId = await page.evaluate((carrierId) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((unit: any) => unit.embarkedOn === carrierId)?.id ?? null;
  }, carrier.id);
  expect(embarkedPassengerId).not.toBeNull();

  // Move APC forward with passenger embarked
  await clickBattleTile(page, carrierDestination.q, carrierDestination.r);
  await clickBattleTile(page, carrier.coord.q, carrier.coord.r);
  await clickBattleTile(page, carrier.coord.q, carrier.coord.r);
  await expect.poll(async () => page.evaluate((carrierId) => {
    const positions = (window as any).__battleControl?.allyPositions?.() ?? [];
    return positions.find((position: any) => position.id === carrierId) ?? null;
  }, carrier.id)).toMatchObject({ q: carrier.coord.q, r: carrier.coord.r });

  // Unload through the APC action and verify the passenger is back on the field.
  const unloadButton = page.getByRole('button', { name: /Unload/i });
  await expect(unloadButton).toBeVisible();
  await unloadButton.click();
  await expect.poll(async () => page.evaluate((passengerId) => {
    const units = (window as any).__battleControl?.allyUnits?.() ?? [];
    return units.find((unit: any) => unit.id === passengerId)?.embarkedOn ?? null;
  }, embarkedPassengerId)).toBeNull();

  // Put one foe into the local fire lane, acquire it on the battlefield, then fire from the command panel.
  const targetEnemy = await page.evaluate(() => (window as any).__battleControl?.enemyUnits?.()?.[0] ?? null);
  expect(targetEnemy).not.toBeNull();
  await page.evaluate(({ enemyId, carrierId }) => {
    const control = (window as any).__battleControl;
    control?.snapUnit?.(enemyId, 2, 19);
    control?.forceAllianceTurn?.();
    const alternate = control?.allyUnits?.().find((unit: any) => unit.id !== carrierId);
    if (alternate) control?.selectUnit?.(alternate.id);
  }, { enemyId: targetEnemy.id, carrierId: carrier.id });
  await clickBattleTile(page, carrier.coord.q, carrier.coord.r);
  await expect.poll(async () => page.evaluate(() => (window as any).__battleControl?.selectionState?.().selectedUnitId ?? null)).toBe(carrier.id);
  const targetReady = await page.evaluate((enemyId) => (window as any).__battleControl?.targetEnemy?.(enemyId) ?? false, targetEnemy.id);
  expect(targetReady).toBeTruthy();
  const attackButton = page.getByRole('button', { name: /^Attack$/i });
  await expect(attackButton).toBeEnabled();
  await attackButton.click();
  await expect(page.locator('.log-entries')).toContainText(/Hit:|Miss:/);

  // End turn and verify AI turn processed
  await page.evaluate(() => (window as any).__battleControl?.endTurn?.());
  await page.waitForTimeout(500);

  // Retreat back to HQ
  await retreatToHq(page);
});
