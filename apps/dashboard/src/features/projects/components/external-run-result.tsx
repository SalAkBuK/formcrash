'use client';

import type {
  ExternalRunDetail,
  ReplayLocator,
  RunArtifact,
} from '@formcrash/contracts';
import { deriveExternalRunVerdict } from '@formcrash/contracts';

import { getExternalArtifactUrl } from '../api/external-experiments';

export function ExternalRunResult({
  result,
  eyebrow = 'Latest result',
}: {
  readonly result: ExternalRunDetail;
  readonly eyebrow?: string;
}) {
  if (result.outcomeAggregate === 'not_configured') {
    return <NotConfiguredRunResult result={result} />;
  }

  const presentation = result.presentation;
  const verdict = canonicalRunVerdict(result);
  const presentationMatchesOverallVerdict =
    presentation.primaryStatus === verdict.canonicalVerdict;
  const verdictHeadline = presentationMatchesOverallVerdict
    ? overallResultHeadline(result)
    : overallTechnicalHeadline(result);
  const screenshots = [...result.artifacts].sort(
    (left, right) => screenshotPriority(left) - screenshotPriority(right),
  );

  return (
    <div
      className={`external-result outcome-${verdict.canonicalVerdict}`}
      role="status"
    >
      <header className="external-outcome-primary">
        <p className="eyebrow">{eyebrow}</p>
        <h3>{verdictHeadline}</h3>
      </header>

      <VerdictExplanation result={result} />

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
                  {result.experimentSnapshot.networkEvidenceProvenance != null
                    ? `${result.experimentSnapshot.networkEvidenceProvenance.source.replace('_', ' ')} approval`
                    : (result.experimentSnapshot.requestSelectionProvenance
                        ?.selectionMode ?? 'Not recorded')}
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

function VerdictExplanation({
  result,
}: {
  readonly result: ExternalRunDetail;
}) {
  const title =
    result.canonicalVerdict === 'passed'
      ? 'Why this run passed'
      : result.canonicalVerdict === 'failed'
        ? 'Why this run failed'
        : result.canonicalVerdict === 'could_not_verify'
          ? 'Why this run could not be verified'
          : 'Why this run stopped';

  return (
    <section
      aria-labelledby={`verdict-explanation-${result.runId}`}
      className={`external-result-section external-verdict-explanation${result.canonicalVerdict === 'passed' ? '' : ' external-result-impact'}`}
    >
      <h4 id={`verdict-explanation-${result.runId}`}>{title}</h4>
      <p className="external-verdict-narrative">
        {plainLanguageVerdict(result)}
      </p>
      <div className="external-result-checks">
        <ResultCheck {...browserResultExplanation(result)} />
        {result.assertions.length > 0 ? (
          <ResultCheck {...requestResultExplanation(result)} />
        ) : null}
      </div>
      <p className="external-evidence-limit">
        <strong>Evidence limit:</strong> FormCrash checked the visible page and
        observed browser requests. It did not inspect database records or hidden
        backend side effects.
      </p>
    </section>
  );
}

function ResultCheck({
  detail,
  label,
  status,
}: {
  readonly detail: string;
  readonly label: string;
  readonly status: 'Could not verify' | 'Failed' | 'Passed';
}) {
  return (
    <article className={`external-result-check check-${statusToken(status)}`}>
      <div>
        <span>{label}</span>
        <strong>{status}</strong>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function NotConfiguredRunResult({
  result,
}: {
  readonly result: ExternalRunDetail;
}) {
  const failureCount = result.events.filter(
    (event) => event.eventType === 'runner.error',
  ).length;
  const visibleEvents = result.events.slice(-10);
  const screenshot = result.artifacts.find((artifact) =>
    artifact.mimeType.startsWith('image/'),
  );
  const verdict = canonicalRunVerdict(result);
  const technicalChecksOnly = verdict.verdictBasis === 'technical_checks_only';

  return (
    <div
      className={`external-result external-result-not-configured outcome-${verdict.canonicalVerdict}`}
      role="status"
    >
      <header className="not-configured-banner">
        <span className="not-configured-icon" aria-hidden="true">
          !
        </span>
        <div>
          <p className="eyebrow">
            {technicalChecksOnly ? 'Legacy run evidence' : 'Outcome unverified'}
          </p>
          <h2>{canonicalVerdictLabel(result)}</h2>
          <p>
            {technicalChecksOnly
              ? 'No approved Outcome Checks were configured for this immutable run snapshot. This verdict is supported by technical checks only.'
              : result.outcomeCheckSnapshot.checks.length === 0
                ? 'No required checks were configured for this immutable run snapshot, so the application outcome could not be verified.'
                : result.presentation.outcomeSummary}
          </p>
        </div>
        <div className="not-configured-actions">
          <a
            className="button button-primary"
            href={`/projects/${result.projectId}/tests/${result.experimentSnapshot.experimentId}#edit-test`}
          >
            Edit test
          </a>
          <a className="button button-secondary" href="#technical-run-detail">
            View technical evidence
          </a>
        </div>
      </header>

      <div className="not-configured-layout">
        <div className="not-configured-main">
          <section className="panel not-configured-events">
            <div className="section-heading-row compact-heading">
              <div>
                <p className="eyebrow">Execution timeline</p>
                <h3>Observed runner activity</h3>
              </div>
              <span className="event-count">
                {result.events.length} events captured
              </span>
            </div>
            <div className="not-configured-event-table-wrap">
              <table className="not-configured-event-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Observed detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEvents.map((event) => (
                    <tr key={event.eventId}>
                      <td>{formatElapsed(event.relativeTimestampMs)}</td>
                      <td>
                        <code>{event.eventType}</code>
                      </td>
                      <td>{eventSummary(event.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.networkObservations.length > 0 ? (
              <div className="not-configured-network-evidence">
                <h4>Observed network activity</h4>
                <RequestObservationTable result={result} />
              </div>
            ) : null}
          </section>

          <section
            className="panel not-configured-terminal"
            id="technical-run-detail"
          >
            <div className="terminal-heading">
              <span aria-hidden="true">● ● ●</span>
              <span>Runner detail</span>
            </div>
            <pre>
              {result.runnerError === null
                ? 'Execution finished without a persisted runner error.'
                : `${result.runnerError.code}\n${result.runnerError.message}\n${result.runnerError.failedStep?.technicalMessage ?? ''}`}
            </pre>
          </section>
        </div>

        <aside
          className="not-configured-rail"
          aria-label="Run snapshot and diagnostics"
        >
          <section className="panel not-configured-snapshot">
            <p className="eyebrow">Run snapshot</p>
            {screenshot === undefined ? (
              <div className="not-configured-screenshot-empty">
                No screenshot evidence is available for this run.
              </div>
            ) : (
              <figure className="not-configured-screenshot">
                <a
                  aria-label={`Open ${screenshotCaption(screenshot.label).title.toLowerCase()} screenshot`}
                  href={getExternalArtifactUrl(
                    result.runId,
                    screenshot.artifactId,
                  )}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img
                    alt={`${screenshot.label} screenshot`}
                    src={getExternalArtifactUrl(
                      result.runId,
                      screenshot.artifactId,
                    )}
                  />
                </a>
                <figcaption>
                  <strong>{screenshotCaption(screenshot.label).title}</strong>
                  <span>{screenshotCaption(screenshot.label).description}</span>
                </figcaption>
              </figure>
            )}
            <dl>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(result.durationMs)}</dd>
              </div>
              <div>
                <dt>Failures</dt>
                <dd>{failureCount}</dd>
              </div>
            </dl>
          </section>

          <section className="panel not-configured-environment">
            <p className="eyebrow">Environment</p>
            <dl>
              <div>
                <dt>Target URL</dt>
                <dd title={result.targetUrl}>{result.targetUrl}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{result.projectName}</dd>
              </div>
              <div>
                <dt>Journey</dt>
                <dd>{result.journeyName}</dd>
              </div>
              <div>
                <dt>Run ID</dt>
                <dd>
                  <code>{result.runId.slice(0, 12)}…</code>
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel not-configured-diagnostic">
            <p className="eyebrow">Diagnostic next step</p>
            <strong>
              {result.runnerError === null
                ? 'Add an approved Outcome Check.'
                : 'Resolve the recorded journey failure first.'}
            </strong>
            <p>
              {result.runnerError?.message ??
                'Without an approved browser-visible outcome, this run cannot establish application success or failure.'}
            </p>
          </section>
        </aside>
      </div>

      <details className="external-technical not-configured-technical">
        <summary>Technical evidence</summary>
        <div className="external-technical-body">
          <section>
            <h5>Technical assertions</h5>
            {result.assertions.length > 0 ? (
              <ul>
                {result.assertions.map((assertion) => (
                  <li key={assertion.assertionId}>
                    <code>{assertion.assertionId}</code> · {assertion.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No technical assertion results are available.</p>
            )}
          </section>
        </div>
      </details>
    </div>
  );
}

function eventSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return 'No detail';
  const values = Object.values(payload as Record<string, unknown>);
  const useful = values.find(
    (value) => typeof value === 'string' || typeof value === 'number',
  );
  return useful === undefined ? 'State transition recorded' : String(useful);
}

function formatElapsed(milliseconds: number): string {
  return `+${(milliseconds / 1000).toFixed(2)}s`;
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null) return 'In progress';
  return milliseconds < 1000
    ? `${milliseconds} ms`
    : `${(milliseconds / 1000).toFixed(1)} s`;
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

function overallResultHeadline(result: ExternalRunDetail): string {
  if (
    result.canonicalVerdict === 'passed' &&
    result.experimentSnapshot.networkMatcher !== null &&
    result.assertions.length > 0
  ) {
    return 'Passed: Repeated submissions were handled safely.';
  }
  return result.presentation.headline;
}

function overallTechnicalHeadline(result: ExternalRunDetail): string {
  if (result.canonicalVerdict === 'could_not_verify') {
    return 'Could not verify: Required technical evidence was unavailable.';
  }
  if (result.canonicalVerdict === 'runner_error') {
    return 'FormCrash could not complete the journey.';
  }
  const failedTypes = new Set(
    result.assertions
      .filter(
        (assertion) =>
          assertion.status === 'failed' || assertion.status === 'error',
      )
      .map((assertion) => assertion.type),
  );
  if (failedTypes.has('network_no_server_errors')) {
    const requests = requestStatistics(result);
    const response = serverErrorResponseLabel(requests.serverErrors);
    return `Failed: ${requests.serverErrors.length} of ${requests.total} repeated requests returned ${response}.`;
  }
  if (
    failedTypes.has('network_success_max') ||
    failedTypes.has('network_success_exact')
  ) {
    return 'Failed: The number of successful requests was unsafe.';
  }
  if (
    failedTypes.has('network_request_max') ||
    failedTypes.has('network_request_exact')
  ) {
    return 'Failed: The request behavior exceeded the Test limits.';
  }
  if (
    failedTypes.has('network_expected_status') ||
    failedTypes.has('network_all_status')
  ) {
    return 'Failed: A response returned an unexpected status.';
  }
  return 'Failed: A required technical check did not pass.';
}

function plainLanguageVerdict(result: ExternalRunDetail): string {
  const action =
    result.outcomeCheckSnapshot.criticalAction?.label ?? 'the selected action';
  const actionSentence = `FormCrash triggered "${action}" ${triggerCountLabel(result.triggerAttempts)}.`;
  const requests = requestStatistics(result);
  if (requests.serverErrors.length > 0) {
    const succeeded = `${requests.successful} matching request${requests.successful === 1 ? '' : 's'} succeeded`;
    const failed = `${requests.serverErrors.length} returned ${serverErrorResponseLabel(requests.serverErrors)}`;
    return `${actionSentence} ${capitalize(succeeded)}, but ${failed}. The Run failed because the backend reported an internal server error instead of handling the repeated attempt safely.`;
  }
  if (result.canonicalVerdict === 'passed') {
    return `${actionSentence} The Run passed because the visible application result and repeated-request handling both met their requirements.`;
  }
  if (result.canonicalVerdict === 'runner_error') {
    return `${actionSentence} FormCrash could not finish the journey, so it could not establish a reliable application result.`;
  }
  return `${actionSentence} The Run failed because the visible application result did not meet the approved expectation.`;
}

function browserResultExplanation(result: ExternalRunDetail): {
  readonly detail: string;
  readonly label: string;
  readonly status: 'Could not verify' | 'Failed' | 'Passed';
} {
  const exactOnce = result.outcomeCheckResults.find(
    (check) => check.type === 'matching_item_appears_exactly_once',
  );
  if (exactOnce !== undefined) {
    if (exactOnce.status === 'passed') {
      return {
        detail: 'Exactly one matching result appeared in the page.',
        label: 'Visible application result',
        status: 'Passed',
      };
    }
    if (exactOnce.status === 'failed') {
      return {
        detail:
          exactOnce.observedCount === null
            ? 'The expected matching result did not appear reliably.'
            : `${exactOnce.observedCount} matching results appeared; the Test expected exactly one.`,
        label: 'Visible application result',
        status: 'Failed',
      };
    }
  }
  const status =
    result.presentation.primaryStatus === 'passed'
      ? 'Passed'
      : result.presentation.primaryStatus === 'failed'
        ? 'Failed'
        : 'Could not verify';
  return {
    detail:
      result.presentation.conclusion ?? result.presentation.outcomeSummary,
    label: 'Visible application result',
    status,
  };
}

function requestResultExplanation(result: ExternalRunDetail): {
  readonly detail: string;
  readonly label: string;
  readonly status: 'Could not verify' | 'Failed' | 'Passed';
} {
  const requests = requestStatistics(result);
  const label =
    result.experimentSnapshot.networkMatcher === null
      ? 'Additional checks'
      : 'Repeated-request handling';
  if (requests.serverErrors.length > 0) {
    return {
      detail: `${requests.serverErrors.length} of ${requests.total} matching requests returned ${serverErrorResponseLabel(requests.serverErrors)}. A repeated attempt should be ignored or rejected intentionally—not reported as an internal server error.`,
      label,
      status: 'Failed',
    };
  }
  if (requests.total === 0 && result.assertionAggregate === 'passed') {
    return {
      detail: `All ${result.assertions.length} additional technical ${result.assertions.length === 1 ? 'check passed' : 'checks passed'}.`,
      label,
      status: 'Passed',
    };
  }
  if (result.assertionAggregate === 'passed') {
    const rejected = requests.clientRejections.length;
    const rejectionText =
      rejected === 0
        ? ''
        : ` ${rejected} ${rejected === 1 ? 'was' : 'were'} rejected cleanly with ${statusList(requests.clientRejections)}.`;
    return {
      detail: `${requests.successful} of ${requests.total} matching requests succeeded.${rejectionText} No matching request returned a server error.`,
      label,
      status: 'Passed',
    };
  }
  const failedCheck = result.assertions.find(
    (assertion) => assertion.status !== 'passed',
  );
  if (result.assertionAggregate === 'failed' && failedCheck !== undefined) {
    return {
      detail: `${failedCheck.observedDescription} This did not meet the required behavior: ${failedCheck.expectedDescription}`,
      label,
      status: 'Failed',
    };
  }
  return {
    detail: 'The required request or technical evidence was unavailable.',
    label,
    status: 'Could not verify',
  };
}

function requestStatistics(result: ExternalRunDetail): {
  readonly clientRejections: readonly number[];
  readonly serverErrors: readonly number[];
  readonly successful: number;
  readonly total: number;
} {
  const matched = result.networkObservations.filter(
    (observation) => observation.matched,
  );
  const statuses = matched.flatMap((observation) =>
    observation.status === null ? [] : [observation.status],
  );
  return {
    clientRejections: statuses.filter(
      (status) => status >= 400 && status < 500,
    ),
    serverErrors: statuses.filter((status) => status >= 500),
    successful: statuses.filter((status) => status >= 200 && status < 400)
      .length,
    total: matched.length,
  };
}

function serverErrorResponseLabel(statuses: readonly number[]): string {
  const uniqueStatuses = [...new Set(statuses)];
  return uniqueStatuses.length === 1
    ? `HTTP ${uniqueStatuses[0]}`
    : 'HTTP 5xx errors';
}

function statusList(statuses: readonly number[]): string {
  return [...new Set(statuses)].map((status) => `HTTP ${status}`).join(' and ');
}

function triggerCountLabel(count: number): string {
  if (count === 1) return 'once';
  if (count === 2) return 'twice';
  return `${count} times`;
}

function statusToken(status: 'Could not verify' | 'Failed' | 'Passed'): string {
  return status.toLowerCase().replaceAll(' ', '-');
}

function canonicalVerdictLabel(result: ExternalRunDetail): string {
  const verdict = canonicalRunVerdict(result);
  if (
    verdict.canonicalVerdict === 'passed' &&
    verdict.verdictBasis === 'technical_checks_only'
  ) {
    return 'Passed — technical checks only';
  }
  if (verdict.canonicalVerdict === 'could_not_verify') {
    return 'Could not verify';
  }
  if (verdict.canonicalVerdict === 'runner_error') return 'Runner error';
  return capitalize(verdict.canonicalVerdict);
}

function canonicalRunVerdict(result: ExternalRunDetail) {
  if (
    result.canonicalVerdict !== undefined &&
    result.verdictBasis !== undefined
  ) {
    return {
      canonicalVerdict: result.canonicalVerdict,
      verdictBasis: result.verdictBasis,
    };
  }
  return deriveExternalRunVerdict(result);
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
