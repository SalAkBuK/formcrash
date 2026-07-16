'use client';

import type { ExternalRunDetail } from '@formcrash/contracts';

import { getExternalArtifactUrl } from '../api/external-experiments';

export function ExternalRunResult({
  result,
  eyebrow = 'Latest result',
}: {
  readonly result: ExternalRunDetail;
  readonly eyebrow?: string;
}) {
  return (
    <div className={`external-result replay-${result.status}`} role="status">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{result.status.replaceAll('_', ' ')}</h3>
        </div>
        <strong>
          {result.assertions.filter((item) => item.status === 'passed').length}/
          {result.assertions.length} assertions passed
        </strong>
      </div>
      {result.runnerError !== null ? <p>{result.runnerError.message}</p> : null}
      {result.warnings.map((warning) => (
        <p key={warning.code}>{warning.message}</p>
      ))}
      <ul>
        {result.assertions.map((assertion) => (
          <li key={assertion.assertionResultId}>
            <strong>{assertion.status}</strong> — {assertion.description}
            <br />
            <span>{assertion.observedDescription}</span>
          </li>
        ))}
      </ul>
      <p className="technical-note">
        {result.networkObservations.filter((item) => item.matched).length}{' '}
        matched network request(s) · {result.artifacts.length} screenshot
        artifact(s)
      </p>
      {result.networkObservations.some((item) => item.matched) ? (
        <div className="network-evidence-table-wrap">
          <table className="network-evidence-table">
            <thead>
              <tr>
                <th>Attempt</th>
                <th>Request</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {result.networkObservations
                .filter((item) => item.matched)
                .map((observation, index) => (
                  <tr key={observation.requestId}>
                    <td>{index + 1}</td>
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
      ) : null}
      {result.artifacts.length > 0 ? (
        <>
          <div className="external-evidence-heading">
            <h4>Visual evidence</h4>
            <p>
              These images show the form immediately before the repeated action,
              the stabilized interface afterward, and the final state used for
              the result.
            </p>
          </div>
          <div className="external-screenshot-grid">
            {result.artifacts.map((artifact) => {
              const url = getExternalArtifactUrl(
                result.runId,
                artifact.artifactId,
              );
              const caption = screenshotCaption(artifact.label);
              return (
                <figure key={artifact.artifactId}>
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
        </>
      ) : null}
    </div>
  );
}

function screenshotCaption(label: string): {
  readonly title: string;
  readonly description: string;
} {
  if (label === 'before-disruption') {
    return {
      title: 'Before the repeated action',
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
