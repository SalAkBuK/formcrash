'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  ExternalRunComparisonPresentation,
  ExternalRunComparisonResponse,
  ExternalRunDetail,
  ExternalRunPresentationCondition,
  ExternalRunSummary,
} from '@formcrash/contracts';

import {
  compareExternalRuns,
  getExternalArtifactUrl,
} from '../api/external-experiments';
import { verdictLabel } from './crm-project-data';

interface Props {
  readonly beforeRun: ExternalRunDetail;
  readonly runs: readonly ExternalRunSummary[];
}

export function ExternalRunComparison({ beforeRun, runs }: Props) {
  const [open, setOpen] = useState(false);
  const [afterRunId, setAfterRunId] = useState('');
  const [comparison, setComparison] =
    useState<ExternalRunComparisonResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleRuns = useMemo(
    () =>
      runs
        .filter(
          (run) =>
            run.runId !== beforeRun.runId &&
            run.projectId === beforeRun.projectId &&
            run.journeyId === beforeRun.journeyId &&
            run.lifecycleStatus === 'completed' &&
            run.outcomeAggregate !== 'not_configured' &&
            Date.parse(run.createdAt) > Date.parse(beforeRun.createdAt),
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [beforeRun, runs],
  );

  useEffect(() => {
    setOpen(false);
    setAfterRunId('');
    setComparison(null);
    setError(null);
  }, [beforeRun.runId]);

  async function compare(): Promise<void> {
    if (afterRunId === '') return;
    setLoading(true);
    setError(null);
    setComparison(null);
    try {
      setComparison(await compareExternalRuns(beforeRun.runId, afterRunId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Comparison failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="external-comparison-launch" aria-label="Run comparison">
      {!open ? (
        <button
          className="button button-primary"
          disabled={
            beforeRun.lifecycleStatus !== 'completed' ||
            beforeRun.outcomeAggregate === 'not_configured'
          }
          onClick={() => setOpen(true)}
          type="button"
        >
          Compare with another run
        </button>
      ) : (
        <>
          <div className="external-comparison-picker">
            <div>
              <p className="eyebrow">Exact failed-versus-fixed comparison</p>
              <h3>Choose a later run</h3>
              <p>
                FormCrash will verify immutable configuration compatibility
                before drawing any proof conclusion.
              </p>
            </div>
            {eligibleRuns.length === 0 ? (
              <p className="empty-state">
                No later completed run with configured Outcome Checks is
                available for this journey version.
              </p>
            ) : (
              <div className="external-comparison-controls">
                <label>
                  After fix
                  <select
                    aria-label="After fix run"
                    value={afterRunId}
                    onChange={(event) => {
                      setAfterRunId(event.target.value);
                      setComparison(null);
                    }}
                  >
                    <option value="">Select a later run</option>
                    {eligibleRuns.map((run) => (
                      <option key={run.runId} value={run.runId}>
                        {run.experimentName} · {verdictLabel(run)} ·{' '}
                        {new Date(run.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button-primary button-compact"
                  disabled={afterRunId === '' || loading}
                  onClick={() => void compare()}
                  type="button"
                >
                  {loading ? 'Checking compatibility…' : 'Compare exact runs'}
                </button>
              </div>
            )}
          </div>
          {error !== null ? (
            <p className="state-message state-message-error" role="alert">
              {error}
            </p>
          ) : null}
          {comparison !== null ? (
            <ComparisonResult comparison={comparison} />
          ) : null}
        </>
      )}
    </section>
  );
}

function ComparisonResult({
  comparison,
}: {
  readonly comparison: ExternalRunComparisonResponse;
}) {
  if (comparison.compatibility === 'incompatible') {
    return (
      <article className="external-comparison comparison-incompatible">
        <header className="external-comparison-primary">
          <span className="external-comparison-status">Incompatible</span>
          <h3>These runs cannot support an exact before-and-after proof.</h3>
          <p>
            FormCrash found immutable configuration or eligibility differences
            and did not produce a proof conclusion.
          </p>
        </header>
        <section>
          <h4>Compatibility differences</h4>
          <ul>
            {comparison.differences.map((difference) => (
              <li key={difference.code}>{difference.message}</li>
            ))}
          </ul>
        </section>
        {comparison.matchedProperties.length > 0 ? (
          <ConfigurationDetails items={comparison.matchedProperties} />
        ) : null}
      </article>
    );
  }
  if (comparison.presentation === null) return null;
  return (
    <CompatibleComparison
      matchedProperties={comparison.matchedProperties}
      presentation={comparison.presentation}
    />
  );
}

function CompatibleComparison({
  matchedProperties,
  presentation,
}: {
  readonly matchedProperties: ExternalRunComparisonResponse['matchedProperties'];
  readonly presentation: ExternalRunComparisonPresentation;
}) {
  return (
    <article
      className={`external-comparison comparison-${presentation.primaryStatus}`}
    >
      <header className="external-comparison-primary">
        <div className="external-comparison-status-row">
          <span className="external-comparison-status">Compatible</span>
          <span className="external-comparison-proof-status">
            {statusLabel(presentation.primaryStatus)}
          </span>
        </div>
        <h3>{presentation.headline}</h3>
        <p>{presentation.summary}</p>
      </header>

      <section className="external-comparison-section">
        <h4>Before fix versus After fix</h4>
        <div className="external-comparison-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Evidence</th>
                <th scope="col">Before fix</th>
                <th scope="col">After fix</th>
              </tr>
            </thead>
            <tbody>
              {presentation.evidenceTable.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.before}</td>
                  <td>{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="external-comparison-section">
        <h4>Approved Outcome Checks</h4>
        <div className="external-comparison-checks">
          {presentation.checks.map((check) => (
            <article key={check.identity}>
              <div>
                <strong>{check.approvedDescription}</strong>
                <span>{check.type.replaceAll('_', ' ')}</span>
              </div>
              <dl>
                <div>
                  <dt>Expected</dt>
                  <dd>{conditionLabel(check.expectedCondition)}</dd>
                </div>
                <div>
                  <dt>Before fix</dt>
                  <dd>
                    <strong>{outcomeLabel(check.beforeStatus)}</strong> ·{' '}
                    {conditionLabel(check.beforeObservedCondition)}
                  </dd>
                </div>
                <div>
                  <dt>After fix</dt>
                  <dd>
                    <strong>{outcomeLabel(check.afterStatus)}</strong> ·{' '}
                    {conditionLabel(check.afterObservedCondition)}
                  </dd>
                </div>
              </dl>
              {check.templateBinding !== null ? (
                <p>
                  Generated identity:{' '}
                  <code>{check.templateBinding.template}</code>
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="external-comparison-section">
        <h4>Paired screenshots</h4>
        <div className="external-comparison-screenshots">
          {presentation.screenshots.map((pair) => (
            <article key={pair.label}>
              <h5>{screenshotLabel(pair.label)}</h5>
              <div>
                <Screenshot reference={pair.before} side="Before fix" />
                <Screenshot reference={pair.after} side="After fix" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="external-comparison-section evidence-boundaries">
        <h4>Evidence boundaries</h4>
        <div>
          <article>
            <h5>Observed</h5>
            <ul>
              {presentation.observed.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
          <article>
            <h5>Conclusion</h5>
            <p>
              {presentation.conclusion ?? 'No proof conclusion is available.'}
            </p>
          </article>
          <article>
            <h5>Unknown</h5>
            <ul>
              {presentation.unknowns.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <ConfigurationDetails
        fingerprint={presentation.configurationIdentity.fingerprint}
        items={matchedProperties}
      />

      <details className="external-comparison-technical">
        <summary>Technical evidence</summary>
        <dl>
          <div>
            <dt>Before assertion aggregate</dt>
            <dd>
              {outcomeLabel(presentation.technicalAssertionAggregates.before)}
            </dd>
          </div>
          <div>
            <dt>After assertion aggregate</dt>
            <dd>
              {outcomeLabel(presentation.technicalAssertionAggregates.after)}
            </dd>
          </div>
          <div>
            <dt>Critical Action</dt>
            <dd>
              {presentation.criticalAction.label} ·{' '}
              {presentation.criticalAction.recordedStepName}
            </dd>
          </div>
          <div>
            <dt>Failure recipe</dt>
            <dd>
              {presentation.failureRecipe.triggerCount} triggers ·{' '}
              {presentation.failureRecipe.intervalMs} ms interval
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function ConfigurationDetails({
  items,
  fingerprint,
}: {
  readonly items: ExternalRunComparisonResponse['matchedProperties'];
  readonly fingerprint?: string;
}) {
  return (
    <details className="external-comparison-configuration">
      <summary>Configuration compatibility details</summary>
      {items.length > 0 ? (
        <dl>
          {items.map((item) => (
            <div key={item.key}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {fingerprint !== undefined ? (
        <p>
          Safe configuration fingerprint: <code>{fingerprint}</code>
        </p>
      ) : null}
    </details>
  );
}

function Screenshot({
  reference,
  side,
}: {
  readonly reference: ExternalRunComparisonPresentation['screenshots'][number]['before'];
  readonly side: 'Before fix' | 'After fix';
}) {
  if (reference === null) {
    return (
      <figure>
        <div className="external-comparison-screenshot-unavailable">
          Screenshot unavailable
        </div>
        <figcaption>{side}</figcaption>
      </figure>
    );
  }
  return (
    <figure>
      <a
        aria-label={`Open ${side.toLowerCase()} screenshot`}
        href={getExternalArtifactUrl(reference.runId, reference.artifactId)}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={`${side} ${screenshotLabel(reference.label)} screenshot`}
          src={getExternalArtifactUrl(reference.runId, reference.artifactId)}
        />
      </a>
      <figcaption>{side}</figcaption>
    </figure>
  );
}

function conditionLabel(condition: ExternalRunPresentationCondition): string {
  return condition.description;
}

function outcomeLabel(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function statusLabel(
  value: ExternalRunComparisonPresentation['primaryStatus'],
): string {
  return outcomeLabel(value);
}

function screenshotLabel(
  label: ExternalRunComparisonPresentation['screenshots'][number]['label'],
): string {
  if (label === 'before-disruption') return 'Before action';
  if (label === 'after-disruption') return 'After trigger';
  return 'Final state';
}
