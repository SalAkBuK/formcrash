'use client';

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { PRODUCTS } from '../domain/catalog';
import type {
  ApiErrorResponse,
  CheckoutMode,
  ContactInformation,
  Order,
  OrderSuccessResponse,
  SampleCheckoutState,
  ShippingInformation,
  StateResponse,
} from '../domain/models';
import { FORMCRASH_SELECTORS as SELECTORS } from '../selectors';

type CheckoutStep = 'cart' | 'contact' | 'shipping' | 'review' | 'confirmation';

type FieldErrors<T> = Partial<Record<keyof T, string>>;

const EMPTY_CONTACT: ContactInformation = { name: '', email: '' };
const EMPTY_SHIPPING: ShippingInformation = {
  addressLine1: '',
  city: '',
  region: '',
  postalCode: '',
};
const EMPTY_STATE: SampleCheckoutState = {
  orders: [],
  requestAttempts: [],
  counts: { orders: 0, requests: 0, accepted: 0, deduplicated: 0, rejected: 0 },
};
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

function validateContact(
  contact: ContactInformation,
): FieldErrors<ContactInformation> {
  const errors: FieldErrors<ContactInformation> = {};
  if (contact.name.trim() === '') errors.name = 'Enter a name.';
  if (!/^\S+@\S+\.\S+$/.test(contact.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  return errors;
}

function validateShipping(
  shipping: ShippingInformation,
): FieldErrors<ShippingInformation> {
  const errors: FieldErrors<ShippingInformation> = {};
  if (shipping.addressLine1.trim() === '')
    errors.addressLine1 = 'Enter an address.';
  if (shipping.city.trim() === '') errors.city = 'Enter a city.';
  if (shipping.region.trim() === '') errors.region = 'Enter a region.';
  if (shipping.postalCode.trim() === '')
    errors.postalCode = 'Enter a postal code.';
  return errors;
}

function hasErrors<T extends object>(errors: FieldErrors<T>): boolean {
  return Object.keys(errors).length > 0;
}

function createAttemptKey(): string {
  return globalThis.crypto.randomUUID();
}

export interface CheckoutExperienceProps {
  readonly mode: CheckoutMode;
  readonly modeNotice: string | null;
}

export function CheckoutExperience({
  mode,
  modeNotice,
}: CheckoutExperienceProps) {
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [contact, setContact] = useState<ContactInformation>(EMPTY_CONTACT);
  const [shipping, setShipping] = useState<ShippingInformation>(EMPTY_SHIPPING);
  const [contactErrors, setContactErrors] = useState<
    FieldErrors<ContactInformation>
  >({});
  const [shippingErrors, setShippingErrors] = useState<
    FieldErrors<ShippingInformation>
  >({});
  const [attemptKey, setAttemptKey] = useState(createAttemptKey);
  const [sampleState, setSampleState] =
    useState<SampleCheckoutState>(EMPTY_STATE);
  const [confirmationOrder, setConfirmationOrder] = useState<Order | null>(
    null,
  );
  const [pendingRequests, setPendingRequests] = useState(0);
  const [submissionMessage, setSubmissionMessage] = useState(
    'Ready to submit fake local test data.',
  );
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const fixedSubmissionLock = useRef(false);
  const evidenceRefreshSequence = useRef(0);

  const refreshEvidence = useCallback(async (): Promise<void> => {
    const refreshSequence = evidenceRefreshSequence.current + 1;
    evidenceRefreshSequence.current = refreshSequence;

    try {
      const response = await fetch('/api/test-support/state', {
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error(`State request failed with ${response.status}.`);
      const payload = (await response.json()) as StateResponse;
      if (refreshSequence === evidenceRefreshSequence.current) {
        setSampleState(payload.data);
        setEvidenceError(null);
      }
    } catch (error: unknown) {
      if (refreshSequence === evidenceRefreshSequence.current) {
        setEvidenceError(
          error instanceof Error
            ? error.message
            : 'Could not read sample state.',
        );
      }
    }
  }, []);

  useEffect(() => {
    void refreshEvidence();
  }, [refreshEvidence]);

  function continueFromContact(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateContact(contact);
    setContactErrors(errors);
    if (!hasErrors(errors)) setStep('shipping');
  }

  function continueFromShipping(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateShipping(shipping);
    setShippingErrors(errors);
    if (!hasErrors(errors)) setStep('review');
  }

  async function submitOrder(): Promise<void> {
    if (mode === 'fixed') {
      if (fixedSubmissionLock.current) return;
      fixedSubmissionLock.current = true;
    }

    setPendingRequests((count) => count + 1);
    setSubmissionMessage(
      mode === 'fixed'
        ? 'Processing one protected submission…'
        : 'Processing request — Submit Order remains intentionally available.',
    );

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          checkoutAttemptKey: attemptKey,
          contact,
          shipping,
          products: PRODUCTS.map((product) => ({
            productId: product.id,
            quantity: 1,
          })),
        }),
      });
      const payload = (await response.json()) as
        OrderSuccessResponse | ApiErrorResponse;

      if (!response.ok || !('data' in payload)) {
        throw new Error(
          'error' in payload
            ? payload.error.message
            : `Order request failed with ${response.status}.`,
        );
      }

      setConfirmationOrder(payload.data.order);
      setSubmissionMessage(
        payload.data.operation === 'created'
          ? `Created ${payload.data.order.id}.`
          : `Protected duplicate resolved to ${payload.data.order.id}.`,
      );
      setStep('confirmation');
    } catch (error: unknown) {
      if (mode === 'fixed') fixedSubmissionLock.current = false;
      setSubmissionMessage(
        error instanceof Error
          ? `${error.message} You may retry deliberately.`
          : 'The order request failed. You may retry deliberately.',
      );
    } finally {
      setPendingRequests((count) => Math.max(0, count - 1));
      await refreshEvidence();
    }
  }

  async function resetSample(): Promise<void> {
    evidenceRefreshSequence.current += 1;
    setSubmissionMessage('Resetting local sample data…');
    try {
      const response = await fetch('/api/test-support/reset', {
        method: 'POST',
      });
      if (!response.ok)
        throw new Error(`Reset failed with ${response.status}.`);
      const payload = (await response.json()) as StateResponse;
      setSampleState(payload.data);
      setStep('cart');
      setContact(EMPTY_CONTACT);
      setShipping(EMPTY_SHIPPING);
      setContactErrors({});
      setShippingErrors({});
      setConfirmationOrder(null);
      setAttemptKey(createAttemptKey());
      fixedSubmissionLock.current = false;
      setSubmissionMessage(
        'Sample data reset. A new checkout attempt is ready.',
      );
      setEvidenceError(null);
    } catch (error: unknown) {
      setSubmissionMessage(
        error instanceof Error ? error.message : 'Could not reset sample data.',
      );
    }
  }

  function startNewCheckout(): void {
    setStep('cart');
    setContact(EMPTY_CONTACT);
    setShipping(EMPTY_SHIPPING);
    setConfirmationOrder(null);
    setAttemptKey(createAttemptKey());
    fixedSubmissionLock.current = false;
    setSubmissionMessage('A new checkout attempt is ready.');
  }

  const subtotalCents = PRODUCTS.reduce(
    (total, product) => total + product.unitPriceCents,
    0,
  );
  const isFixedSubmitting = mode === 'fixed' && fixedSubmissionLock.current;

  return (
    <main className={`checkout-app mode-${mode}`}>
      <header className="site-header">
        <div>
          <p className="eyebrow">FormCrash local test target</p>
          <h1>Sample Checkout</h1>
        </div>
        <nav aria-label="Checkout mode">
          <a href="/?mode=vulnerable">Open vulnerable</a>
          <a href="/?mode=fixed">Open fixed</a>
        </nav>
      </header>

      <section
        className="mode-banner"
        data-formcrash={SELECTORS.modeIndicator}
        aria-label={`Active mode: ${mode}`}
      >
        <strong>{mode === 'fixed' ? 'Fixed mode' : 'Vulnerable mode'}</strong>
        <span>
          {mode === 'fixed'
            ? 'The interface locks immediately and the server deduplicates repeated attempt keys.'
            : 'Rapid Submit Order triggers are intentionally accepted as separate orders.'}
        </span>
      </section>
      {modeNotice === null ? null : (
        <p className="validation-notice" role="alert">
          {modeNotice}
        </p>
      )}
      <p className="test-data-warning">
        Fake local test data only. No payment details are requested or
        processed.
      </p>

      <div className="workspace">
        <section className="checkout-card" aria-labelledby="checkout-heading">
          <div className="step-heading">
            <p>
              Step{' '}
              {[
                'cart',
                'contact',
                'shipping',
                'review',
                'confirmation',
              ].indexOf(step) + 1}{' '}
              of 5
            </p>
            <h2 id="checkout-heading">
              {step === 'cart' && 'Your cart'}
              {step === 'contact' && 'Contact information'}
              {step === 'shipping' && 'Shipping information'}
              {step === 'review' && 'Review order'}
              {step === 'confirmation' && 'Order confirmation'}
            </h2>
          </div>

          {step === 'cart' && (
            <div data-formcrash={SELECTORS.cart}>
              <ProductList />
              <OrderTotal subtotalCents={subtotalCents} />
              <button
                className="primary-action"
                type="button"
                data-formcrash={SELECTORS.cartNext}
                onClick={() => setStep('contact')}
              >
                Continue to contact
              </button>
            </div>
          )}

          {step === 'contact' && (
            <form
              data-formcrash={SELECTORS.contactStep}
              onSubmit={continueFromContact}
              noValidate
            >
              <Field
                id="contact-name"
                label="Full name"
                value={contact.name}
                error={contactErrors.name}
                selector={SELECTORS.contactName}
                autoComplete="name"
                onChange={(name) => setContact((value) => ({ ...value, name }))}
              />
              <Field
                id="contact-email"
                label="Email address"
                type="email"
                value={contact.email}
                error={contactErrors.email}
                selector={SELECTORS.contactEmail}
                autoComplete="email"
                onChange={(email) =>
                  setContact((value) => ({ ...value, email }))
                }
              />
              <StepActions
                previous={() => setStep('cart')}
                nextLabel="Continue to shipping"
                nextSelector={SELECTORS.contactNext}
              />
            </form>
          )}

          {step === 'shipping' && (
            <form
              data-formcrash={SELECTORS.shippingStep}
              onSubmit={continueFromShipping}
              noValidate
            >
              <Field
                id="shipping-address"
                label="Address line 1"
                value={shipping.addressLine1}
                error={shippingErrors.addressLine1}
                selector={SELECTORS.shippingAddressLine1}
                autoComplete="street-address"
                onChange={(addressLine1) =>
                  setShipping((value) => ({ ...value, addressLine1 }))
                }
              />
              <div className="field-grid">
                <Field
                  id="shipping-city"
                  label="City"
                  value={shipping.city}
                  error={shippingErrors.city}
                  selector={SELECTORS.shippingCity}
                  autoComplete="address-level2"
                  onChange={(city) =>
                    setShipping((value) => ({ ...value, city }))
                  }
                />
                <Field
                  id="shipping-region"
                  label="Region"
                  value={shipping.region}
                  error={shippingErrors.region}
                  selector={SELECTORS.shippingRegion}
                  autoComplete="address-level1"
                  onChange={(region) =>
                    setShipping((value) => ({ ...value, region }))
                  }
                />
              </div>
              <Field
                id="shipping-postal"
                label="Postal code"
                value={shipping.postalCode}
                error={shippingErrors.postalCode}
                selector={SELECTORS.shippingPostalCode}
                autoComplete="postal-code"
                onChange={(postalCode) =>
                  setShipping((value) => ({ ...value, postalCode }))
                }
              />
              <StepActions
                previous={() => setStep('contact')}
                nextLabel="Review order"
                nextSelector={SELECTORS.shippingNext}
              />
            </form>
          )}

          {step === 'review' && (
            <div data-formcrash={SELECTORS.reviewStep}>
              <ProductList />
              <dl className="review-details">
                <div>
                  <dt>Contact</dt>
                  <dd>
                    {contact.name} · {contact.email}
                  </dd>
                </div>
                <div>
                  <dt>Ship to</dt>
                  <dd>
                    {shipping.addressLine1}, {shipping.city}, {shipping.region}{' '}
                    {shipping.postalCode}
                  </dd>
                </div>
              </dl>
              <OrderTotal subtotalCents={subtotalCents} />
              <div className="step-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => setStep('shipping')}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="primary-action"
                  data-formcrash={SELECTORS.submitOrder}
                  disabled={isFixedSubmitting}
                  aria-disabled={isFixedSubmitting}
                  onClick={() => void submitOrder()}
                >
                  {isFixedSubmitting ? 'Processing order…' : 'Submit Order'}
                </button>
              </div>
            </div>
          )}

          {step === 'confirmation' && confirmationOrder !== null && (
            <div
              data-formcrash={SELECTORS.confirmationStep}
              className="confirmation"
            >
              <p className="confirmation-mark" aria-hidden="true">
                ✓
              </p>
              <h3>Fake order received</h3>
              <p>
                Order{' '}
                <strong data-formcrash={SELECTORS.confirmationOrderId}>
                  {confirmationOrder.id}
                </strong>{' '}
                was created for this local demonstration.
              </p>
              <button
                type="button"
                className="secondary-action"
                onClick={startNewCheckout}
              >
                Start a new checkout
              </button>
            </div>
          )}

          <p
            className="submission-status"
            data-formcrash={SELECTORS.submissionStatus}
            aria-live="polite"
          >
            {submissionMessage}
            {pendingRequests > 0
              ? ` ${pendingRequests} request(s) in flight.`
              : ''}
          </p>
        </section>

        <aside className="evidence-panel" aria-labelledby="evidence-heading">
          <div className="evidence-header">
            <div>
              <p className="eyebrow">Local test state</p>
              <h2 id="evidence-heading">Request and order evidence</h2>
            </div>
            <div className="evidence-actions">
              <button type="button" onClick={() => void refreshEvidence()}>
                Refresh
              </button>
              <button
                type="button"
                data-formcrash={SELECTORS.resetSample}
                onClick={() => void resetSample()}
              >
                Reset sample data
              </button>
            </div>
          </div>
          <div className="counts" aria-label="Current test-state counts">
            <span>
              <strong>{sampleState.counts.requests}</strong> requests
            </span>
            <span>
              <strong>{sampleState.counts.orders}</strong> orders
            </span>
            <span>
              <strong>{sampleState.counts.deduplicated}</strong> deduplicated
            </span>
          </div>
          {evidenceError === null ? null : <p role="alert">{evidenceError}</p>}

          <EvidenceList
            title="Request attempts"
            selector={SELECTORS.requestAttempts}
            emptyMessage="No requests have reached the sample yet."
          >
            {sampleState.requestAttempts.map((attempt) => (
              <li key={attempt.id} data-formcrash={SELECTORS.requestAttempt}>
                <strong>{attempt.id}</strong>
                <span className={`outcome outcome-${attempt.outcome}`}>
                  {attempt.outcome}
                </span>
                <small>
                  {attempt.mode ?? 'invalid mode'} ·{' '}
                  {attempt.resultingOrderId ?? 'no order'}
                </small>
              </li>
            ))}
          </EvidenceList>

          <EvidenceList
            title="Created orders"
            selector={SELECTORS.orderRecords}
            emptyMessage="No order records exist."
          >
            {sampleState.orders.map((order) => (
              <li key={order.id} data-formcrash={SELECTORS.orderRecord}>
                <strong>{order.id}</strong>
                <span>{formatCurrency(order.subtotalCents)}</span>
                <small>
                  {order.mode} · key {order.checkoutAttemptKey.slice(0, 12)}…
                </small>
              </li>
            ))}
          </EvidenceList>
        </aside>
      </div>
    </main>
  );
}

