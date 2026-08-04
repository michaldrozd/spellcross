import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const researchLocaleKeys = (language: 'en' | 'sk') => {
  const locale = JSON.parse(
    readFileSync(resolve(process.cwd(), `apps/web/src/i18n/locales/${language}/research.json`), 'utf8')
  ) as Record<string, { name: string; description: string }>;
  return Object.entries(locale)
    .map(([id, copy]) => `${id}:${copy.name}:${copy.description}`)
    .sort();
};

test('research expansion has exact English and Slovak content parity', () => {
  const english = researchLocaleKeys('en');
  const slovak = researchLocaleKeys('sk');
  expect(english).toHaveLength(51);
  expect(slovak).toHaveLength(51);
  expect(english.map((entry) => entry.split(':', 1)[0])).toEqual(slovak.map((entry) => entry.split(':', 1)[0]));
});

test('all research content remains readable across desktop and phone in both languages', async ({ page }) => {
  const layouts = [
    { language: 'en', width: 1440, height: 900 },
    { language: 'sk', width: 1440, height: 900 },
    { language: 'en', width: 390, height: 844 },
    { language: 'sk', width: 390, height: 844 },
  ] as const;

  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await page.evaluate((language) => window.localStorage.setItem('spellcross:lang', language), layout.language);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__campaignControl));
    await page.evaluate(() => (window as any).__campaignControl.newCampaign(1));
    await page.locator('.hq-tabs .tab').nth(2).click();

    await expect(page.locator('.research-card')).toHaveCount(51);
    await expect(page.locator('.research-column-tier-9')).toBeAttached();
    await page.locator('.research-column-tier-9').scrollIntoViewIfNeeded();
    await expect(page.locator('.research-column-tier-9 .research-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${layout.language} ${layout.width}px page width`)
      .toBe(layout.width);

    const clippedCopy = await page.locator('.research-card p, .research-requirements b, .research-focus strong')
      .evaluateAll((elements) => elements.flatMap((element) => {
        const horizontal = element.scrollWidth > element.clientWidth + 1;
        const vertical = element.scrollHeight > element.clientHeight + 1;
        return horizontal || vertical ? [(element.textContent ?? '').trim()] : [];
      }));
    expect(clippedCopy, `${layout.language} ${layout.width}px clipped research copy`).toEqual([]);

    const projectActions = await page.locator('.research-card button').evaluateAll((buttons) => buttons.map((button) => ({
      label: button.getAttribute('aria-label') ?? '',
      project: button.closest('.research-card')?.querySelector('h4')?.textContent?.trim() ?? '',
    })));
    expect(
      projectActions.filter(({ label, project }) => !label || !project || !label.includes(project)),
      `${layout.language} ${layout.width}px contextual research action names`
    ).toEqual([]);
    expect(
      new Set(projectActions.map(({ label }) => label)).size,
      `${layout.language} ${layout.width}px unique research action names`
    ).toBe(projectActions.length);

    const readyCardIndexes = await page.locator('.research-card').evaluateAll((cards) => cards.flatMap(
      (card, index) => card.classList.contains('ready-node') ? [index] : []
    ).slice(0, 2));
    expect(readyCardIndexes, `${layout.language} ${layout.width}px ready research projects`).toHaveLength(2);
    const firstReadyCard = page.locator('.research-card').nth(readyCardIndexes[0]);
    const secondReadyCard = page.locator('.research-card').nth(readyCardIndexes[1]);
    const firstProject = (await firstReadyCard.locator('h4').textContent())?.trim() ?? '';

    await firstReadyCard.getByRole('button').click();
    await page.locator('.pause-research-btn').click();
    await expect(firstReadyCard).toHaveClass(/paused-node/);
    const resumeLabel = await firstReadyCard.getByRole('button').getAttribute('aria-label');
    expect(resumeLabel, `${layout.language} ${layout.width}px resume project name`).toContain(firstProject);

    await secondReadyCard.getByRole('button').click();
    const pauseThenResumeLabel = await firstReadyCard.getByRole('button').getAttribute('aria-label');
    expect(pauseThenResumeLabel, `${layout.language} ${layout.width}px pause then resume project name`)
      .toContain(firstProject);
    expect(pauseThenResumeLabel).not.toBe(resumeLabel);
  }
});
