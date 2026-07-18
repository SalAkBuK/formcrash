import type { RunEventEnvelope } from '@formcrash/contracts';

import { DisclosurePanel } from '../../../components/ui/disclosure-panel';
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
      <DisclosurePanel
        action="Open timeline"
        className="timeline-disclosure"
        description={`${ordered.length} recorded events for debugging and audit.`}
        title="Technical timeline"
      >
        <TimelineContent events={ordered} />
      </DisclosurePanel>
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
