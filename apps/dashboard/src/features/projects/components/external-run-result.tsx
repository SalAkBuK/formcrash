'use client';

import type {
  ExternalRunDetail,
  ExternalRunPresentationCondition,
  ReplayLocator,
  RunArtifact,
} from '@formcrash/contracts';

import { getExternalArtifactUrl } from '../api/external-experiments';

export function ExternalRunResult({
  result,
  eyebrow = 'Latest result',
}: {
  readonly result: ExternalRunDetail;
  readonly eyebrow?: string;
}) {
  const presentation = result.presentation;
  const screenshots = [...result.artifacts].sort(
    (left, right) => screenshotPriority(left) - screenshotPriority(right),
  );

  return (
    <div
      className={`external-result outcome-${presentation.primaryStatus}`}
      role="status"
    >
      <header className="external-outcome-primary">
        <div className="external-outcome-status-row">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <span className="external-outcome-status">
              {statusLabel(presentation.primaryStatus)}
            </span>
          </div>
          <span className="external-outcome-aggregate">
            {
              result.outcomeCheckResults.filter(
                (check) => check.status === 'passed',
              ).length
            }
            /{result.outcomeCheckResults.length} Outcome Checks passed
          </span>
        </div>
        <h3>{presentation.headline}</h3>
        <p>{presentation.outcomeSummary}</p>
      </header>

      {presentation.expectedCondition !== null &&
      presentation.observedCondition !== null ? (
        <section
          aria-labelledby={`expected-observed-${result.runId}`}
          className="external-result-section"
        >
          <p className="eyebrow">Approved outcome</p>
          <h4 id={`expected-observed-${result.runId}`}>
            Expected versus observed
          </h4>
          {presentation.approvedExpectedOutcomeDescription !== null ? (
            <p>{presentation.approvedExpectedOutcomeDescription}</p>
          ) : null}
          <div className="external-condition-grid">
            <ConditionCard
              condition={presentation.expectedCondition}
              label="Expected"
            />
            <ConditionCard
              condition={presentation.observedCondition}
              label="Observed"
            />
          </div>
          {presentation.templateBinding !== null ? (
            <p className="external-binding">
              <strong>Binding:</strong>{' '}
              <code>{presentation.templateBinding.template}</code>
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby={`what-happened-${result.runId}`}
        className="external-result-section"
      >
        <p className="eyebrow">Observed facts</p>
        <h4 id={`what-happened-${result.runId}`}>What happened</h4>
        {presentation.observations.length > 0 ? (
          <ul className="external-observation-list">
            {presentation.observations.map((observation, index) => (
              <li key={`${observation.kind}-${index}`}>{observation.text}</li>
            ))}
          </ul>
        ) : (
          <p>
            No approved application-outcome observation was available for this
            run.
          </p>
        )}
      </section>

      {presentation.whyItMatters !== null ? (
        <section
          aria-labelledby={`why-it-matters-${result.runId}`}
          className="external-result-section external-result-impact"
        >
          <p className="eyebrow">Bounded impact</p>
          <h4 id={`why-it-matters-${result.runId}`}>Why this result matters</h4>
          <p>{presentation.whyItMatters}</p>
          {presentation.protectionSuggestions.length > 0 ? (
            <div className="external-protection-suggestions">
              <strong>Possible protections</strong>
              {presentation.protectionSuggestions.map((suggestion) => (
                <p key={suggestion.area}>
                  <span>{capitalize(suggestion.area)}:</span> {suggestion.text}
                </p>
              ))}
              <small>
                These are defensive options, not a FormCrash root-cause
                diagnosis.
              </small>
            </div>
          ) : null}
        </section>
      ) : null}

      <section
        aria-labelledby={`evidence-boundaries-${result.runId}`}
        className="external-result-section"
      >
        <p className="eyebrow">Evidence boundaries</p>
        <h4 id={`evidence-boundaries-${result.runId}`}>
          What the result does and does not establish
        </h4>
        <div className="external-boundary-grid">
          <div>
            <strong>Observed</strong>
            <p>
              {presentation.observations.length > 0
                ? presentation.observations.map((item) => item.text).join(' ')
                : 'No approved browser-visible outcome was established.'}
            </p>
          </div>
          <div>
            <strong>Conclusion</strong>
            <p>
              {presentation.conclusion ??
                'No application-outcome conclusion was reached.'}
            </p>
          </div>
          <div>
            <strong>Unknown</strong>
            {presentation.unknowns.length > 0 ? (
              <ul>
                {presentation.unknowns.map((unknown) => (
                  <li key={unknown}>{unknown}</li>
                ))}
              </ul>
            ) : (
              <p>No additional outcome unknowns were recorded.</p>
            )}
          </div>
        </div>
      </section>

      <section
        aria-labelledby={`visual-evidence-${result.runId}`}
        className="external-result-section"
      >
        <p className="eyebrow">Primary evidence</p>
        <h4 id={`visual-evidence-${result.runId}`}>Screenshots</h4>
        {screenshots.length > 0 ? (
          <div className="external-screenshot-grid">
            {screenshots.map((artifact) => {
              const url = getExternalArtifactUrl(
                result.runId,
                artifact.artifactId,
              );
              const caption = screenshotCaption(artifact.label);
              return (
                <figure
                  id={`evidence-${artifact.artifactId}`}
                  key={artifact.artifactId}
                >
                  <a
                    aria-label={`Open ${caption.title.toLowerCase()} screenshot`}
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <img alt={`${artifact.label} screenshot`} src={url} />
                  </a>
                  <figcaption>
                    <strong>{caption.title}</strong>
                    <span>{caption.description}</span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        ) : (
          <p className="external-missing-evidence">
            No screenshot evidence is available for this run.
          </p>
        )}
      </section>

      {presentation.checks.length > 0 ? (
        <section
          aria-labelledby={`outcome-checks-${result.runId}`}
          className="external-result-section"
        >
          <p className="eyebrow">Developer-approved outcomes</p>
          <h4 id={`outcome-checks-${result.runId}`}>
            Individual Outcome Checks
          </h4>
          <div className="external-outcome-check-list">
            {presentation.checks.map((check) => (
              <article
                className={`external-outcome-check check-${check.status}`}
                key={check.outcomeCheckId}
              >
                <div>
                  <span>{checkTypeLabel(check.type)}</span>
                  <strong>{check.headline}</strong>
                </div>
                <p>{check.approvedDescription}</p>
                <dl>
                  <div>
                    <dt>Expected</dt>
                    <dd>{conditionValue(check.expectedCondition)}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{conditionValue(check.observedCondition)}</dd>
                  </div>
                  {check.templateBinding !== null ? (
                    <div>
                      <dt>Binding</dt>
                      <dd>
                        <code>{check.templateBinding.template}</code>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {check.reason !== null ? <p>{check.reason}</p> : null}
                {check.evidenceReferences.screenshotArtifactIds[0] !==
                undefined ? (
                  <a
                    className="external-evidence-link"
                    href={`#evidence-${check.evidenceReferences.screenshotArtifactIds[0]}`}
                  >
                    View relevant screenshot evidence
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <details className="external-technical-evidence">
        <summary>Technical evidence</summary>
        <div className="external-technical-evidence-body">
          <section>
            <h5>Technical assertions</h5>
            <p>
              Technical assertions are supporting evaluation primitives. They
              are not developer-approved Outcome Checks. Aggregate:{' '}
              <strong>{result.assertionAggregate.replaceAll('_', ' ')}</strong>.
            </p>
            {result.assertions.length > 0 ? (
              <ul>
                {result.assertions.map((assertion) => (
                  <li key={assertion.assertionResultId}>
                    <strong>{assertion.status}</strong> —{' '}
                    {assertion.description}
                    <br />
                    <span>
                      <code>{assertion.assertionId}</code> ·{' '}
                      {assertion.observedDescription}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No technical assertion results are available.</p>
            )}
          </section>

          <section>
            <h5>Request observations</h5>
            <RequestObservationTable result={result} />
          </section>

          <section>
            <h5>Matcher and recommendation provenance</h5>
            <dl className="external-technical-list">
              <div>
                <dt>Matcher</dt>
                <dd>
                  {result.experimentSnapshot.networkMatcher === null ? (
                    'Not configured'
                  ) : (
                    <code>
                      {result.experimentSnapshot.networkMatcher.method}{' '}
                      {result.experimentSnapshot.networkMatcher.pathname}
                    </code>
                  )}
                </dd>
              </div>
              <div>
                <dt>Request selection</dt>
                <dd>
                  {result.experimentSnapshot.requestSelectionProvenance
                    ?.selectionMode ?? 'Not recorded'}
                </dd>
              </div>
              <div>
                <dt>Candidate evidence</dt>
                <dd>
                  {result.experimentSnapshot.requestSelectionProvenance == null
                    ? 'Not recorded'
                    : `Score ${result.experimentSnapshot.requestSelectionProvenance.selectedCandidateScore ?? 'unavailable'} · ${result.experimentSnapshot.requestSelectionProvenance.selectedCandidateConfidence ?? 'unavailable'} confidence`}
                </dd>
              </div>
              <div>
                <dt>Assertion recommendations</dt>
                <dd>
                  {result.experimentSnapshot.assertionSelectionProvenance
                    ?.length ?? 0}{' '}
                  provenance record(s)
                </dd>
              </div>
            </dl>
            {result.experimentSnapshot.requestSelectionProvenance != null &&
            result.experimentSnapshot.requestSelectionProvenance
              .recommendationReasons.length > 0 ? (
              <ul>
                {result.experimentSnapshot.requestSelectionProvenance.recommendationReasons.map(
                  (reason) => (
                    <li key={reason.code}>
                      {reason.label} ({reason.scoreImpact >= 0 ? '+' : ''}
                      {reason.scoreImpact})
                    </li>
                  ),
                )}
              </ul>
            ) : null}
            {(result.experimentSnapshot.assertionSelectionProvenance ?? [])
              .length > 0 ? (
              <ul>
                {result.experimentSnapshot.assertionSelectionProvenance.map(
                  (entry, index) => (
                    <li key={entry.recommendationId ?? `manual-${index}`}>
                      {entry.assertionId ?? 'Disabled recommendation'} ·{' '}
                      {entry.origin.replaceAll('_', ' ')} · {entry.action}
                      {entry.explanation === null
                        ? ''
                        : ` · ${entry.explanation}`}
                    </li>
                  ),
                )}
              </ul>
            ) : null}
          </section>

          <section>
            <h5>Ordered event timeline</h5>
            {result.events.length > 0 ? (
              <ol className="external-event-list">
                {result.events.map((event) => (
                  <li key={event.eventId}>
                    <code>{event.eventType}</code>
                    <span>
                      Sequence {event.sequence} · +{event.relativeTimestampMs}{' '}
                      ms
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No persisted events are available.</p>
            )}
          </section>

          <section>
            <h5>Locator and immutable snapshot details</h5>
            <dl className="external-technical-list">
              <div>
                <dt>Experiment version</dt>
                <dd>
                  {result.experimentSnapshot.version} ·{' '}
                  {result.experimentSnapshot.id}
                </dd>
              </div>
              <div>
                <dt>Journey version</dt>
                <dd>
                  {result.experimentSnapshot.journeySnapshot.version} ·{' '}
                  {result.experimentSnapshot.journeySnapshot.id}
                </dd>
              </div>
              <div>
                <dt>Critical Action</dt>
                <dd>
                  {result.outcomeCheckSnapshot.criticalAction?.label ??
                    'Not configured'}
                </dd>
              </div>
              <div>
                <dt>Critical Action locator</dt>
                <dd>{criticalActionLocator(result)}</dd>
              </div>
              <div>
                <dt>Outcome locators</dt>
                <dd>
                  {result.outcomeCheckSnapshot.checks
                    .filter((check) => 'target' in check)
                    .map((check) =>
                      'target' in check
                        ? locatorLabel(check.target.locator)
                        : '',
                    )
                    .join(', ') || 'None'}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h5>Screenshot metadata</h5>
            {screenshots.length > 0 ? (
              <ul className="external-artifact-metadata">
                {screenshots.map((artifact) => (
                  <li key={artifact.artifactId}>
                    <strong>{artifact.label}</strong>
                    <span>
                      {artifact.sizeBytes} bytes · SHA-256{' '}
                      <code>{artifact.checksumSha256}</code>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No screenshot metadata is available.</p>
            )}
          </section>

          {result.warnings.length > 0 ? (
            <section>
              <h5>Evidence warnings</h5>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={`${warning.code}-${warning.label}`}>
                    {warning.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function ConditionCard({
  condition,
  label,
}: {
  readonly condition: ExternalRunPresentationCondition;
  readonly label: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{conditionValue(condition)}</strong>
      <small>{condition.description}</small>
    </div>
  );
}

function conditionValue(condition: ExternalRunPresentationCondition): string {
  if (condition.kind === 'visible_match_count') {
    return condition.count === null
      ? 'Unavailable'
      : `${condition.count} visible matching result${condition.count === 1 ? '' : 's'}`;
  }
  if (condition.kind === 'approved_target_visibility') {
    if (condition.visible === null) return 'Unavailable';
    return condition.visible ? 'Visible' : 'Not visible';
  }
  if (condition.kind === 'pathname') {
    return condition.pathname ?? 'Unavailable';
  }
  return 'Unavailable';
}

function RequestObservationTable({
  result,
}: {
  readonly result: ExternalRunDetail;
}) {
  if (result.networkObservations.length === 0) {
    return <p>No request observations are available.</p>;
  }
  return (
    <div className="network-evidence-table-wrap">
      <table className="network-evidence-table">
        <thead>
          <tr>
            <th>Matched</th>
            <th>Request</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {result.networkObservations.map((observation) => (
            <tr key={observation.requestId}>
              <td>{observation.matched ? 'yes' : 'no'}</td>
              <td>
                <code>
                  {observation.method} {observation.pathname}
                </code>
              </td>
              <td>
                {observation.failed
                  ? 'request failed'
                  : (observation.status ?? 'pending')}
              </td>
              <td>
                {observation.completedAtMs === null
                  ? 'pending'
                  : `${Math.max(
                      0,
                      observation.completedAtMs - observation.startedAtMs,
                    )} ms`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLabel(
  status: ExternalRunDetail['presentation']['primaryStatus'],
): string {
  if (status === 'could_not_verify') return 'Could not verify';
  if (status === 'not_configured') return 'Not configured';
  if (status === 'runner_error') return 'Runner error';
  return capitalize(status);
}

function checkTypeLabel(
  type: ExternalRunDetail['presentation']['checks'][number]['type'],
): string {
  if (type === 'matching_item_appears_exactly_once') return 'Exact-once check';
  if (type === 'visible_element_exists') return 'Visible confirmation check';
  return 'Final pathname check';
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function locatorLabel(locator: ReplayLocator): string {
  if (locator.strategy === 'role') {
    return `role:${locator.role}:${locator.name}`;
  }
  return `${locator.strategy}:${locator.value}`;
}

function criticalActionLocator(result: ExternalRunDetail): string {
  const targetStep = result.experimentSnapshot.journeySnapshot.steps.find(
    (step) => step.id === result.experimentSnapshot.targetStepId,
  );
  return targetStep?.locator === null || targetStep?.locator === undefined
    ? 'Unavailable'
    : locatorLabel(targetStep.locator);
}

function screenshotPriority(artifact: RunArtifact): number {
  if (artifact.label === 'before-disruption') return 0;
  if (artifact.label === 'after-disruption') return 1;
  return 2;
}

function screenshotCaption(label: string): {
  readonly title: string;
  readonly description: string;
} {
  if (label === 'before-disruption') {
    return {
      title: 'Before the Critical Action',
      description:
        'The completed journey state immediately before FormCrash triggers the selected action.',
    };
  }
  if (label === 'after-disruption') {
    return {
      title: 'After the repeated action',
      description:
        'The interface after matching requests complete and post-submit transitions settle.',
    };
  }
  return {
    title: 'Final application state',
    description:
      'The stable page state preserved when FormCrash evaluates and records the result.',
  };
}
