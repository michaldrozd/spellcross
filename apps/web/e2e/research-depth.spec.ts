import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startFreshCampaign } from './helpers';

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

test('all nine research tiers remain usable at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startFreshCampaign(page);
  await page.getByRole('button', { name: /Research/i }).click();

  await expect(page.locator('.research-card')).toHaveCount(51);
  await expect(page.locator('.research-column-tier-9')).toBeAttached();
  await page.locator('.research-column-tier-9').scrollIntoViewIfNeeded();
  await expect(page.locator('.research-column-tier-9 .research-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
