const requestedMode = process.env.PLAYWRIGHT_HARDWARE_GPU;

if (requestedMode && requestedMode !== '0' && requestedMode !== '1') {
  throw new Error('PLAYWRIGHT_HARDWARE_GPU must be 0 or 1');
}

const enabled = requestedMode === '1';

if (enabled && process.env.PLAYWRIGHT_HARDWARE_RUNNER !== '1') {
  throw new Error('Use pnpm e2e:hardware to start the Playwright hardware GPU mode');
}

if (enabled && process.platform !== 'linux') {
  throw new Error('The Playwright hardware GPU mode currently supports Linux only');
}

if (enabled && !process.env.DISPLAY) {
  throw new Error('DISPLAY is required for the Playwright hardware GPU mode');
}

if (enabled && !process.env.PLAYWRIGHT_HARDWARE_EVIDENCE_DIR) {
  throw new Error(
    'PLAYWRIGHT_HARDWARE_EVIDENCE_DIR is required for the Playwright hardware GPU mode',
  );
}

/** @type {import('@playwright/test').BrowserTypeLaunchOptions | undefined} */
const launchOptions = enabled
  ? {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH ?? '/usr/bin/google-chrome-stable',
      headless: false,
      ignoreDefaultArgs: ['--use-angle=swiftshader-webgl'],
      args: [
        '--use-angle=gl',
        '--ignore-gpu-blocklist',
        '--enable-gpu-rasterization',
        '--disable-software-rasterizer',
      ],
    }
  : undefined;

const hardwareGpu = Object.freeze({
  enabled,
  headless: !enabled,
  workers: enabled ? 1 : 2,
  reuseExistingServer: !enabled,
  outputDir: enabled ? `${process.env.PLAYWRIGHT_HARDWARE_EVIDENCE_DIR}/test-results` : undefined,
  launchOptions,
});

export default hardwareGpu;
