import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app/create-app.js';
import { createTemporaryTestConfig } from './fixtures.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('GET /health', () => {
  it('reports that the control server is healthy', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });

    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: 'formcrash-server',
      status: 'ok',
    });
    expect(response.json()).toHaveProperty('timestamp');
  });

  it('allows only the configured dashboard origin', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });

    const allowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:3000' },
    });
    const disallowed = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://malicious.test' },
    });
    await app.close();

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });
});
