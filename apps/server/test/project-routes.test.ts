import { afterEach, describe, expect, it } from 'vitest';
import {
  projectExecutionSettingsSchema,
  projectListSchema,
  projectSchema,
} from '@formcrash/contracts';

import { createApp } from '../src/app/create-app.js';
import { createTemporaryTestConfig } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('project API', () => {
  it('creates, lists, and reads a persisted controlled target', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    let app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        name: 'Local account settings',
        targetUrl: 'http://localhost:4300/settings',
        description: 'A controlled local application.',
      },
    });
    expect(createdResponse.statusCode).toBe(201);
    const created = projectSchema.parse(createdResponse.json());
    expect(created).toMatchObject({
      name: 'Local account settings',
      targetUrl: 'http://localhost:4300/settings',
    });

    const activeRecording = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}/recordings/active`,
    });
    expect(activeRecording.statusCode).toBe(200);
    expect(activeRecording.json()).toBeNull();

    const list = projectListSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/projects' })).json(),
    );
    expect(list.items.some((project) => project.id === created.id)).toBe(true);
    expect(
      projectSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/projects/${created.id}`,
          })
        ).json(),
      ),
    ).toEqual(created);

    await app.close();
    apps.splice(apps.indexOf(app), 1);
    app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const afterRestart = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
    });
    expect(afterRestart.statusCode).toBe(200);
    expect(projectSchema.parse(afterRestart.json())).toEqual(created);
  });

  it.each([
    'file:///tmp/target.html',
    'ftp://localhost/target',
    'javascript:alert(1)',
  ])('rejects unsupported target scheme %s', async (targetUrl) => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Invalid target', targetUrl },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_PROJECT' },
    });
  });

  it('returns a focused 404 for an unknown project', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/unknown',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: 'Project was not found.',
      },
    });
  });

  it('persists continuing without sign-in only after the explicit mutation', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    let app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const project = projectSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          payload: {
            name: 'Public journey choice',
            targetUrl: 'http://localhost:4300',
          },
        })
      ).json(),
    );

    const initial = projectExecutionSettingsSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/settings`,
        })
      ).json(),
    );
    expect(initial.authentication.requirement).toBe('unknown');

    const chosen = projectExecutionSettingsSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/authentication/continue-without-sign-in`,
        })
      ).json(),
    );
    expect(chosen.authentication).toMatchObject({
      configured: false,
      available: false,
      requirement: 'user_confirmed_public',
      verification: 'not_checked',
    });

    await app.close();
    apps.splice(apps.indexOf(app), 1);
    app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const afterRestart = projectExecutionSettingsSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/settings`,
        })
      ).json(),
    );
    expect(afterRestart.authentication.requirement).toBe(
      'user_confirmed_public',
    );
  });

  it('deletes an empty external project and removes it from the list', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);
    const created = projectSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          payload: {
            name: 'Disposable target',
            targetUrl: 'https://example.test/disposable',
          },
        })
      ).json(),
    );

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${created.id}`,
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deletedProjectId: created.id });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/projects/${created.id}`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('protects the bundled Sample Checkout project from deletion', async () => {
    const temporary = createTemporaryTestConfig();
    cleanups.push(temporary.cleanup);
    const app = createApp({ config: temporary.config, logger: false });
    apps.push(app);

    for (const suffix of ['', '?force=true']) {
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/projects/project-sample-checkout${suffix}`,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: 'PROTECTED_PROJECT' },
      });
    }
  });
});
