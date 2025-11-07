import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'pnpm preview',
    cwd: '.',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ]
});

