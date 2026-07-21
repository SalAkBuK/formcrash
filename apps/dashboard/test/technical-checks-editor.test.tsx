import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { ExternalAssertion, PersistedJourney } from '@formcrash/contracts';

import { TechnicalChecksEditor } from '../src/features/projects/components/technical-checks-editor';

const journey: PersistedJourney = {
  id: 'journey-technical-checks',
  projectId: 'project-1',
  name: 'Register visitor',
  version: 1,
  steps: [
    {
      id: 'name',
      name: 'Visitor name',
      type: 'fill',
      timestamp: 0,
      url: 'http://fixture.test/visitors',
      locator: { strategy: 'label', value: 'Visitor name' },
      fingerprint: null,
      value: { kind: 'safe', value: '{{unique.name}}' },
      sensitive: false,
    },
    {
      id: 'submit',
      name: 'Submit visitor',
      type: 'submit',
      timestamp: 1,
      url: 'http://fixture.test/visitors',
      locator: { strategy: 'data-testid', value: 'visitor-form' },
      fingerprint: null,
      value: null,
      sensitive: false,
    },
  ],
  recordingMetadata: {
    recordingSessionId: null,
    recordedAt: '2026-07-20T00:00:00.000Z',
    warningCount: 0,
    normalizationRule: 'test',
  },
  createdAt: '2026-07-20T00:00:00.000Z',
};

describe('bounded Technical checks editor', () => {
  it('supports every approved browser check without scripts or network fields', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText(/Technical checks \(optional\)/u));
    expect(screen.queryByText(/script/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/network matcher/u)).not.toBeInTheDocument();

    await addCheck(user);
    await user.type(screen.getByLabelText('Technical check 1 text'), 'Saved');

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 2 type'),
      'element_visible',
    );

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 3 type'),
      'element_not_visible',
    );

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 4 type'),
      'element_disabled',
    );

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 5 type'),
      'field_retained',
    );

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 6 type'),
      'final_url_contains',
    );
    await user.type(
      screen.getByLabelText('Technical check 6 URL text'),
      '/portal/visitors',
    );

    await addCheck(user);
    await user.selectOptions(
      screen.getByLabelText('Technical check 7 type'),
      'final_url_not_contains',
    );
    await user.type(
      screen.getByLabelText('Technical check 7 URL text'),
      '/error',
    );

    const saved = JSON.parse(
      screen.getByTestId('saved-checks').textContent ?? '[]',
    ) as ExternalAssertion[];
    expect(saved.map((check) => check.type)).toEqual([
      'text_appeared',
      'element_visible',
      'element_not_visible',
      'element_disabled',
      'field_retained',
      'final_url_contains',
      'final_url_not_contains',
    ]);
    expect(saved[4]).toMatchObject({
      targetDescription: 'Visitor name',
      expectedValue: { kind: 'safe', value: '{{unique.name}}' },
    });
  });
});

function Harness() {
  const [assertions, setAssertions] = useState<readonly ExternalAssertion[]>(
    [],
  );
  return (
    <>
      <TechnicalChecksEditor
        assertions={assertions}
        journey={journey}
        onChange={setAssertions}
      />
      <output data-testid="saved-checks">{JSON.stringify(assertions)}</output>
    </>
  );
}

async function addCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add technical check' }));
}
