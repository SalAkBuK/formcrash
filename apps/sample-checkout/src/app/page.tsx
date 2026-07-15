import { CheckoutExperience } from '../checkout/components/checkout-experience';
import type { CheckoutMode } from '../checkout/domain/models';
import { checkoutModeSchema } from '../checkout/validation/order-request';

interface SampleCheckoutPageProps {
  readonly searchParams: Promise<{ readonly mode?: string | string[] }>;
}

function resolveMode(value: string | string[] | undefined): {
  mode: CheckoutMode;
  modeNotice: string | null;
} {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = checkoutModeSchema.safeParse(candidate);

  if (parsed.success) {
    return { mode: parsed.data, modeNotice: null };
  }

  return {
    mode: 'fixed',
    modeNotice:
      candidate === undefined
        ? null
        : `Unknown mode “${candidate}” was replaced with the safe fixed mode.`,
  };
}

export default async function SampleCheckoutPage({
  searchParams,
}: SampleCheckoutPageProps) {
  const { mode: requestedMode } = await searchParams;
  const { mode, modeNotice } = resolveMode(requestedMode);

  return <CheckoutExperience mode={mode} modeNotice={modeNotice} />;
}
