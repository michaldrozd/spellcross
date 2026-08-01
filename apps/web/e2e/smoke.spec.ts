import { expect, test } from '@playwright/test';

test('loads strategic view', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  const compactMenuGeometry = async () => page.evaluate(async () => {
    const menu = document.querySelector<HTMLElement>('.main-menu');
    const logo = document.querySelector<HTMLElement>('.menu-logo');
    const title = document.querySelector<HTMLElement>('.menu-logo h1');
    const footer = document.querySelector<HTMLElement>('.menu-footer');
    if (!menu || !logo || !title || !footer) return null;

    menu.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const menuTop = menu.getBoundingClientRect();
    const logoTop = logo.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();

    menu.scrollTop = menu.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const menuBottom = menu.getBoundingClientRect();
    const footerBottom = footer.getBoundingClientRect();

    return {
      documentWidth: document.documentElement.scrollWidth,
      logoReachable: logoTop.top >= menuTop.top,
      titleContained: titleBounds.left >= menuTop.left && titleBounds.right <= menuTop.right,
      footerReachable: footerBottom.bottom <= menuBottom.bottom + 0.5,
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(compactMenuGeometry).toEqual({
    documentWidth: 390,
    logoReachable: true,
    titleContained: true,
    footerReachable: true,
  });

  await page.locator('.menu-lang-btn').nth(1).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('spellcross:lang'))).toBe('sk');
  await expect.poll(compactMenuGeometry).toEqual({
    documentWidth: 390,
    logoReachable: true,
    titleContained: true,
    footerReachable: true,
  });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk');

  await page.setViewportSize({ width: 728, height: 375 });
  await expect.poll(compactMenuGeometry).toEqual({
    documentWidth: 728,
    logoReachable: true,
    titleContained: true,
    footerReachable: true,
  });

  await page.locator('.menu-lang-btn').nth(0).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(compactMenuGeometry).toEqual({
    documentWidth: 728,
    logoReachable: true,
    titleContained: true,
    footerReachable: true,
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForFunction(() => Boolean((window as any).__campaignControl));
  await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));

  await expect(page.getByRole('heading', { name: /Field HQ/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /OPS\s+Territories/i })).toBeVisible();
  await expect(page.locator('.strategic-map-svg')).toBeVisible();
});
