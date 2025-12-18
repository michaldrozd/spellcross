import { afterEach, describe, expect, it } from 'vitest';

import { createServer } from './index.js';

describe('service server', () => {
  const disposables: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(disposables.map((dispose) => dispose()));
    disposables.length = 0;
  });

  it('returns a healthy status', async () => {
    const app = createServer();
    disposables.push(() => app.close());

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
