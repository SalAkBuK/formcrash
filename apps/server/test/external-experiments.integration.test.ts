import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initializePersistence } from '../src/persistence/initialize.js';
import { ExternalExperimentRepository } from '../src/persistence/external-experiment-repository.js';
import { ProjectJourneyRepository } from '../src/persistence/project-journey-repository.js';
import { ProjectSettingsRepository } from '../src/persistence/project-settings-repository.js';
import { OutcomeCheckRepository } from '../src/persistence/outcome-check-repository.js';
import {
  AuthCaptureManager,
  AuthStateStore,
  PlaywrightAuthenticationBrowserOwner,
} from '../src/runner/external/auth-session.js';
import { ExternalExperimentRunner } from '../src/runner/external/external-experiment-runner.js';
import { RequestDiscoveryService } from '../src/runner/external/request-discovery.js';
import { BrowserOwnership } from '../src/runner/infrastructure/browser-ownership.js';
import type { FormCrashDatabase } from '../src/persistence/database.js';
import { createTemporaryTestConfig } from './fixtures.js';
import { createApp } from '../src/app/create-app.js';
import { externalRunComparisonResponseSchema } from '@formcrash/contracts';

const fixtureHtml = readFileSync(
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

let server: Server;
let fixtureUrl: string;
let database: FormCrashDatabase;
let projects: ProjectJourneyRepository;
let settings: ProjectSettingsRepository;
let experiments: ExternalExperimentRepository;
let outcomes: OutcomeCheckRepository;
let createdCount = 0;
const createdRunIds = new Set<string>();
const observedEmailsByRunId = new Map<string, Set<string>>();
let fixtureModeOverride: 'vulnerable' | 'fixed' | null = null;

beforeAll(async () => {
  server = createServer((request, response) => {
    void handleFixtureRequest(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Fixture did not bind.');
  fixtureUrl = `http://127.0.0.1:${address.port}`;
  database = initializePersistence(temporary.config);
  projects = new ProjectJourneyRepository(database.connection);
  settings = new ProjectSettingsRepository(database.connection);
  experiments = new ExternalExperimentRepository(database.connection);
  outcomes = new OutcomeCheckRepository(database.connection);
}, 20_000);

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://fixture.test');
  if (url.pathname === '/api/login' && request.method === 'POST') {
    response.writeHead(204, {
      'set-cookie':
        'fixture_session=authenticated; Path=/; HttpOnly; SameSite=Lax',
    });
    response.end();
    return;
  }
  if (url.pathname === '/api/session') {
    return sendJson(response, 200, {
      authenticated: hasAuthentication(request),
    });
  }
  if (
    url.pathname === '/api/reset' &&
    ['POST', 'DELETE'].includes(request.method ?? '')
  ) {
    createdCount = 0;
    createdRunIds.clear();
    if (request.method === 'POST') observedEmailsByRunId.clear();
    await readBody(request);
    return sendJson(response, 200, { reset: true });
  }
  if (url.pathname === '/api/profile' && request.method === 'POST') {
    if (!hasAuthentication(request))
      return sendJson(response, 401, { error: 'unauthorized' });
    const body = JSON.parse(await readBody(request)) as {
      readonly mode?: string;
      readonly runId?: string;
      readonly email?: string;
    };
    if (body.runId !== undefined && body.email !== undefined) {
      const emails = observedEmailsByRunId.get(body.runId) ?? new Set<string>();
      emails.add(body.email);
      observedEmailsByRunId.set(body.runId, emails);
    }
    if (body.mode !== 'fixed' || !createdRunIds.has(body.runId ?? '')) {
      createdCount += 1;
      createdRunIds.add(body.runId ?? '');
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    return sendJson(response, 201, { createdCount });
  }
  if (url.pathname === '/api/invitations' && request.method === 'POST') {
    if (!hasAuthentication(request))
      return sendJson(response, 401, { error: 'unauthorized' });
    await readBody(request);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return sendJson(response, 201, { invited: true });
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(
    fixtureModeOverride === null
      ? fixtureHtml
      : fixtureHtml.replace(
          "const mode = parameters.get('mode') === 'fixed' ? 'fixed' : 'vulnerable';",
          `const mode = '${fixtureModeOverride}';`,
        ),
  );
}

afterAll(async () => {
  database.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  temporary.cleanup();
});

describe.sequential('external impatient-user experiments in Chromium', () => {
  it('captures authentication, reloads it, and discovers a target request', async () => {
    const configured = await configureScenario('vulnerable');
    const reloadedStore = new AuthStateStore(
      temporary.config.artifactRoot,
      settings,
    );
    const storagePath = reloadedStore.usablePath(configured.projectId);

    expect(storagePath).not.toBeNull();
    expect(existsSync(storagePath ?? '')).toBe(true);
    expect(readFileSync(storagePath ?? '', 'utf8')).toContain(
      'fixture_session',
    );
    expect(readFileSync(storagePath ?? '', 'utf8')).not.toContain(
      'RuntimePasswordOnly',
    );

    const discovery = await new RequestDiscoveryService(
      temporary.config,
      projects,
      settings,
      reloadedStore,
      new BrowserOwnership(),
    ).discover({
      journeyId: configured.journeyId,
      targetStepId: configured.targetStepId,
      variables: { SECRET_PASSWORD: 'RuntimePasswordOnly' },
      recipe: {
        type: 'duplicate_action',
        triggerCount: 2,
        intervalMs: 0,
      },
    });

    expect(discovery.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          pathname: '/api/profile',
          status: 201,
          occurrences: 1,
        }),
      ]),
    );
    expect(
      discovery.candidates.some(
        (candidate) => candidate.pathname === '/api/reset',
      ),
    ).toBe(false);
    expect(discovery.recommendation.outcome).toBe('recommended');
    expect(discovery.recommendation.recommendedCandidateId).toBe(
      discovery.candidates[0]?.candidateId,
    );
    expect(
      discovery.candidates.find((candidate) => candidate.recommended),
    ).toMatchObject({
      method: 'POST',
      pathname: '/api/profile',
      classification: 'likely_business_mutation',
      confidence: 'high',
      rank: 1,
    });
    expect(
      discovery.candidates.find(
        (candidate) =>
          candidate.method === 'GET' && candidate.pathname === '/api/profile',
      ),
    ).toMatchObject({
      classification: 'background_refresh',
      recommended: false,
    });
    const recommendationSet = discovery.assertionRecommendationSets.find(
      (set) =>
        set.selectedRequestCandidateId ===
        discovery.recommendation.recommendedCandidateId,
    );
    expect(recommendationSet?.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'request_count',
          defaultEnabled: true,
        }),
        expect.objectContaining({
          category: 'success_interface',
          defaultEnabled: false,
        }),
      ]),
    );
    expect(JSON.stringify(discovery)).not.toContain('RuntimePasswordOnly');
  }, 45_000);

  it('requires explicit selection for ambiguous mutations and fabricates no candidate when the action sends none', async () => {
    const ambiguous = await configureScenario('vulnerable', 'ambiguous');
    const ambiguousDiscovery = await discoverScenario(ambiguous);

    expect(ambiguousDiscovery.recommendation).toMatchObject({
      outcome: 'ambiguous',
      recommendedCandidateId: null,
    });
    expect(
      ambiguousDiscovery.candidates.filter(
        (candidate) => candidate.classification === 'likely_business_mutation',
      ),
    ).toHaveLength(2);
    expect(
      ambiguousDiscovery.candidates.some((candidate) => candidate.recommended),
    ).toBe(false);

    const noRequest = await configureScenario('vulnerable', 'none');
    const noRequestDiscovery = await discoverScenario(noRequest);

    expect(noRequestDiscovery.recommendation).toMatchObject({
      outcome: 'no_candidate',
      recommendedCandidateId: null,
    });
    expect(
      noRequestDiscovery.candidates.some((candidate) => candidate.recommended),
    ).toBe(false);
  }, 45_000);

  it('proves the same compatible experiment failed before and passed after the fixture fix', async () => {
    const vulnerable = projects
      .listProjects()
      .find((project) => project.name === 'External vulnerable');
    if (vulnerable === undefined)
      throw new Error('Vulnerable project is missing.');
    const vulnerableJourney = projects.listJourneys(vulnerable.id)[0];
    if (vulnerableJourney === undefined)
      throw new Error('Vulnerable journey is missing.');
    const vulnerableVersion = createVersion(vulnerableJourney.id);
    const vulnerableRun = await createRunner().run(vulnerableVersion.id, {
      SECRET_PASSWORD: 'RuntimePasswordOnly',
    });
    const vulnerableGeneratedEmail = onlyObservedGeneratedEmail(
      vulnerableRun.runId,
    );

    expect(vulnerableRun.status).toBe('failed');
    expect(vulnerableRun.lifecycleStatus).toBe('completed');
    expect(vulnerableRun.outcomeAggregate).toBe('failed');
    expect(vulnerableRun.presentation).toMatchObject({
      primaryStatus: 'failed',
      headline: 'Failed: The expected result appeared twice instead of once.',
      approvedExpectedOutcomeDescription:
        'Exactly one profile matching the generated email should appear.',
      expectedCondition: { kind: 'visible_match_count', count: 1 },
      observedCondition: { kind: 'visible_match_count', count: 2 },
      technicalDetailsAvailable: { assertions: true, screenshots: true },
    });
    expect(
      vulnerableRun.presentation.observations.map((item) => item.text),
    ).toEqual(
      expect.arrayContaining([
        'FormCrash triggered "Save profile" twice.',
        'Two matching requests completed successfully.',
        'Two visible results matched the approved generated identity.',
      ]),
    );
    expect(vulnerableRun.presentation.unknowns).toContain(
      'FormCrash did not inspect the application database or hidden backend state.',
    );
    expect(JSON.stringify(vulnerableRun.presentation)).not.toContain(
      'two database records',
    );
    expect(vulnerableRun.outcomeCheckResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'matching_item_appears_exactly_once',
          status: 'failed',
          observedCount: 2,
        }),
        expect.objectContaining({
          type: 'visible_element_exists',
          status: 'passed',
        }),
        expect.objectContaining({
          type: 'final_pathname_matches',
          status: 'passed',
        }),
      ]),
    );
    expect(
      vulnerableRun.outcomeCheckResults.find(
        (result) => result.type === 'matching_item_appears_exactly_once',
      )?.evidenceReferences.screenshotArtifactIds,
    ).toHaveLength(3);
    expect(vulnerableRun.triggerAttempts).toBe(2);
    expect(vulnerableRun.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assertionId: 'request-max-one',
          status: 'failed',
        }),
      ]),
    );
    expect(
      vulnerableRun.networkObservations.filter((item) => item.matched),
    ).toHaveLength(2);
    expect(vulnerableRun.artifacts.map((item) => item.label)).toEqual([
      'before-disruption',
      'after-disruption',
      'final-result',
    ]);
    expect(JSON.stringify(vulnerableRun)).not.toContain('RuntimePasswordOnly');
    expect(vulnerableRun.events.map((event) => event.sequence)).toEqual(
      vulnerableRun.events.map((_event, index) => index + 1),
    );

    fixtureModeOverride = 'fixed';
    const fixedDiscovery = await discoverScenario({
      projectId: vulnerable.id,
      journeyId: vulnerableJourney.id,
      targetStepId: vulnerableVersion.targetStepId,
    });
    const submitStateRecommendation = fixedDiscovery.assertionRecommendationSets
      .find(
        (set) =>
          set.selectedRequestCandidateId ===
          fixedDiscovery.recommendation.recommendedCandidateId,
      )
      ?.recommendations.find((item) => item.category === 'submit_state');
    expect(submitStateRecommendation?.assertion).toMatchObject({
      type: 'element_disabled',
      observationWindow: 'during_repeated_action',
    });
    const fixedVersion = createVersion(vulnerableJourney.id);
    const fixedRun = await createRunner().run(fixedVersion.id, {
      SECRET_PASSWORD: 'AnotherRuntimePassword',
    });
    const fixedGeneratedEmail = onlyObservedGeneratedEmail(fixedRun.runId);

    expect(fixedRun.status).toBe('passed');
    expect(fixedRun.lifecycleStatus).toBe('completed');
    expect(fixedRun.outcomeAggregate).toBe('passed');
    expect(fixedRun.presentation).toMatchObject({
      primaryStatus: 'passed',
      headline: 'Passed: The intended result occurred exactly once.',
      approvedExpectedOutcomeDescription:
        'Exactly one profile matching the generated email should appear.',
      expectedCondition: { kind: 'visible_match_count', count: 1 },
      observedCondition: { kind: 'visible_match_count', count: 1 },
      technicalDetailsAvailable: { assertions: true, screenshots: true },
    });
    expect(
      fixedRun.presentation.observations.map((item) => item.text),
    ).toContain('One visible result matched the approved generated identity.');
    expect(fixedRun.outcomeCheckResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'matching_item_appears_exactly_once',
          status: 'passed',
          observedCount: 1,
        }),
      ]),
    );
    expect(fixedRun.triggerAttempts).toBe(2);
    expect(
      fixedRun.networkObservations.filter((item) => item.matched),
    ).toHaveLength(1);
    expect(
      fixedRun.assertions.every((assertion) => assertion.status === 'passed'),
    ).toBe(true);
    expect(JSON.stringify(fixedRun)).not.toContain('AnotherRuntimePassword');

    const persisted = experiments.getRun(fixedRun.runId);
    expect(persisted).toEqual(fixedRun);
    const generatedEmails = [vulnerableGeneratedEmail, fixedGeneratedEmail];
    const persistedRows = database.connection
      .prepare(
        `SELECT *
           FROM external_runs WHERE id IN (?, ?)`,
      )
      .all(vulnerableRun.runId, fixedRun.runId);
    const persistedEvents = database.connection
      .prepare(`SELECT * FROM external_run_events WHERE run_id IN (?, ?)`)
      .all(vulnerableRun.runId, fixedRun.runId);
    const persistedAssertions = database.connection
      .prepare(
        `SELECT * FROM external_assertion_results WHERE run_id IN (?, ?)`,
      )
      .all(vulnerableRun.runId, fixedRun.runId);
    const persistedOutcomeRows = database.connection
      .prepare(
        `SELECT *
           FROM external_outcome_check_results WHERE run_id IN (?, ?)`,
      )
      .all(vulnerableRun.runId, fixedRun.runId);
    const persistedArtifacts = database.connection
      .prepare(`SELECT * FROM external_artifacts WHERE run_id IN (?, ?)`)
      .all(vulnerableRun.runId, fixedRun.runId);
    const durablePayload = JSON.stringify({
      runs: persistedRows,
      events: persistedEvents,
      assertions: persistedAssertions,
      outcomeResults: persistedOutcomeRows,
      artifactMetadata: persistedArtifacts,
    });
    const serializedResponses = JSON.stringify([vulnerableRun, fixedRun]);
    database.connection.pragma('wal_checkpoint(TRUNCATE)');
    const sqliteBytes = readFileSync(temporary.config.databasePath);
    for (const generatedEmail of generatedEmails) {
      expect(durablePayload).not.toContain(generatedEmail);
      expect(serializedResponses).not.toContain(generatedEmail);
      expect(sqliteBytes.includes(Buffer.from(generatedEmail))).toBe(false);
    }
    expect(durablePayload).toContain('{{unique.email}}');
    expect(durablePayload).toContain(
      'visible item(s) matched the approved generated identity',
    );
    expect(fixedRun.assertionAggregate).toBe('passed');
    expect(fixedRun.assertions).toHaveLength(4);

    const app = createApp({ config: temporary.config, logger: false });
    const comparisonResponse = await app.inject({
      method: 'POST',
      url: '/api/external-run-comparisons',
      payload: {
        beforeRunId: vulnerableRun.runId,
        afterRunId: fixedRun.runId,
      },
    });
    await app.close();
    expect(comparisonResponse.statusCode).toBe(200);
    const comparison = externalRunComparisonResponseSchema.parse(
      comparisonResponse.json(),
    );
    expect(comparison).toMatchObject({
      compatibility: 'compatible',
      primaryStatus: 'protection_verified',
      presentation: {
        headline: 'Repeated-submission protection verified.',
        successfulRequestCounts: { before: 2, after: 1 },
        failureRecipe: { triggerCount: 2 },
      },
    });
    expect(comparison.presentation?.unknowns).toEqual(
      expect.arrayContaining([
        'Database state was not inspected.',
        'Hidden backend records or side effects were not evaluated.',
      ]),
    );
    expect(
      comparison.presentation?.checks.find(
        (check) => check.type === 'matching_item_appears_exactly_once',
      ),
    ).toMatchObject({
      beforeStatus: 'failed',
      afterStatus: 'passed',
      expectedCondition: { kind: 'visible_match_count', count: 1 },
      beforeObservedCondition: { kind: 'visible_match_count', count: 2 },
      afterObservedCondition: { kind: 'visible_match_count', count: 1 },
    });
    expect(comparison.presentation?.checks.map((check) => check.type)).toEqual([
      'matching_item_appears_exactly_once',
      'visible_element_exists',
      'final_pathname_matches',
    ]);
    expect(
      comparison.presentation?.screenshots.every(
        (pair) => pair.before !== null && pair.after !== null,
      ),
    ).toBe(true);
    expect(JSON.stringify(comparison)).not.toContain(vulnerableGeneratedEmail);
    expect(JSON.stringify(comparison)).not.toContain(fixedGeneratedEmail);
    expect(JSON.stringify(comparison)).not.toMatch(
      /database duplicate|backend idempotency|root cause was resolved/iu,
    );
  }, 45_000);
});

