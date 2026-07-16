import { describe, expect, it } from 'vitest';

import type { RecordedJourneyStep } from '@formcrash/contracts';

import { preferredReplayLocator } from '../src/runner/external/journey-actions.js';

describe('journey replay locator repair', () => {
  it('replaces an old React-generated ID with the recorded field name', () => {
    expect(
      preferredReplayLocator(
        step({
          strategy: 'id',
          value: '_r_1o_-form-item',
        }),
      ),
    ).toEqual({
      strategy: 'name',
      value: 'visitorName',
    });
  });

  it('preserves a stable recorded ID', () => {
    expect(
      preferredReplayLocator(
        step({
          strategy: 'id',
          value: 'visitor-name',
        }),
      ),
    ).toEqual({
      strategy: 'id',
      value: 'visitor-name',
    });
  });
});

function step(locator: RecordedJourneyStep['locator']): RecordedJourneyStep {
  return {
    id: 'visitor-name-step',
    name: 'Fill Visitor Name',
    type: 'fill',
    timestamp: 1,
    url: 'https://example.test/visitors',
    locator,
    fingerprint: {
      tagName: 'input',
      inputType: 'text',
      dataFormcrash: null,
      dataTestId: null,
      id: '_r_1o_-form-item',
      role: 'textbox',
      accessibleName: 'Visitor Name',
      name: 'visitorName',
      label: 'Visitor Name',
      text: null,
      cssPath: 'input#_r_1o_-form-item',
    },
    value: { kind: 'safe', value: 'Ada' },
    sensitive: false,
  };
}
