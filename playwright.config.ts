import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: [
    '**/smoke.spec.ts',
    '**/full-flow.spec.ts',
    '**/campaign-deep.spec.ts',
    '**/tactical-play.spec.ts',
    '**/tactical-pathing.spec.ts',
    '**/tactical-varied.spec.ts',
    '**/weather-stealth-ai.spec.ts',
    '**/tactical-destructible-ui.spec.ts',
    '**/campaign-longplay.spec.ts',
    '**/ammo-supply.spec.ts',
    '**/counterattack-event.spec.ts',
    '**/supply-truck.spec.ts',
    '**/transport-embark.spec.ts',
    '**/tactical-combat-combined.spec.ts',
    '**/tactical-combat-ui.spec.ts',
    '**/strategic-raid.spec.ts',
    '**/late-game-content.spec.ts',
    '**/tactical-overwatch-ui.spec.ts',
    '**/ai-behavior.spec.ts',
    '**/autosave-summary.spec.ts',
    '**/tactical-move-click.spec.ts'
  ],
  timeout: 20_000,
  expect: { timeout: 5_000 },
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
