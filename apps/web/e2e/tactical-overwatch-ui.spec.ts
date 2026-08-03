import { expect, test } from '@playwright/test';
import { startBattle } from './helpers';

test('overwatch UI shows status after preparing reaction fire', async ({ page }) => {
  test.setTimeout(80_000);
  await startBattle(page, 'sector-lyon');

  const setResult = await page.evaluate(() => (window as any).__battleControl?.setOverwatch?.());
  expect(setResult?.success ?? setResult === true).toBeTruthy();

  await page.evaluate(() => (window as any).__battleControl?.selectUnit?.());

  await expect(page.locator('.badge', { hasText: /Overwatch/i })).toBeVisible();

  const setup = await page.evaluate(() => {
    const control = (window as any).__battleControl;
    const loaded = control.loadDefinitions(['light-infantry', 'dread-fortress']);
    const ally = loaded.loaded.find((unit: any) => unit.faction === 'alliance');
    const enemy = loaded.loaded.find((unit: any) => unit.faction !== 'alliance');
    if (!ally || !enemy) return null;
    for (let r = 1; r < 20; r += 1) {
      for (let q = 1; q < 20; q += 1) {
        const line = [q, q + 1, q + 2, q + 3].map((nextQ) => control.tileAt(nextQ, r));
        if (line.some((tile: any) => !tile?.passable || tile.blocksVision || tile.terrain === 'water' || tile.terrain === 'structure')) {
          continue;
        }
        control.snapUnit(ally.id, q, r);
        control.snapUnit(enemy.id, q + 3, r);
        const path = control.pathForUnit(ally.id, q + 1, r);
        if (!path?.success || path.path.length !== 1) continue;
        control.setHealth(ally.id, 1);
        control.forceAllianceTurn();
        control.selectUnit(ally.id);
        return { allyId: ally.id, target: { q: q + 1, r } };
      }
    }
    return null;
  });
  expect(setup).not.toBeNull();

  const rangeButton = page.locator('.battle-controls button').first();
  await rangeButton.focus();
  expect(await page.evaluate(({ allyId, target }) => (
    (window as any).__battleControl.animateUnitTo(allyId, target.q, target.r)
  ), setup!)).toBe(false);

  let warning = page.getByRole('alertdialog', { name: /Risky move warning/i });
  const cancelMove = warning.getByRole('button', { name: /^Cancel$/i });
  const confirmMove = warning.getByRole('button', { name: /^Move Anyway$/i });
  await expect(cancelMove).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirmMove).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancelMove).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(warning).toBeHidden();
  await expect(rangeButton).toBeFocused();

  expect(await page.evaluate(({ allyId, target }) => (
    (window as any).__battleControl.animateUnitTo(allyId, target.q, target.r)
  ), setup!)).toBe(false);
  warning = page.getByRole('alertdialog', { name: /Risky move warning/i });
  await warning.getByRole('button', { name: /^Cancel$/i }).click();
  await expect(rangeButton).toBeFocused();
});
