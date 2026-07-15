import type { RunEventEnvelope } from '@formcrash/contracts';

import { formatRelativeTime } from '../../../lib/formatters';
import { presentRunEvent } from '../models/event-presentation';

export function EventTimeline({
  events,
  collapsible = false,
}: {
  readonly events: readonly RunEventEnvelope[];
  readonly collapsible?: boolean;
}) {
  const ordered = [...events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  if (collapsible) {
    return (
      <details className="panel timeline-disclosure">
        <summary>
          <span>
            <small>Developer detail</small>
            <strong>Technical timeline</strong>
            <span>
              {ordered.length} recorded events for debugging and audit.
            </span>
          </span>
          <span className="disclosure-action">Open timeline</span>
        </summary>
        <div className="timeline-disclosure-body">
          <TimelineContent events={ordered} />
        </div>
      </details>
    );
  }

  return (
    <section className="panel timeline-panel" aria-labelledby="timeline-title">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Persisted chronology</p>
          <h2 id="timeline-title">Evidence timeline</h2>
        </div>
        <span className="event-count">{ordered.length} events</span>
      </div>
      <TimelineContent events={ordered} />
    </section>
  );
}

function TimelineContent({
  events,
}: {
  readonly events: readonly RunEventEnvelope[];
}) {
  if (events.length === 0) {
    return (
      <p className="state-message" role="status">
        Waiting for the first recorded event…
      </p>
    );
  }
  return (
    <ol className="timeline-list">
      {events.map((event) => {
        const presentation = presentRunEvent(event);
        return (
          <li
            className={`timeline-event event-${presentation.category}`}
            key={event.eventId}
          >
            <span className="timeline-marker" aria-hidden="true" />
            <div className="timeline-event-body">
              <div className="timeline-event-heading">
                <div>
                  <span className="event-category">
                    {presentation.category}
                  </span>
                  <h3>{presentation.label}</h3>
                </div>
                <time>{formatRelativeTime(event.relativeTimestampMs)}</time>
              </div>
              <p>{presentation.summary}</p>
              <details>
                <summary>Technical event detail</summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
