import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { FORMCRASH_SELECTORS } from '../src/checkout/selectors';

const REQUIRED_SELECTORS = [
  'cart',
  'cart-next',
  'contact-step',
  'contact-email',
  'contact-name',
  'contact-next',
  'shipping-step',
  'shipping-address-line-1',
  'shipping-city',
  'shipping-region',
  'shipping-postal-code',
  'shipping-next',
  'review-step',
  'submit-order',
  'submission-status',
  'confirmation-step',
  'confirmation-order-id',
  'order-records',
  'order-record',
  'request-attempts',
  'request-attempt',
  'reset-sample',
  'mode-indicator',
] as const;

describe('stable FormCrash selectors', () => {
  it('defines every required semantic selector exactly once', () => {
    const selectors = Object.values(FORMCRASH_SELECTORS);

    expect(selectors).toEqual(expect.arrayContaining([...REQUIRED_SELECTORS]));
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it('uses every selector constant in the checkout interface', async () => {
    const source = await readFile(
      new URL(
        '../src/checkout/components/checkout-experience.tsx',
        import.meta.url,
      ),
      'utf8',
    );

    for (const key of Object.keys(FORMCRASH_SELECTORS)) {
      expect(source).toContain(`SELECTORS.${key}`);
    }
  });
});
