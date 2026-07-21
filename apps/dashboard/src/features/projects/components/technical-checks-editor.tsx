'use client';

import type {
  ExternalAssertion,
  ExternalAssertionType,
  PersistedJourney,
} from '@formcrash/contracts';

type BrowserCheckType = Extract<
  ExternalAssertionType,
  | 'element_visible'
  | 'element_not_visible'
  | 'element_disabled'
  | 'text_appeared'
  | 'field_retained'
  | 'final_url_contains'
  | 'final_url_not_contains'
>;

const options: readonly (readonly [BrowserCheckType, string])[] = [
  ['element_visible', 'Recorded element is visible'],
  ['element_not_visible', 'Recorded element is hidden'],
  ['element_disabled', 'Recorded element is disabled'],
  ['text_appeared', 'Text is visible'],
  ['field_retained', 'Recorded field retained its value'],
  ['final_url_contains', 'Final URL contains'],
  ['final_url_not_contains', 'Final URL does not contain'],
];

export function TechnicalChecksEditor({
  assertions,
  journey,
  onChange,
}: {
  readonly assertions: readonly ExternalAssertion[];
  readonly journey: PersistedJourney;
  readonly onChange: (assertions: readonly ExternalAssertion[]) => void;
}) {
  const browserChecks = assertions.filter(isBrowserCheck);
  return (
    <details className="technical-checks-editor">
      <summary>
        Technical checks (optional) · {browserChecks.length} configured
      </summary>
      <p>
        Add bounded browser checks only when the approved Outcome Checks do not
        cover a useful interface detail. Every configured check must pass.
      </p>
      <div className="assertion-draft-list">
        {browserChecks.map((assertion, index) => (
          <article className="assertion-draft" key={assertion.id}>
            <div className="builder-grid">
              <label>
                Check {index + 1}
                <select
                  aria-label={`Technical check ${index + 1} type`}
                  onChange={(event) =>
                    replace(
                      assertion.id,
                      createCheck(
                        event.target.value as BrowserCheckType,
                        journey,
                        assertion.id,
                      ),
                      assertions,
                      onChange,
                    )
                  }
                  value={assertion.type}
                >
                  {options.map(([type, label]) => (
                    <option
                      disabled={!canConfigure(type, journey)}
                      key={type}
                      value={type}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {needsRecordedTarget(assertion.type) ? (
                <label>
                  Recorded target
                  <select
                    aria-label={`Technical check ${index + 1} target`}
                    onChange={(event) => {
                      const step = journey.steps.find(
                        (item) => item.id === event.target.value,
                      );
                      if (step === undefined || step.locator === null) return;
                      const next = targetCheck(assertion, step);
                      if (next !== null)
                        replace(assertion.id, next, assertions, onChange);
                    }}
                    value={targetStepId(assertion, journey)}
                  >
                    {eligibleSteps(assertion.type, journey).map((step) => (
                      <option key={step.id} value={step.id}>
                        {step.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {assertion.type === 'text_appeared' ? (
                <label>
                  Visible text
                  <input
                    aria-label={`Technical check ${index + 1} text`}
                    maxLength={1_000}
                    onChange={(event) =>
                      replace(
                        assertion.id,
                        {
                          ...assertion,
                          text: event.target.value,
                          description: 'Selected text should be visible.',
                        },
                        assertions,
                        onChange,
                      )
                    }
                    value={assertion.text}
                  />
                </label>
              ) : null}
              {assertion.type === 'final_url_contains' ||
              assertion.type === 'final_url_not_contains' ? (
                <label>
                  URL text
                  <input
                    aria-label={`Technical check ${index + 1} URL text`}
                    maxLength={2_000}
                    onChange={(event) =>
                      replace(
                        assertion.id,
                        { ...assertion, value: event.target.value },
                        assertions,
                        onChange,
                      )
                    }
                    placeholder="/portal/residents"
                    value={assertion.value}
                  />
                </label>
              ) : null}
            </div>
            <button
              className="copy-button"
              onClick={() =>
                onChange(assertions.filter((item) => item.id !== assertion.id))
              }
              type="button"
            >
              Remove check
            </button>
          </article>
        ))}
      </div>
      <button
        className="button button-secondary button-compact"
        disabled={assertions.length >= 20}
        onClick={() =>
          onChange([
            ...assertions,
            createCheck('text_appeared', journey, crypto.randomUUID()),
          ])
        }
        type="button"
      >
        Add technical check
      </button>
    </details>
  );
}

export function technicalChecksAreValid(
  assertions: readonly ExternalAssertion[],
): boolean {
  return assertions.every((assertion) => {
    if (assertion.type === 'text_appeared') return assertion.text.trim() !== '';
    if (
      assertion.type === 'final_url_contains' ||
      assertion.type === 'final_url_not_contains'
    ) {
      return assertion.value.trim() !== '';
    }
    return true;
  });
}

export function isBrowserCheck(
  assertion: ExternalAssertion,
): assertion is Extract<ExternalAssertion, { type: BrowserCheckType }> {
  return !assertion.type.startsWith('network_');
}

function createCheck(
  type: BrowserCheckType,
  journey: PersistedJourney,
  id: string,
): ExternalAssertion {
  if (type === 'text_appeared') {
    return {
      id,
      type,
      text: '',
      description: 'Selected text should be visible.',
    };
  }
  if (type === 'final_url_contains' || type === 'final_url_not_contains') {
    return {
      id,
      type,
      value: '',
      description:
        type === 'final_url_contains'
          ? 'Final URL should contain the configured text.'
          : 'Final URL should not contain the configured text.',
    };
  }
  const step = eligibleSteps(type, journey)[0];
  if (step === undefined || step.locator === null) {
    return createCheck('text_appeared', journey, id);
  }
  if (type === 'field_retained') {
    return {
      id,
      type,
      locator: step.locator,
      targetDescription: step.name,
      expectedValue: step.value!,
      description: `${step.name} should retain its recorded value.`,
    };
  }
  return {
    id,
    type,
    locator: step.locator,
    targetDescription: step.name,
    description: `${step.name} should be ${type === 'element_visible' ? 'visible' : type === 'element_not_visible' ? 'hidden' : 'disabled'}.`,
  };
}

function eligibleSteps(
  type: BrowserCheckType,
  journey: PersistedJourney,
): readonly PersistedJourney['steps'][number][] {
  return journey.steps.filter(
    (step) =>
      step.locator !== null &&
      (type !== 'field_retained' || step.value !== null),
  );
}

function canConfigure(
  type: BrowserCheckType,
  journey: PersistedJourney,
): boolean {
  return !needsRecordedTarget(type) || eligibleSteps(type, journey).length > 0;
}

function needsRecordedTarget(type: ExternalAssertionType): boolean {
  return type.startsWith('element_') || type === 'field_retained';
}

function targetStepId(
  assertion: ExternalAssertion,
  journey: PersistedJourney,
): string {
  if (!needsRecordedTarget(assertion.type)) return '';
  const locator = 'locator' in assertion ? assertion.locator : null;
  return (
    journey.steps.find(
      (step) =>
        step.locator !== null &&
        JSON.stringify(step.locator) === JSON.stringify(locator),
    )?.id ?? ''
  );
}

function targetCheck(
  assertion: ExternalAssertion,
  step: PersistedJourney['steps'][number],
): ExternalAssertion | null {
  if (step.locator === null) return null;
  if (assertion.type === 'field_retained') {
    if (step.value === null) return null;
    return {
      ...assertion,
      locator: step.locator,
      targetDescription: step.name,
      expectedValue: step.value,
      description: `${step.name} should retain its recorded value.`,
    };
  }
  if (
    assertion.type === 'element_visible' ||
    assertion.type === 'element_not_visible' ||
    assertion.type === 'element_disabled'
  ) {
    return {
      ...assertion,
      locator: step.locator,
      targetDescription: step.name,
      description: `${step.name} should be ${assertion.type === 'element_visible' ? 'visible' : assertion.type === 'element_not_visible' ? 'hidden' : 'disabled'}.`,
    };
  }
  return null;
}

function replace(
  id: string,
  next: ExternalAssertion,
  assertions: readonly ExternalAssertion[],
  onChange: (assertions: readonly ExternalAssertion[]) => void,
): void {
  onChange(assertions.map((item) => (item.id === id ? next : item)));
}
