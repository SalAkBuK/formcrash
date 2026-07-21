import { describe, expect, it } from 'vitest';

import type {
  OutcomeCheck,
  OutcomeCheckRunSnapshot,
  ReplayLocator,
} from '@formcrash/contracts';

import {
  aggregateOutcomeChecks,
  evaluateOutcomeChecks,
  focusOutcomeEvidence,
  normalizePathname,
} from '../src/runner/outcomes/outcome-evaluator.js';
import { resolveRuntime } from '../src/runner/external/runtime-values.js';
import type { ReplayBrowserSession } from '../src/runner/recording/external-browser.js';

const now = '2026-07-17T00:00:00.000Z';
const locator = {
  strategy: 'data-formcrash',
  value: 'profile-result',
} as const;
const target = {
  locator,
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

describe('Outcome Check evaluator', () => {
  it.each([
    [1, 'passed'],
    [0, 'failed'],
    [2, 'failed'],
  ] as const)(
    'evaluates exact-once visible count %i as %s',
    async (count, status) => {
      const session = fakeSession(count);
      const result = await evaluateOutcomeChecks({
        ...context(session),
        snapshot: snapshot(exactlyOnce()),
      });

      expect(result[0]).toMatchObject({
        status,
        expectedCount: 1,
        observedCount: count,
        templateBinding: { template: '{{unique.email}}' },
        unknowns: [expect.stringContaining('database records')],
      });
      expect(session.lastContainingText).toMatch(/^formcrash\+/u);
      expect(JSON.stringify(result)).not.toContain(session.lastContainingText);
    },
  );

  it('resolves a parameterized generated-identity locator only in memory', async () => {
    const session = fakeSession(1);
    const check = exactlyOnce();
    if (check.type !== 'matching_item_appears_exactly_once') {
      throw new Error('Expected an exactly-once Outcome Check fixture.');
    }
    await evaluateOutcomeChecks({
      ...context(session),
      snapshot: snapshot({
        ...check,
        target: {
          ...check.target,
          locator: {
            strategy: 'role',
            role: 'row',
            name: 'Tenant {{unique.email}}',
          },
        },
      }),
    });

    expect(session.lastLocator?.strategy).toBe('role');
    if (session.lastLocator?.strategy !== 'role') {
      throw new Error('Expected the resolved role locator.');
    }
    expect(session.lastLocator.role).toBe('row');
    expect(session.lastLocator.name).toMatch(/^Tenant formcrash\+/u);
    expect(JSON.stringify(session.lastLocator)).not.toContain(
      '{{unique.email}}',
    );
  });

  it('centers the unique generated-identity match before final evidence capture', async () => {
    const session = fakeSession(1);
    const runtime = context(session).runtime;

    await expect(
      focusOutcomeEvidence({
        snapshot: snapshot(exactlyOnce()),
        session,
        runtime,
      }),
    ).resolves.toBe(true);

    expect(session.lastFocusedLocator).toEqual(locator);
    expect(session.lastFocusedContainingText).toMatch(/^formcrash\+/u);
  });

  it.each([
    [1, 'passed'],
    [0, 'failed'],
  ] as const)(
    'evaluates visible element count %i as %s',
    async (count, status) => {
      const result = await evaluateOutcomeChecks({
        ...context(fakeSession(count)),
        snapshot: snapshot(visibleElement()),
      });
      expect(result[0]).toMatchObject({ status, observedCount: count });
    },
  );

  it('turns locator exceptions into could_not_verify', async () => {
    const result = await evaluateOutcomeChecks({
      ...context(fakeSession(0, true)),
      snapshot: snapshot(visibleElement()),
    });
    expect(result[0]).toMatchObject({
      status: 'could_not_verify',
      observedCount: null,
    });
  });

  it.each([exactlyOnce(), visibleElement()])(
    'does not infer $type when the visible-match limit truncates evaluation',
    async (check) => {
      const result = await evaluateOutcomeChecks({
        ...context(fakeSession(1, false, undefined, true)),
        snapshot: snapshot(check),
      });

      expect(result[0]).toMatchObject({
        status: 'could_not_verify',
        observedCount: null,
        observed: {
          verified: false,
          examinedLocatorMatchCount: 100,
          evaluationLimit: 100,
        },
      });
      expect(result[0]?.reason).toContain('More than 100 elements');
    },
  );

  it('normalizes pathnames while ignoring origin, query, and fragment', async () => {
    expect(normalizePathname('https://example.test/profiles?tab=1#saved')).toBe(
      '/profiles',
    );
    const result = await evaluateOutcomeChecks({
      ...context(fakeSession(0, false, 'https://other.test/profiles?q=2#x')),
      snapshot: snapshot(pathname()),
    });
    expect(result[0]).toMatchObject({
      status: 'passed',
      expected: { pathname: '/profiles' },
      observed: { pathname: '/profiles' },
    });
  });

  it('treats an unreadable browser URL as could_not_verify', async () => {
    const result = await evaluateOutcomeChecks({
      ...context(fakeSession(0, false, 'not a browser URL')),
      snapshot: snapshot(pathname()),
    });
    expect(result[0]?.status).toBe('could_not_verify');
  });

  it('keeps outcome aggregation independent and deterministic', () => {
    expect(aggregateOutcomeChecks([])).toBe('not_configured');
    expect(aggregateOutcomeChecks([{ status: 'passed' }] as never)).toBe(
      'passed',
    );
    expect(
      aggregateOutcomeChecks([{ status: 'could_not_verify' }] as never),
    ).toBe('could_not_verify');
    expect(
      aggregateOutcomeChecks([
        { status: 'could_not_verify' },
        { status: 'failed' },
      ] as never),
    ).toBe('failed');
  });
});

function context(session: TestSession) {
  const journey = {
    id: 'journey-1',
    projectId: 'project-1',
    name: 'Create profile v1',
    version: 1,
    steps: [
      {
        id: 'save',
        name: 'Save profile',
        type: 'submit' as const,
        timestamp: 0,
        url: 'https://example.test/profiles',
        locator: { strategy: 'id' as const, value: 'form' },
        fingerprint: null,
        value: null,
        sensitive: false,
      },
    ],
    recordingMetadata: {
      recordingSessionId: null,
      recordedAt: now,
      warningCount: 0,
      normalizationRule: 'test',
    },
    createdAt: now,
  };
  return {
    runId: 'run-1',
    session,
    runtime: resolveRuntime({
      runId: '00000000-0000-0000-0000-000000000001',
      journey,
      declarations: [],
      ephemeral: {},
      hooks: [],
    }),
    events: [],
    observations: [],
    artifacts: [],
  };
}

function snapshot(check: OutcomeCheck): OutcomeCheckRunSnapshot {
  return {
    criticalAction: {
      id: 'action-1',
      journeyId: 'journey-1',
      stepId: 'save',
      label: 'Save profile',
      createdAt: now,
      updatedAt: now,
    },
    checks: [check],
  };
}

function exactlyOnce(): OutcomeCheck {
  return {
    id: 'check-exactly-once',
    journeyId: 'journey-1',
    criticalActionId: 'action-1',
    type: 'matching_item_appears_exactly_once',
    description: 'Exactly one generated profile should appear.',
    target,
    binding: target.generatedBindings[0]!,
    createdAt: now,
  };
}

function visibleElement(): OutcomeCheck {
  return {
    id: 'check-visible',
    journeyId: 'journey-1',
    criticalActionId: 'action-1',
    type: 'visible_element_exists',
    description: 'The result list should be visible.',
    target,
    createdAt: now,
  };
}

function pathname(): OutcomeCheck {
  return {
    id: 'check-path',
    journeyId: 'journey-1',
    criticalActionId: 'action-1',
    type: 'final_pathname_matches',
    description: 'The final pathname should match.',
    expectedPathname: '/profiles',
    createdAt: now,
  };
}

type TestSession = ReplayBrowserSession & {
  lastContainingText?: string;
  lastFocusedContainingText?: string;
  lastFocusedLocator?: ReplayLocator;
  lastLocator?: ReplayLocator;
};

function fakeSession(
  count: number,
  fail = false,
  currentUrl: string | undefined = 'https://example.test/profiles',
  truncated = false,
): TestSession {
  const session: TestSession = {
    navigate: () => Promise.resolve(),
    click: () => Promise.resolve(),
    fill: () => Promise.resolve(),
    setChecked: () => Promise.resolve(),
    select: () => Promise.resolve(),
    submit: () => Promise.resolve(),
    triggerRepeated: () => Promise.resolve(),
    observeNetwork: () => undefined,
    captureScreenshot: () => Promise.resolve(),
    setScreenshotMasks: () => undefined,
    isVisible: () => Promise.resolve(count > 0),
    countVisibleMatches: (
      resolvedLocator: ReplayLocator,
      containingText?: string,
    ) => {
      session.lastLocator = resolvedLocator;
      if (containingText !== undefined) {
        session.lastContainingText = containingText;
      }
      return fail
        ? Promise.reject(new Error('stale target'))
        : Promise.resolve({
            visibleCount: count,
            examinedCount: truncated ? 100 : count,
            totalLocatorMatchCount: truncated ? 101 : count,
            truncated,
          });
    },
    focusUniqueVisibleMatch: (
      resolvedLocator: ReplayLocator,
      containingText?: string,
    ) => {
      session.lastFocusedLocator = resolvedLocator;
      if (containingText !== undefined) {
        session.lastFocusedContainingText = containingText;
      }
      return Promise.resolve(!fail && !truncated && count === 1);
    },
    isDisabled: () => Promise.resolve(false),
    textVisible: () => Promise.resolve(false),
    inputValue: () => Promise.resolve(null),
    currentUrl: () => currentUrl ?? 'https://example.test/profiles',
    settle: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return session;
}
