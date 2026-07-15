import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/create-app.js';

const app = createApp({
  config: {
    host: '127.0.0.1',
    logLevel: 'silent',
    port: 4100,
    varDirectory: './var',
  },
  logger: false,
});

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports that the control server is healthy', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: 'formcrash-server',
      status: 'ok',
    });
    expect(response.json()).toHaveProperty('timestamp');
  });
});
