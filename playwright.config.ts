import { defineConfig, devices } from '@playwright/test';
import hardwareGpu from './playwright.hardware.mjs';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: hardwareGpu.outputDir,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  workers: hardwareGpu.workers,
  globalSetup: hardwareGpu.enabled ? './playwright.hardware.setup.mjs' : undefined,
  use: {
    headless: hardwareGpu.headless,
    baseURL,
    trace: 'retain-on-failure',
    video: 'off',
    launchOptions: hardwareGpu.launchOptions
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseUrl ? undefined : {
    command: 'pnpm --filter @spellcross/web dev --host --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: hardwareGpu.reuseExistingServer,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000
  }
});
