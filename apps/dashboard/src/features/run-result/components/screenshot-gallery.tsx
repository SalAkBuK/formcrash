'use client';

import type { PersistedRunDetail, RunArtifact } from '@formcrash/contracts';
import { useState } from 'react';

import { getArtifactUrl } from '../api/get-run';

const requiredScreenshots = [
  { label: 'before-disruption', title: 'Before disruption', order: 1 },
  { label: 'after-disruption', title: 'After disruption', order: 2 },
  { label: 'final-result', title: 'Final result', order: 3 },
] as const;

export function ScreenshotGallery({
  run,
}: {
  readonly run: PersistedRunDetail;
}) {
  return (
    <section
      className="panel screenshots-panel"
      aria-labelledby="screenshots-title"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">What the browser saw</p>
          <h2 id="screenshots-title">Visual proof</h2>
          <p className="section-intro">
            Before the repeated action, immediately after it, and the final
            application state.
          </p>
        </div>
        <span className="event-count">{run.artifacts.length} available</span>
      </div>
      <div className="screenshot-grid">
        {requiredScreenshots.map((required) => (
          <ScreenshotCard
            key={required.label}
            run={run}
            artifact={run.artifacts.find(
              (candidate) => candidate.label === required.label,
            )}
            title={required.title}
            order={required.order}
          />
        ))}
      </div>
    </section>
  );
}

function ScreenshotCard({
  run,
  artifact,
  title,
  order,
}: {
  readonly run: PersistedRunDetail;
  readonly artifact: RunArtifact | undefined;
  readonly title: string;
  readonly order: number;
}) {
  const [unavailable, setUnavailable] = useState(false);
  if (artifact === undefined || unavailable) {
    return (
      <article className="screenshot-card screenshot-unavailable">
        <div className="screenshot-placeholder" aria-hidden="true">
          ×
        </div>
        <div className="screenshot-caption">
          <span>Capture {order}</span>
          <h3>{title}</h3>
          <p>Screenshot unavailable. Other persisted evidence remains valid.</p>
        </div>
      </article>
    );
  }

  const source = getArtifactUrl(run.runId, artifact.artifactId);
  return (
    <article className="screenshot-card">
      <a href={source} target="_blank" rel="noreferrer">
        <img
          src={source}
          alt={`${title} screenshot for ${run.mode} run ${run.runId}`}
          onError={() => setUnavailable(true)}
        />
      </a>
      <div className="screenshot-caption">
        <span>Capture {artifact.captureSequence}</span>
        <h3>{title}</h3>
        <p>{Math.round(artifact.sizeBytes / 1_024)} KB · PNG evidence</p>
        <a href={source} target="_blank" rel="noreferrer">
          Open full screenshot
        </a>
      </div>
    </article>
  );
}
