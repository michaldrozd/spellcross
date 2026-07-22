import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const devPort = new URL(baseURL).port || '5173';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: 2,
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${devPort}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
