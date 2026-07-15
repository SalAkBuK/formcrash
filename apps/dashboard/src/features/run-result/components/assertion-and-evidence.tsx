import type { PersistedRunDetail } from '@formcrash/contracts';

import { formatCount, sentenceCase } from '../../../lib/formatters';
import { countEvents } from '../models/event-presentation';

export function AssertionAndEvidence({
  run,
}: {
  readonly run: PersistedRunDetail;
}) {
  const assertion = requireAssertion(run);
  const observed = run.observed;
  const triggers = countEvents(run.events, 'experiment.triggered');
  const failed = assertion.status === 'failed';
  const passed = assertion.status === 'passed';
  return (
    <section
      className={`panel finding-panel finding-${assertion.status}`}
      aria-labelledby="finding-title"
    >
      <div className="finding-heading">
        <div>
          <p className="eyebrow">What happened</p>
          <h2 id="finding-title">{findingTitle(assertion.status)}</h2>
        </div>
        <span className={`status-badge status-${assertion.status}`}>
          {sentenceCase(assertion.status)}
        </span>
      </div>

      {observed === null ? (
        <p className="state-message">
          Application evidence was unavailable before this run stopped.
        </p>
      ) : (
        <>
          <p className="finding-lead">
            {findingLead(failed, passed, triggers, observed.createdOrderCount)}
          </p>
          <dl className="proof-grid" aria-label="Result proof">
            <Proof label="Rapid triggers" value={triggers} />
            <Proof label="Requests accepted" value={observed.acceptedCount} />
            <Proof
              label="Orders created"
              value={observed.createdOrderCount}
              emphasized
            />
            <Proof label="Maximum allowed" value={assertion.expectedMaximum} />
          </dl>

          <div className="finding-outcome">
            <div>
              <span>Expected</span>
              <strong>No more than one order should be created.</strong>
            </div>
            <div>
              <span>Observed</span>
              <strong>{assertion.observedDescription}</strong>
            </div>
          </div>

          <div className="finding-guidance-grid">
            <article className="impact-card">
              <p className="eyebrow">Why this matters</p>
              <h3>
                {failed
                  ? 'Customers can create duplicate transactions'
                  : 'Repeat actions stayed safe'}
              </h3>
              <p>
                {failed
                  ? 'A double-click, retry, or slow response can create multiple business records for one intended action.'
                  : 'The repeated action did not produce a duplicate business record in this run.'}
              </p>
            </article>
            <article className="recommendation-card">
              <p className="eyebrow">Recommended protection</p>
              <h3>
                {failed
                  ? 'Protect both sides of the request'
                  : 'Keep defense in depth'}
              </h3>
              <ul>
                <li>Lock the submit action while a request is pending.</li>
                <li>
                  Enforce server-side idempotency for the same attempt key.
                </li>
              </ul>
            </article>
          </div>

          <details className="evidence-details">
            <summary>
              Inspect request counts, order IDs, and assertion values
            </summary>
            <div className="evidence-details-body">
              <dl className="evidence-metrics">
                <Metric
                  label="Browser order requests"
                  value={observed.browserOrderRequestCount}
                />
                <Metric
                  label="Application attempts"
                  value={observed.requestAttemptCount}
                />
                <Metric label="Accepted" value={observed.acceptedCount} />
                <Metric
                  label="Deduplicated"
                  value={observed.deduplicatedCount}
                />
                <Metric label="Rejected" value={observed.rejectedCount} />
              </dl>
              <p className="technical-note">
                Request attempts are network/application activity. Created
                orders are the resulting business records.
              </p>
              <div className="order-ids">
                <h3>Resulting order IDs</h3>
                {observed.orderIds.length === 0 ? (
                  <p>No order IDs were captured.</p>
                ) : (
                  <ul>
                    {observed.orderIds.map((orderId) => (
                      <li key={orderId}>
                        <code>{orderId}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <pre>
                {JSON.stringify(
                  {
                    expectedMaximum: assertion.expectedMaximum,
                    observedCount: assertion.observedCount,
                    status: assertion.status,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </details>
          <p className="sr-only">
            {formatCount(observed.createdOrderCount, 'order')} created.
          </p>
        </>
      )}
    </section>
  );
}

function findingTitle(status: string): string {
  if (status === 'failed') return 'Two submissions created two orders';
  if (status === 'passed') return 'Repeated submission produced one order';
  return 'The duplicate-protection check was not evaluated';
}

function findingLead(
  failed: boolean,
  passed: boolean,
  triggers: number,
  orders: number,
): string {
  if (failed) {
    return `FormCrash issued ${triggers} rapid triggers and the application created ${orders} separate orders.`;
  }
  if (passed) {
    return `FormCrash issued ${triggers} rapid triggers and the application created ${orders} order.`;
  }
  return 'The run stopped before FormCrash could prove whether duplicate protection held.';
}

function Proof({
  label,
  value,
  emphasized = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? 'proof-emphasized' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function requireAssertion(run: PersistedRunDetail) {
  const assertion = run.assertions[0];
  if (assertion === undefined) {
    throw new Error('Validated run detail is missing its recovery assertion.');
  }
  return assertion;
}

function Metric({
  label,
  value,
  emphasized = false,
}: {
  readonly label: string;
  readonly value: number;
  readonly emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? 'metric-emphasized' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
