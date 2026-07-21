import { describe, expect, it } from 'vitest';

import type { PersistedJourney } from '@formcrash/contracts';

import { guidedStepValueOverrides } from '../src/features/projects/models/guided-values';
import { assessJourneyReadiness } from '../src/features/projects/models/journey-readiness';

const journey: PersistedJourney = {
  id: 'journey-1',
  projectId: 'project-1',
  name: 'Create resident',
  version: 1,
  steps: [
    {
      id: 'fill-email',
      name: 'Fill email',
      type: 'fill',
      timestamp: 0,
      url: 'https://example.test/residents',
      locator: { strategy: 'name', value: 'email' },
      fingerprint: {
        tagName: 'input',
        inputType: 'email',
        dataFormcrash: null,
        dataTestId: null,
        id: null,
        role: 'textbox',
        accessibleName: 'Email',
        name: 'email',
        label: 'Email',
        text: null,
        cssPath: 'input[name="email"]',
      },
      value: { kind: 'safe', value: 'existing@example.test' },
      sensitive: false,
    },
    {
      id: 'fill-slot-code',
      name: 'Fill Slot Code *',
      type: 'fill',
      timestamp: 1,
      url: 'https://example.test/residents',
      locator: { strategy: 'name', value: 'slotCode' },
      fingerprint: {
        tagName: 'input',
        inputType: 'text',
        dataFormcrash: null,
        dataTestId: null,
        id: 'slot-code',
        role: 'textbox',
        accessibleName: 'Slot Code *',
        name: 'slotCode',
        label: 'Slot Code *',
        text: null,
        cssPath: 'input[name="slotCode"]',
      },
      value: { kind: 'safe', value: 'test-233' },
      sensitive: false,
    },
    {
      id: 'fill-password',
      name: 'Fill password',
      type: 'fill',
      timestamp: 2,
      url: 'https://example.test/residents',
      locator: { strategy: 'name', value: 'password' },
      fingerprint: null,
      value: { kind: 'sensitive', variableName: 'PASSWORD' },
      sensitive: true,
    },
    {
      id: 'submit',
      name: 'Submit resident',
      type: 'submit',
      timestamp: 3,
      url: 'https://example.test/residents',
      locator: { strategy: 'data-testid', value: 'resident-form' },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-16T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-16T00:00:00.000Z',
};

describe('test configuration models', () => {
  it('blocks setup only for genuine missing requirements', () => {
    const targetStep =
      journey.steps.find((step) => step.id === 'submit') ?? null;
    const blocked = assessJourneyReadiness({
      journey,
      targetStep,
      runtimeRequirements: [
        { name: 'PASSWORD', label: 'Password', secret: true },
      ],
      runtimeValues: {},
      generatedValueCount: 1,
      authenticationAvailable: true,
      cleanupConfigured: true,
      production: false,
    });
    const ready = assessJourneyReadiness({
      journey,
      targetStep,
      runtimeRequirements: [
        { name: 'PASSWORD', label: 'Password', secret: true },
      ],
      runtimeValues: { PASSWORD: 'runtime-only' },
      generatedValueCount: 1,
      authenticationAvailable: true,
      cleanupConfigured: true,
      production: false,
    });

    expect(blocked.status).toBe('blocked');
    expect(blocked.items).toContainEqual(
      expect.objectContaining({ id: 'runtime', level: 'blocker' }),
    );
    expect(ready.status).toBe('ready');
    expect(ready.blockerCount).toBe(0);
  });

  it('generates unique values for recognized recorded fields', () => {
    expect(guidedStepValueOverrides(journey)).toEqual({
      'fill-email': '{{unique.email}}',
      'fill-slot-code': '{{unique.text}}',
    });
  });
});
