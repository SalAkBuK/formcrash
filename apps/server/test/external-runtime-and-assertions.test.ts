import { describe, expect, it } from 'vitest';

import type {
  ExternalAssertion,
  ExternalNetworkObservation,
  PersistedJourney,
  ReplayLocator,
} from '@formcrash/contracts';

import { RunEventLog } from '../src/runner/engine/event-log.js';
import { evaluateExternalAssertions } from '../src/runner/external/assertions.js';
import {
  NetworkEvidenceCollector,
  matchesRequest,
} from '../src/runner/external/network-evidence.js';
import {
  InvalidTemplateError,
  resolveRuntime,
  resolveTemplate,
} from '../src/runner/external/runtime-values.js';
import type { MissingRuntimeVariablesError } from '../src/runner/external/runtime-values.js';
import type {
  NetworkObservation,
  ReplayBrowserSession,
} from '../src/runner/recording/external-browser.js';

describe('external runtime values and safe templates', () => {
  it('resolves unique values once per run and excludes secrets from the safe snapshot', () => {
    const runtime = resolveRuntime({
      runId: '11111111-2222-3333-4444-555555555555',
      journey: journey([
        step('email', '{{var.EMAIL}}'),
        sensitiveStep('password', 'SECRET_PASSWORD'),
      ]),
      declarations: [
        {
          name: 'EMAIL',
          secret: false,
          description: '',
          template: '{{unique.email}}',
        },
        {
          name: 'SECRET_PASSWORD',
          secret: true,
          description: '',
          template: null,
        },
      ],
      ephemeral: { SECRET_PASSWORD: 'never-persist-this' },
      hooks: [],
    });

    const first = resolveTemplate(
      '{{unique.email}}',
      runtime.values,
      runtime.context,
    );
    const second = resolveTemplate(
      '{{unique.email}}',
      runtime.values,
      runtime.context,
    );
    expect(first).toBe(second);
    expect(first).toContain(runtime.context.shortId);
    expect(
      resolveTemplate('{{unique.name}}', runtime.values, runtime.context),
    ).toBe(runtime.context.uniqueName);
    expect(
      resolveTemplate('{{unique.phone}}', runtime.values, runtime.context),
    ).toBe(runtime.context.uniquePhone);
    expect(
      resolveTemplate('{{unique.text}}', runtime.values, runtime.context),
    ).toBe(runtime.context.uniqueText);
    expect(runtime.safeSnapshot).toEqual({ EMAIL: first });
    expect(JSON.stringify(runtime.safeSnapshot)).not.toContain(
      'never-persist-this',
    );
  });

  it('rejects unknown templates and reports only variables used by the execution', () => {
    expect(() =>
      resolveTemplate('{{random.uuid}}', new Map(), {
        runId: 'run',
        shortId: 'short',
        timestamp: new Date(0).toISOString(),
        uniqueEmail: 'unique@example.test',
        uniqueName: 'FormCrash Test',
        uniquePhone: '+15550000000',
        uniqueText: 'FC-test',
      }),
    ).toThrow(InvalidTemplateError);

    expect(() =>
      resolveRuntime({
        runId: 'run-id',
        journey: journey([sensitiveStep('password', 'PASSWORD')]),
        declarations: [
          { name: 'API_TOKEN', secret: true, description: '', template: null },
        ],
        ephemeral: {},
        hooks: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MissingRuntimeVariablesError>>({
        missingVariables: ['PASSWORD'],
      }),
    );
  });

  it('does not require an unused declaration', () => {
    expect(() =>
      resolveRuntime({
        runId: 'run-id',
        journey: journey([step('name', 'Ada')]),
        declarations: [
          {
            name: 'UNUSED_SECRET',
            secret: true,
            description: '',
            template: null,
          },
        ],
        ephemeral: {},
        hooks: [],
      }),
    ).not.toThrow();
  });
});

describe('external network evidence', () => {
  it('matches method and pathname while ignoring query parameters by default', () => {
    const matcher = { method: 'POST', pathname: '/api/profile', host: null };
    expect(
      matchesRequest(
        matcher,
        'post',
        new URL('https://example.test/api/profile?attempt=2'),
      ),
    ).toBe(true);
    expect(
      matchesRequest(
        matcher,
        'GET',
        new URL('https://example.test/api/profile'),
      ),
    ).toBe(false);
    expect(
      matchesRequest(
        matcher,
        'POST',
        new URL('https://example.test/api/other'),
      ),
    ).toBe(false);

    const collector = new NetworkEvidenceCollector(matcher);
    const observations: NetworkObservation[] = [
      {
        kind: 'started',
        requestId: 'one',
        method: 'POST',
        url: 'https://example.test/api/profile?one=1',
        timestampMs: Date.now(),
      },
      {
        kind: 'completed',
        requestId: 'one',
        status: 201,
        failed: false,
        timestampMs: Date.now() + 1,
      },
      {
        kind: 'started',
        requestId: 'two',
        method: 'POST',
        url: 'https://example.test/api/profile?two=2',
        timestampMs: Date.now() + 2,
      },
      {
        kind: 'completed',
        requestId: 'two',
        status: 500,
        failed: false,
        timestampMs: Date.now() + 3,
      },
    ];
    for (const observation of observations) collector.observe(observation);
    expect(collector.snapshot().every((item) => item.matched)).toBe(true);
    expect(collector.discoveryCandidates()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          pathname: '/api/profile',
          status: 201,
        }),
        expect.objectContaining({
          method: 'POST',
          pathname: '/api/profile',
          status: 500,
        }),
      ]),
    );
  });
});

