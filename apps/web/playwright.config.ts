import { defineConfig, devices } from '@playwright/test';

// Lightweight placeholder config so `pnpm exec playwright test` succeeds during scaffolding.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/smoke.spec.ts',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    headless: true,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
