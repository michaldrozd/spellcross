import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import hardwareGpu from './playwright.hardware.mjs';

export default async function verifyHardwareRenderer() {
  if (!hardwareGpu.enabled || !hardwareGpu.launchOptions) return;

  const browser = await chromium.launch(hardwareGpu.launchOptions);
  try {
    const page = await browser.newPage();
    const rendererProof = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!context) throw new Error('WebGL is unavailable');

      const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) throw new Error('WEBGL_debug_renderer_info is unavailable');

      return {
        renderer: String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)),
        vendor: String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)),
        version: String(context.getParameter(context.VERSION)),
      };
    });

    if (!/NVIDIA/i.test(rendererProof.renderer) || /SwiftShader/i.test(rendererProof.renderer)) {
      throw new Error(`Expected an NVIDIA renderer, received: ${rendererProof.renderer}`);
    }

    const evidenceDirectory = process.env.PLAYWRIGHT_HARDWARE_EVIDENCE_DIR;
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      path.join(evidenceDirectory, 'renderer-proof.json'),
      `${JSON.stringify({ ...rendererProof, capturedAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: 'wx' },
    );
  } finally {
    await browser.close();
  }
}