type ConfiguredScenario = {
  readonly projectId: string;
  readonly journeyId: string;
  readonly targetStepId: string;
};

async function configureScenario(
  mode: 'vulnerable' | 'fixed',
  requestShape: 'single' | 'ambiguous' | 'none' = 'single',
): Promise<ConfiguredScenario> {
  const scenarioName =
    requestShape === 'single' ? mode : `${mode}-${requestShape}`;
  const project = projects.createProject({
    name: `External ${scenarioName}`,
    targetUrl: `${fixtureUrl}/protected?auth=required&mode=${mode}&requestShape=${requestShape}`,
    description: `${scenarioName} authenticated fixture`,
  });
  const targetStepId = `${scenarioName}-submit`;
  const journey = projects.saveJourney({
    projectId: project.id,
    name: `${scenarioName} authenticated profile`,
    steps: [
      step(
        project.targetUrl,
        `${scenarioName}-name`,
        'fill',
        { strategy: 'data-formcrash', value: 'display-name' },
        { kind: 'safe', value: 'Ada Lovelace' },
      ),
      step(
        project.targetUrl,
        `${scenarioName}-email`,
        'fill',
        { strategy: 'data-testid', value: 'email' },
        { kind: 'safe', value: '{{var.CUSTOMER_EMAIL}}' },
      ),
      step(
        project.targetUrl,
        `${scenarioName}-run`,
        'fill',
        { strategy: 'data-testid', value: 'run-id' },
        { kind: 'safe', value: '{{var.RUN_KEY}}' },
      ),
      step(
        project.targetUrl,
        `${scenarioName}-password`,
        'fill',
        { strategy: 'id', value: 'password' },
        { kind: 'sensitive', variableName: 'SECRET_PASSWORD' },
        true,
      ),
      step(
        project.targetUrl,
        targetStepId,
        'submit',
        { strategy: 'data-testid', value: 'profile-form' },
        null,
      ),
    ],
    metadata: {
      recordingSessionId: null,
      recordedAt: new Date().toISOString(),
      warningCount: 0,
      normalizationRule: 'Integration fixture journey.',
    },
  });
  const criticalAction = outcomes.approveCriticalAction(journey, {
    stepId: targetStepId,
    label: 'Save profile',
  });
  const outcomeTarget = {
    locator: { strategy: 'data-formcrash' as const, value: 'profile-result' },
    fingerprint: {
      tagName: 'li',
      dataFormcrash: 'profile-result',
      dataTestId: null,
      id: null,
      role: null,
      accessibleName: null,
      name: null,
      cssPath: '#profile-results > li',
    },
    preview: 'Profile generated email',
    reliability: 'high' as const,
    warnings: [],
    generatedBindings: [
      {
        expression: 'unique.email' as const,
        template: '{{unique.email}}' as const,
        label: 'Unique email',
      },
    ],
  };
  outcomes.saveOutcomeCheck({
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'matching_item_appears_exactly_once',
    description:
      'Exactly one profile matching the generated email should appear.',
    target: outcomeTarget,
    binding: outcomeTarget.generatedBindings[0]!,
  });
  outcomes.saveOutcomeCheck({
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'visible_element_exists',
    description: 'A profile result should be visible.',
    target: outcomeTarget,
  });
  outcomes.saveOutcomeCheck({
    journeyId: journey.id,
    criticalActionId: criticalAction.id,
    type: 'final_pathname_matches',
    description: 'The profile form pathname should remain visible.',
    expectedPathname: '/protected',
  });
  settings.save(project.id, {
    variables: [
      {
        name: 'CUSTOMER_EMAIL',
        secret: false,
        description: 'Per-run email',
        template: '{{unique.email}}',
      },
      {
        name: 'RUN_KEY',
        secret: false,
        description: 'Idempotency key',
        template: '{{run.id}}',
      },
      {
        name: 'SECRET_PASSWORD',
        secret: true,
        description: 'Ephemeral password',
        template: null,
      },
    ],
    beforeRunHook: {
      method: 'POST',
      url: `${fixtureUrl}/api/reset`,
      headers: { 'x-run-id': '{{run.id}}' },
      body: { runId: '{{run.id}}' },
      timeoutMs: 2_000,
    },
    afterRunHook: {
      method: 'DELETE',
      url: `${fixtureUrl}/api/reset`,
      headers: {},
      body: null,
      timeoutMs: 2_000,
    },
  });
  const ownership = new BrowserOwnership();
  const store = new AuthStateStore(temporary.config.artifactRoot, settings);
  const captures = new AuthCaptureManager(
    temporary.config,
    projects,
    settings,
    store,
    ownership,
    new PlaywrightAuthenticationBrowserOwner(async (page) => {
      await page.getByTestId('login').click();
      await page.getByText('Signed in', { exact: true }).waitFor();
    }),
  );
  const capture = await captures.start(project.id);
  expect(capture.status).toBe('awaiting_confirmation');
  const completed = await captures.confirm(capture.id);
  expect(completed.status).toBe('completed');
  expect(ownership.activeWorkload).toBeNull();
  return { projectId: project.id, journeyId: journey.id, targetStepId };
}

