import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  workers: 2,
  use: {
    headless: true,
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    video: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @spellcross/web dev --host --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000
  }
});