function ProductList() {
  return (
    <ul className="product-list">
      {PRODUCTS.map((product) => (
        <li key={product.id}>
          <div>
            <strong>{product.name}</strong>
            <p>{product.description}</p>
          </div>
          <span>{formatCurrency(product.unitPriceCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderTotal({ subtotalCents }: { readonly subtotalCents: number }) {
  return (
    <div className="order-total">
      <span>Order total</span>
      <strong>{formatCurrency(subtotalCents)}</strong>
    </div>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly type?: 'email' | 'text';
  readonly selector: string;
  readonly autoComplete: string;
  readonly onChange: (value: string) => void;
}

function Field({
  id,
  label,
  value,
  error,
  type = 'text',
  selector,
  autoComplete,
  onChange,
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        data-formcrash={selector}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error === undefined ? null : (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function StepActions({
  previous,
  nextLabel,
  nextSelector,
}: {
  readonly previous: () => void;
  readonly nextLabel: string;
  readonly nextSelector: string;
}) {
  return (
    <div className="step-actions">
      <button type="button" className="secondary-action" onClick={previous}>
        Previous
      </button>
      <button
        type="submit"
        className="primary-action"
        data-formcrash={nextSelector}
      >
        {nextLabel}
      </button>
    </div>
  );
}

function EvidenceList({
  title,
  selector,
  emptyMessage,
  children,
}: {
  readonly title: string;
  readonly selector: string;
  readonly emptyMessage: string;
  readonly children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : children !== null;
  return (
    <section className="evidence-list" data-formcrash={selector}>
      <h3>{title}</h3>
      {hasChildren ? <ol>{children}</ol> : <p>{emptyMessage}</p>}
    </section>
  );
}