async function discoverScenario(configured: ConfiguredScenario) {
  return new RequestDiscoveryService(
    temporary.config,
    projects,
    settings,
    new AuthStateStore(temporary.config.artifactRoot, settings),
    new BrowserOwnership(),
  ).discover({
    journeyId: configured.journeyId,
    targetStepId: configured.targetStepId,
    variables: { SECRET_PASSWORD: 'RuntimePasswordOnly' },
    recipe: {
      type: 'duplicate_action',
      triggerCount: 2,
      intervalMs: 0,
    },
  });
}

function createVersion(journeyId: string) {
  const journey = projects.getJourney(journeyId);
  if (journey === null) throw new Error('Journey is missing.');
  return experiments.createVersion({
    projectId: journey.projectId,
    journey,
    request: {
      name: 'Double submit safety',
      targetStepId: journey.steps.at(-1)?.id ?? '',
      triggerCount: 2,
      intervalMs: 0,
      networkMatcher: {
        method: 'POST',
        pathname: '/api/profile',
        host: new URL(fixtureUrl).host,
      },
      assertions: [
        {
          id: 'request-max-one',
          type: 'network_request_max',
          maximum: 1,
          description: 'No more than one create request is sent.',
        },
        {
          id: 'success-max-one',
          type: 'network_success_max',
          maximum: 1,
          description: 'No more than one create succeeds.',
        },
        {
          id: 'expected-created',
          type: 'network_expected_status',
          expectedStatus: 201,
          description: 'The create succeeds.',
        },
        {
          id: 'completion-visible',
          type: 'text_appeared',
          text: 'Profile fixture completed.',
          description: 'Completion UI appears.',
        },
      ],
      continueAfterTarget: false,
      requestSelectionProvenance: null,
    },
  });
}

