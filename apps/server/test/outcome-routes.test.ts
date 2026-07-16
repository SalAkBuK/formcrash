import { afterEach, describe, expect, it } from 'vitest';
import {
  criticalActionSchema,
  criticalActionResponseSchema,
  outcomeCheckListSchema,
} from '@formcrash/contracts';

import { createApp } from '../src/app/create-app.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { createTemporaryTestConfig } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
const cleanups: Array<() => void> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Outcome definition routes', () => {
  it('approves and retrieves a server-owned Critical Action', async () => {
    const seeded = seedJourney();
    const app = createApp({ config: seeded.config, logger: false });
    apps.push(app);

    expect(
      criticalActionResponseSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `/api/journeys/${seeded.journeyId}/critical-action`,
          })
        ).json(),
      ).criticalAction,
    ).toBeNull();

    const approvedResponse = await app.inject({
      method: 'PUT',
      url: `/api/journeys/${seeded.journeyId}/critical-action`,
      payload: { stepId: 'submit', label: 'Submit Tenant' },
    });
    expect(approvedResponse.statusCode).toBe(200);
    expect(criticalActionSchema.parse(approvedResponse.json())).toMatchObject({
      journeyId: seeded.journeyId,
      stepId: 'submit',
      label: 'Submit Tenant',
    });

    const checks = await app.inject({
      method: 'GET',
      url: `/api/journeys/${seeded.journeyId}/outcome-checks`,
    });
    expect(outcomeCheckListSchema.parse(checks.json()).items).toEqual([]);
  });

  it('rejects an unsupported Critical Action step type', async () => {
    const seeded = seedJourney();
    const app = createApp({ config: seeded.config, logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/journeys/${seeded.journeyId}/critical-action`,
      payload: { stepId: 'email', label: 'Tenant email' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'INVALID_CRITICAL_ACTION' },
    });
  });
});

function seedJourney() {
  const temporary = createTemporaryTestConfig();
  cleanups.push(temporary.cleanup);
  const database = initializePersistence(temporary.config);
  const projects = new ProjectJourneyRepository(database.connection);
  const project = projects.createProject({
    name: 'Tenant target',
    targetUrl: 'http://localhost:4300',
    description: '',
  });
  const journey = projects.saveJourney({
    projectId: project.id,
    name: 'Add Tenant',
    steps: [
      {
        id: 'email',
        name: 'Fill email',
        type: 'fill',
        timestamp: 1,
        url: project.targetUrl,
        locator: { strategy: 'name', value: 'email' },
        fingerprint: fingerprint('input', 'email'),
        value: { kind: 'safe', value: 'tenant@example.test' },
        sensitive: false,
      },
      {
        id: 'submit',
        name: 'Submit Tenant',
        type: 'submit',
        timestamp: 2,
        url: project.targetUrl,
        locator: { strategy: 'data-testid', value: 'tenant-form' },
        fingerprint: fingerprint('form', 'tenant-form'),
        value: null,
        sensitive: false,
      },
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: '2026-07-17T00:00:00.000Z',
      warningCount: 0,
      normalizationRule: 'Route test journey.',
    },
  });
  database.close();
  return { config: temporary.config, journeyId: journey.id };
}

function fingerprint(tagName: string, id: string) {
  return {
    tagName,
    inputType: tagName === 'input' ? 'email' : null,
    dataFormcrash: null,
    dataTestId: id,
    id,
    role: tagName === 'form' ? 'form' : 'textbox',
    accessibleName: id,
    name: id,
    label: id,
    text: null,
    cssPath: `#${id}`,
  };
}
