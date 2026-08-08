import { defineConfig, devices } from '@playwright/test';
import hardwareGpu from '../../playwright.hardware.mjs';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';
const devPort = new URL(baseURL).port || '5173';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: hardwareGpu.outputDir,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: hardwareGpu.workers,
  globalSetup: hardwareGpu.enabled ? '../../playwright.hardware.setup.mjs' : undefined,
  use: {
    baseURL,
    headless: hardwareGpu.headless,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    launchOptions: hardwareGpu.launchOptions
  },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${devPort}`,
    url: baseURL,
    reuseExistingServer: hardwareGpu.reuseExistingServer,
    timeout: 120_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