function createRunner(): ExternalExperimentRunner {
  return new ExternalExperimentRunner(
    temporary.config,
    projects,
    settings,
    new AuthStateStore(temporary.config.artifactRoot, settings),
    experiments,
    new BrowserOwnership(),
    undefined,
    outcomes,
  );
}

function step(
  url: string,
  id: string,
  type: 'fill' | 'submit',
  locator: {
    readonly strategy: 'data-formcrash' | 'data-testid' | 'id';
    readonly value: string;
  },
  value:
    | { readonly kind: 'safe'; readonly value: string }
    | { readonly kind: 'sensitive'; readonly variableName: string }
    | null,
  sensitive = false,
) {
  return {
    id,
    name: id,
    type,
    timestamp: Date.now(),
    url,
    locator,
    fingerprint: null,
    value,
    sensitive,
  } as const;
}

function onlyObservedGeneratedEmail(runId: string): string {
  const emails = [...(observedEmailsByRunId.get(runId) ?? [])];
  if (emails.length !== 1 || emails[0] === undefined) {
    throw new Error(
      `Expected exactly one generated email for fixture run ${runId}.`,
    );
  }
  return emails[0];
}

function hasAuthentication(request: IncomingMessage): boolean {
  return (
    request.headers.cookie?.includes('fixture_session=authenticated') === true
  );
}

async function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => chunks.push(chunk));
    request.on('end', () => resolve(chunks.join('')));
    request.on('error', reject);
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