describe('external assertions', () => {
  it('passes and fails request and successful-response maximums', async () => {
    const results = await evaluate([
      {
        id: 'requests-one',
        type: 'network_request_max',
        maximum: 1,
        description: 'one request',
      },
      {
        id: 'requests-two',
        type: 'network_request_max',
        maximum: 2,
        description: 'two requests',
      },
      {
        id: 'success-zero',
        type: 'network_success_max',
        maximum: 0,
        description: 'zero success',
      },
      {
        id: 'success-one',
        type: 'network_success_max',
        maximum: 1,
        description: 'one success',
      },
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'failed',
      'passed',
      'failed',
      'passed',
    ]);
  });

  it('detects mixed success and server-error responses', async () => {
    const results = await evaluate([
      {
        id: 'exact-two',
        type: 'network_request_exact',
        expected: 2,
        description: 'two attempts',
      },
      {
        id: 'exact-one-success',
        type: 'network_success_exact',
        expected: 1,
        description: 'one success',
      },
      {
        id: 'all-created',
        type: 'network_all_status',
        allowedStatuses: [201],
        description: 'all created',
      },
      {
        id: 'no-server-errors',
        type: 'network_no_server_errors',
        description: 'no 5xx',
      },
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'passed',
      'passed',
      'failed',
      'failed',
    ]);
  });

  it('evaluates visible, disabled, missing element and final URL outcomes explicitly', async () => {
    const results = await evaluate([
      elementAssertion('visible-pass', 'element_visible', '#visible'),
      elementAssertion('visible-fail', 'element_visible', '#missing'),
      elementAssertion('disabled-pass', 'element_disabled', '#disabled'),
      elementAssertion('disabled-fail', 'element_disabled', '#visible'),
      {
        id: 'url-pass',
        type: 'final_url_contains',
        value: '/complete',
        description: 'completed URL',
      },
      {
        id: 'url-fail',
        type: 'final_url_not_contains',
        value: '/complete',
        description: 'not complete URL',
      },
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'passed',
      'failed',
      'passed',
      'failed',
      'passed',
      'failed',
    ]);
    expect(results[1]?.observedDescription).toContain('missing or not visible');
  });
});

async function evaluate(assertions: readonly ExternalAssertion[]) {
  const runtime = resolveRuntime({
    runId: 'assertion-run',
    journey: journey([step('value', 'safe')]),
    declarations: [],
    ephemeral: {},
    hooks: [],
  });
  return evaluateExternalAssertions({
    assertions,
    session: new AssertionSession(),
    observations: networkObservations(),
    runtime,
    events: new RunEventLog('assertion-run'),
  });
}

class AssertionSession implements ReplayBrowserSession {
  navigate(): Promise<void> {
    return Promise.resolve();
  }
  click(): Promise<void> {
    return Promise.resolve();
  }
  fill(): Promise<void> {
    return Promise.resolve();
  }
  setChecked(): Promise<void> {
    return Promise.resolve();
  }
  select(): Promise<void> {
    return Promise.resolve();
  }
  submit(): Promise<void> {
    return Promise.resolve();
  }
  triggerRepeated(): Promise<void> {
    return Promise.resolve();
  }
  observeNetwork(): void {}
  captureScreenshot(): Promise<void> {
    return Promise.resolve();
  }
  setScreenshotMasks(): void {}
  isVisible(locator: ReplayLocator): Promise<boolean> {
    return Promise.resolve(
      locator.strategy === 'css' && locator.value === '#visible',
    );
  }
  isDisabled(locator: ReplayLocator): Promise<boolean> {
    return Promise.resolve(
      locator.strategy === 'css' && locator.value === '#disabled',
    );
  }
  textVisible(): Promise<boolean> {
    return Promise.resolve(true);
  }
  inputValue(): Promise<string | null> {
    return Promise.resolve(null);
  }
  currentUrl(): string {
    return 'https://example.test/complete';
  }
  settle(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function elementAssertion(
  id: string,
  type: 'element_visible' | 'element_disabled',
  selector: string,
): ExternalAssertion {
  return {
    id,
    type,
    locator: { strategy: 'css', value: selector },
    targetDescription: selector,
    description: id,
  };
}

function networkObservations(): readonly ExternalNetworkObservation[] {
  return [
    {
      requestId: 'one',
      method: 'POST',
      pathname: '/api/profile',
      origin: 'https://example.test',
      startedAtMs: 0,
      completedAtMs: 1,
      status: 201,
      failed: false,
      matched: true,
    },
    {
      requestId: 'two',
      method: 'POST',
      pathname: '/api/profile',
      origin: 'https://example.test',
      startedAtMs: 2,
      completedAtMs: 3,
      status: 500,
      failed: false,
      matched: true,
    },
  ];
}

function journey(steps: PersistedJourney['steps']): PersistedJourney {
  return {
    id: 'journey',
    projectId: 'project',
    name: 'Journey',
    version: 1,
    steps,
    recordingMetadata: {
      recordingSessionId: null,
      recordedAt: new Date(0).toISOString(),
      warningCount: 0,
      normalizationRule: 'test',
    },
    createdAt: new Date(0).toISOString(),
  };
}

function step(id: string, value: string): PersistedJourney['steps'][number] {
  return {
    id,
    name: id,
    type: 'fill',
    timestamp: 0,
    url: 'https://example.test',
    locator: { strategy: 'id', value: id },
    fingerprint: null,
    value: { kind: 'safe', value },
    sensitive: false,
  };
}

function sensitiveStep(
  id: string,
  variableName: string,
): PersistedJourney['steps'][number] {
  return {
    ...step(id, ''),
    value: { kind: 'sensitive', variableName },
    sensitive: true,
  };
}
