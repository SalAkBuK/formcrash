import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';

import type { FormCrashDatabase } from '../src/persistence/database.js';
import { initializePersistence } from '../src/persistence/initialize.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { AuthStateStore } from '../src/runner/external/auth-session.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import { OutcomeCaptureManager } from '../src/runner/outcomes/outcome-capture-manager.js';
import { PlaywrightExternalBrowserOwner } from '../src/runner/recording/external-browser.js';
import { createTemporaryTestConfig } from './fixtures.js';

const externalHtml = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../fixtures/external-target/index.html',
  ),
  'utf8',
);
const temporary = createTemporaryTestConfig({
  browserHeadless: true,
  browserTimeoutMs: 10_000,
});

let fixtureServer: Server;
let fixtureUrl: string;
let database: FormCrashDatabase;

beforeAll(async () => {
  fixtureServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      request.url?.startsWith('/outcome-passive') === true
        ? passiveOutcomeHtml
        : externalHtml,
    );
  });
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  const address = fixtureServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Outcome fixture did not bind.');
  }
  fixtureUrl = `http://127.0.0.1:${address.port}`;
  database = initializePersistence(temporary.config);
});

afterAll(async () => {
  database.close();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  temporary.cleanup();
});

describe.sequential('real Chromium Outcome Check capture', () => {
  it('captures the fixture result row with a generated email binding', async () => {
    const projects = new ProjectJourneyRepository(database.connection);
    const settings = new ProjectSettingsRepository(database.connection);
    const outcomes = new OutcomeCheckRepository(database.connection);
    const project = projects.createProject({
      name: 'Outcome fixture',
      targetUrl: fixtureUrl,
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Create profile',
      steps: [
        {
          id: 'fill-name',
          name: 'Fill display name',
          type: 'fill',
          timestamp: 1,
          url: fixtureUrl,
          locator: {
            strategy: 'data-formcrash',
            value: 'display-name',
          },
          fingerprint: fingerprint('input', 'display-name', 'Display name'),
          value: { kind: 'safe', value: 'Recorded Person' },
          sensitive: false,
        },
        {
          id: 'fill-email',
          name: 'Fill unique email',
          type: 'fill',
          timestamp: 2,
          url: fixtureUrl,
          locator: { strategy: 'data-testid', value: 'email' },
          fingerprint: fingerprint('input', 'email', 'Unique email'),
          value: { kind: 'safe', value: 'recorded@example.test' },
          sensitive: false,
        },
        {
          id: 'submit-profile',
          name: 'Save profile',
          type: 'submit',
          timestamp: 3,
          url: fixtureUrl,
          locator: { strategy: 'data-testid', value: 'profile-form' },
          fingerprint: fingerprint('form', 'profile-form', 'Profile form'),
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-17T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'Integration journey.',
      },
    });
    outcomes.approveCriticalAction(journey, {
      stepId: 'submit-profile',
      label: 'Save profile',
    });
    let page: Page | null = null;
    const ownership = new BrowserOwnership();
    const manager = new OutcomeCaptureManager(
      temporary.config,
      projects,
      settings,
      new AuthStateStore(temporary.config.artifactRoot, settings),
      outcomes,
      ownership,
      new PlaywrightExternalBrowserOwner(undefined, (created) => {
        page = created;
      }),
    );

    const capture = await manager.start(journey.id, {});
    expect(capture.status).toBe('awaiting_selection');
    if (page === null) throw new Error('Replay page was not exposed.');
    expect(
      await (page as Page).getByText(/FormCrash outcome capture:/u).isVisible(),
    ).toBe(true);
    await (page as Page).locator('[data-formcrash="profile-result"]').click();
    const selected = await waitForSelection(manager, capture.id);

    expect(
      await (page as Page)
        .getByText(/Result selected\. Return to the dashboard/u)
        .isVisible(),
    ).toBe(true);

    expect(selected.selectedTarget?.locator).toEqual({
      strategy: 'data-formcrash',
      value: 'profile-result',
    });
    expect(selected.selectedTarget?.preview).toContain('{{unique.email}}');
    expect(
      selected.selectedTarget?.generatedBindings.some(
        (binding) => binding.expression === 'unique.email',
      ),
    ).toBe(true);
    const saved = await manager.approve(capture.id, {
      type: 'matching_item_appears_exactly_once',
      description: 'Exactly one profile row should appear.',
      bindingExpression: 'unique.email',
    });
    expect(saved.type).toBe('matching_item_appears_exactly_once');
    expect(JSON.stringify(saved)).not.toMatch(
      /formcrash\+[a-f0-9]{12}@example\.test/u,
    );
    await manager.close(capture.id);
    expect(ownership.activeWorkload).toBeNull();
  }, 20_000);

  it('captures passive result text after full-page and SPA navigation', async () => {
    const projects = new ProjectJourneyRepository(database.connection);
    const settings = new ProjectSettingsRepository(database.connection);
    const outcomes = new OutcomeCheckRepository(database.connection);
    const project = projects.createProject({
      name: 'Passive outcome fixture',
      targetUrl: fixtureUrl,
      description: '',
    });
    const journey = projects.saveJourney({
      projectId: project.id,
      name: 'Open passive outcome',
      steps: [
        {
          id: 'open-details',
          name: 'Open profile form',
          type: 'click',
          timestamp: 1,
          url: fixtureUrl,
          locator: { strategy: 'data-testid', value: 'details-link' },
          fingerprint: fingerprint('a', 'details-link', 'Open profile form'),
          value: null,
          sensitive: false,
        },
      ],
      metadata: {
        recordingSessionId: null,
        recordedAt: '2026-07-20T00:00:00.000Z',
        warningCount: 0,
        normalizationRule: 'Passive outcome integration journey.',
      },
    });
    outcomes.approveCriticalAction(journey, {
      stepId: 'open-details',
      label: 'Open profile form',
    });
    let page: Page | null = null;
    const ownership = new BrowserOwnership();
    const manager = new OutcomeCaptureManager(
      temporary.config,
      projects,
      settings,
      new AuthStateStore(temporary.config.artifactRoot, settings),
      outcomes,
      ownership,
      new PlaywrightExternalBrowserOwner(undefined, (created) => {
        page = created;
      }),
    );

    const capture = await manager.start(journey.id, {});
    expect(capture.status).toBe('awaiting_selection');
    if (page === null) throw new Error('Replay page was not exposed.');

    await (page as Page).goto(`${fixtureUrl}/outcome-passive`);
    await (page as Page)
      .getByRole('cell', { name: 'Northwind tenant' })
      .click();
    const fullPageSelection = await waitForSelection(
      manager,
      capture.id,
      'Northwind tenant',
    );
    expect(fullPageSelection.status).toBe('selection_ready');
    expect(fullPageSelection.selectedTarget?.locator).toEqual({
      strategy: 'role',
      role: 'cell',
      name: 'Northwind tenant',
    });

    await (page as Page).evaluate(() => {
      window.history.pushState({}, '', '/outcome-spa');
      document.body.innerHTML =
        '<main><section><span>Release candidate ready</span></section></main>';
    });
    await (page as Page)
      .getByText('Release candidate ready', { exact: true })
      .click();
    const spaSelection = await waitForSelection(
      manager,
      capture.id,
      'Release candidate ready',
    );
    expect(spaSelection.status).toBe('selection_ready');
    expect(spaSelection.selectedTarget?.locator).toEqual({
      strategy: 'text',
      value: 'Release candidate ready',
    });

    await manager.close(capture.id);
    expect(ownership.activeWorkload).toBeNull();
  }, 20_000);
});

async function waitForSelection(
  manager: OutcomeCaptureManager,
  captureId: string,
  expectedPreview?: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const capture = await manager.get(captureId);
    if (
      capture?.status === 'selection_ready' ||
      capture?.status === 'selection_rejected'
    ) {
      if (
        expectedPreview === undefined ||
        capture.selectedTarget?.preview.includes(expectedPreview) === true
      ) {
        return capture;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Outcome selection did not arrive.');
}

const passiveOutcomeHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Passive outcome fixture</title></head>
  <body>
    <main>
      <h1>Tenant results</h1>
      <table><tbody><tr><td>Northwind tenant</td></tr></tbody></table>
    </main>
  </body>
</html>`;

function fingerprint(tagName: string, id: string, label: string) {
  return {
    tagName,
    inputType: tagName === 'input' ? 'text' : null,
    dataFormcrash: null,
    dataTestId: id,
    id,
    role: tagName === 'form' ? 'form' : 'textbox',
    accessibleName: label,
    name: id,
    label,
    text: null,
    cssPath: `#${id}`,
  };
}
