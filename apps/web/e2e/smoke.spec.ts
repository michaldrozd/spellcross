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
    const overlays = [...document.querySelectorAll('.map-theater-switch, .map-status-strip, .map-legend')]
      .map((element) => element.getBoundingClientRect());
    let overlayOverlapCount = 0;
    for (let first = 0; first < overlays.length; first += 1) {
      for (let second = first + 1; second < overlays.length; second += 1) {
        if (overlays[first].right > overlays[second].left && overlays[first].left < overlays[second].right
          && overlays[first].bottom > overlays[second].top && overlays[first].top < overlays[second].bottom) {
          overlayOverlapCount += 1;
        }
      }
    }
    const overlapsOverlay = (element: Element) => {
      const bounds = element.getBoundingClientRect();
      return overlays.some((overlay) => bounds.right > overlay.left && bounds.left < overlay.right
        && bounds.bottom > overlay.top && bounds.top < overlay.bottom);
    };
    return {
      documentWidth: document.documentElement.scrollWidth,
      minimumWidth: Math.min(...measured.map(({ bounds }) => bounds.width)),
      minimumHeight: Math.min(...measured.map(({ bounds }) => bounds.height)),
      wrongCenterOwnerCount: measured.filter(({ expectedOwner, actualOwner }) => expectedOwner !== actualOwner).length,
      labelOverlayOverlapCount: [...document.querySelectorAll('.territory-name')].filter(overlapsOverlay).length,
      targetOverlayOverlapCount: targets.filter(overlapsOverlay).length,
      overlayOverlapCount,
      hitRadius: Number(targets[0]?.getAttribute('r') ?? 0),
    };
  });

  const expectMapTargets = async (documentWidth: number, checkOverlays = false) => {
    await expect.poll(async () => {
      const metrics = await strategicMapTargetMetrics();
      return {
        documentWidth: metrics.documentWidth,
        targetsMeetMinimum: metrics.minimumWidth >= 24 && metrics.minimumHeight >= 24,
        wrongCenterOwnerCount: metrics.wrongCenterOwnerCount,
        labelOverlayOverlapCount: checkOverlays ? metrics.labelOverlayOverlapCount : 0,
        targetOverlayOverlapCount: checkOverlays ? metrics.targetOverlayOverlapCount : 0,
        overlayOverlapCount: checkOverlays ? metrics.overlayOverlapCount : 0,
        desktopRadiusUnchanged: checkOverlays || Math.abs(metrics.hitRadius - 3.2) < 0.001,
      };
    }).toEqual({
      documentWidth,
      targetsMeetMinimum: true,
      wrongCenterOwnerCount: 0,
      labelOverlayOverlapCount: 0,
      targetOverlayOverlapCount: 0,
      overlayOverlapCount: 0,
      desktopRadiusUnchanged: true,
    });
  };

  const expectMobileMapLayouts = async () => {
    const layouts = [
      { width: 320, height: 568 },
      { width: 360, height: 800 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 390, height: 844, rootFontSize: 24 },
    ];
    for (const layout of layouts) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate((rootFontSize) => {
        if (rootFontSize) document.documentElement.style.fontSize = `${rootFontSize}px`;
        else document.documentElement.style.removeProperty('font-size');
      }, layout.rootFontSize);
      await page.locator('.strategic-map-svg').scrollIntoViewIfNeeded();
      await expectMapTargets(layout.width, true);
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.strategic-map-svg').scrollIntoViewIfNeeded();
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

  await expectMobileMapLayouts();
  await expectMapTargets(390, true);
  const vienna = page.locator('.territory-marker').filter({ hasText: 'Vienna' });
  const krakow = page.locator('.territory-marker').filter({ hasText: 'Krakow' });
  await vienna.locator('.territory-hit-area').click();
  await expect(vienna).toHaveAttribute('aria-pressed', 'true');
  await krakow.locator('.territory-hit-area').click();
  await expect(krakow).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => window.localStorage.setItem('spellcross:lang', 'sk'));
  await page.reload();
  await page.getByRole('button', { name: /Pokračovať/i }).click();
  await expectMobileMapLayouts();
  await expectMapTargets(390, true);
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
