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

  const strategicMapTargetMetrics = async () => page.evaluate(() => {
    const targets = [...document.querySelectorAll<SVGCircleElement>('.territory-hit-area')];
    const measured = targets.map((target) => {
      const bounds = target.getBoundingClientRect();
      const center = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      const expectedOwner = target.closest('.territory-marker')?.getAttribute('aria-label');
      const actualOwner = document.elementFromPoint(center.x, center.y)
        ?.closest('.territory-marker')?.getAttribute('aria-label');
      return { bounds, center, expectedOwner, actualOwner };
    });
    let minimumCenterDistance = Infinity;
    for (let first = 0; first < measured.length; first += 1) {
      for (let second = first + 1; second < measured.length; second += 1) {
        minimumCenterDistance = Math.min(
          minimumCenterDistance,
          Math.hypot(
            measured[first].center.x - measured[second].center.x,
            measured[first].center.y - measured[second].center.y,
          ),
        );
      }
    }
    return {
      documentWidth: document.documentElement.scrollWidth,
      minimumWidth: Math.min(...measured.map(({ bounds }) => bounds.width)),
      minimumHeight: Math.min(...measured.map(({ bounds }) => bounds.height)),
      minimumCenterDistance,
      wrongCenterOwnerCount: measured.filter(({ expectedOwner, actualOwner }) => expectedOwner !== actualOwner).length,
    };
  });

  const expectMapTargets = async (documentWidth: number) => {
    await expect.poll(() => strategicMapTargetMetrics().then((metrics) => metrics.documentWidth)).toBe(documentWidth);
    await expect.poll(() => strategicMapTargetMetrics().then((metrics) => metrics.minimumWidth)).toBeGreaterThanOrEqual(24);
    await expect.poll(() => strategicMapTargetMetrics().then((metrics) => metrics.minimumHeight)).toBeGreaterThanOrEqual(24);
    await expect.poll(() => strategicMapTargetMetrics().then((metrics) => metrics.minimumCenterDistance)).toBeGreaterThanOrEqual(24);
    await expect.poll(() => strategicMapTargetMetrics().then((metrics) => metrics.wrongCenterOwnerCount)).toBe(0);
  };

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
  await expectMapTargets(1280);

  const paris = page.locator('.territory-marker').filter({ hasText: 'Paris' });
  const lyon = page.locator('.territory-marker').filter({ hasText: 'Lyon' });
  await expect(paris).toHaveRole('button');
  await expect(paris).toHaveAttribute('aria-pressed', 'true');
  await expect(paris).toHaveAttribute('aria-label', /Paris Outskirts, Available, 5 TURNS/i);

  await page.getByRole('button', { name: /European Front/i }).focus();
  await page.keyboard.press('Tab');
  await expect(paris).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(lyon).toBeFocused();
  await expect.poll(() => lyon.locator('.territory-hit-area').evaluate((node) => {
    const style = getComputedStyle(node);
    return { stroke: style.stroke, strokeWidth: style.strokeWidth };
  })).toEqual({ stroke: 'rgb(248, 213, 107)', strokeWidth: '0.34px' });
  await page.keyboard.press('Enter');
  await expect(lyon).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /Lyon Industrial Zone/i })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.strategic-map-svg').scrollIntoViewIfNeeded();
  await expectMapTargets(390);
  const vienna = page.locator('.territory-marker').filter({ hasText: 'Vienna' });
  const krakow = page.locator('.territory-marker').filter({ hasText: 'Krakow' });
  await vienna.locator('.territory-hit-area').click();
  await expect(vienna).toHaveAttribute('aria-pressed', 'true');
  await krakow.locator('.territory-hit-area').click();
  await expect(krakow).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => window.localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.getByRole('button', { name: /Pokračovať/i }).click();
  await page.locator('.strategic-map-svg').scrollIntoViewIfNeeded();
  await expectMapTargets(390);
  const viennaSk = page.locator('.territory-marker').filter({ hasText: 'Viedeň' });
  const krakowSk = page.locator('.territory-marker').filter({ hasText: 'Krakov' });
  await viennaSk.locator('.territory-hit-area').click();
  await expect(viennaSk).toHaveAttribute('aria-pressed', 'true');
  await krakowSk.locator('.territory-hit-area').click();
  await expect(krakowSk).toHaveAttribute('aria-pressed', 'true');

  await page.setViewportSize({ width: 1280, height: 720 });
  await expectMapTargets(1280);
  const brussels = page.locator('.territory-marker').filter({ hasText: 'Brusel' });
  await expect(brussels).toHaveAttribute('aria-label', /Bruselské velenie, Dostupné, 5 KÔL/i);
  await brussels.focus();
  await page.keyboard.press('Space');
  await expect(brussels).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /Bruselské velenie/i })).toBeVisible();
});
