import type { ImpatientUserExperimentSummary } from '../sample/types.js';
import type { SampleJourneyStep } from './types.js';
import { summarizeStep } from './types.js';

// This is the server-owned copy of the stable selector contract documented by
// ADR 0007. The runner deliberately does not import from the target application.
export const SAMPLE_CHECKOUT_SELECTORS = {
  cart: 'cart',
  cartNext: 'cart-next',
  contactName: 'contact-name',
  contactEmail: 'contact-email',
  contactNext: 'contact-next',
  shippingAddressLine1: 'shipping-address-line-1',
  shippingCity: 'shipping-city',
  shippingRegion: 'shipping-region',
  shippingPostalCode: 'shipping-postal-code',
  shippingNext: 'shipping-next',
  reviewStep: 'review-step',
  submitOrder: 'submit-order',
  confirmationStep: 'confirmation-step',
} as const;

export const IMPATIENT_USER_EXPERIMENT = {
  experimentType: 'impatient_user',
  triggerCount: 2,
  intervalMs: 100,
  targetStep: 'submit-order',
} as const satisfies ImpatientUserExperimentSummary;

export const SAMPLE_CHECKOUT_JOURNEY: readonly SampleJourneyStep[] = [
  {
    id: 'open-checkout',
    name: 'Open the bundled sample checkout',
    action: { type: 'navigate', path: '/' },
  },
  {
    id: 'verify-cart',
    name: 'Verify the cart is visible',
    action: {
      type: 'wait_for_visible',
      selector: SAMPLE_CHECKOUT_SELECTORS.cart,
    },
  },
  {
    id: 'continue-contact',
    name: 'Continue to contact information',
    action: { type: 'click', selector: SAMPLE_CHECKOUT_SELECTORS.cartNext },
  },
  {
    id: 'fill-name',
    name: 'Fill the fake customer name',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.contactName,
      value: 'Ava Example',
    },
  },
  {
    id: 'fill-email',
    name: 'Fill the fake customer email',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.contactEmail,
      value: 'ava@example.test',
    },
  },
  {
    id: 'continue-shipping',
    name: 'Continue to shipping information',
    action: { type: 'click', selector: SAMPLE_CHECKOUT_SELECTORS.contactNext },
  },
  {
    id: 'fill-address',
    name: 'Fill the fake shipping address',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.shippingAddressLine1,
      value: '42 Test Lane',
    },
  },
  {
    id: 'fill-city',
    name: 'Fill the shipping city',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.shippingCity,
      value: 'Demo City',
    },
  },
  {
    id: 'fill-region',
    name: 'Fill the shipping region',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.shippingRegion,
      value: 'Test Region',
    },
  },
  {
    id: 'fill-postal-code',
    name: 'Fill the shipping postal code',
    action: {
      type: 'fill',
      selector: SAMPLE_CHECKOUT_SELECTORS.shippingPostalCode,
      value: '00042',
    },
  },
  {
    id: 'continue-review',
    name: 'Continue to order review',
    action: { type: 'click', selector: SAMPLE_CHECKOUT_SELECTORS.shippingNext },
  },
  {
    id: 'verify-review',
    name: 'Verify the review step is visible',
    action: {
      type: 'wait_for_visible',
      selector: SAMPLE_CHECKOUT_SELECTORS.reviewStep,
    },
  },
  {
    id: 'submit-order',
    name: 'Inject Impatient User at Submit Order',
    action: {
      type: 'inject_impatient_user',
      selector: SAMPLE_CHECKOUT_SELECTORS.submitOrder,
    },
  },
  {
    id: 'wait-confirmation',
    name: 'Wait for checkout confirmation',
    action: {
      type: 'wait_for_visible',
      selector: SAMPLE_CHECKOUT_SELECTORS.confirmationStep,
    },
  },
  {
    id: 'read-test-state',
    name: 'Read final sample application state',
    action: { type: 'read_test_state' },
  },
] as const;

export const SAMPLE_JOURNEY_SUMMARY = {
  id: 'sample-checkout-priority-0',
  name: 'Sample checkout order submission',
  steps: SAMPLE_CHECKOUT_JOURNEY.map(summarizeStep),
} as const;
