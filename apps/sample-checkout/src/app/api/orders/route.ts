import type {
  ApiErrorResponse,
  CheckoutMode,
  OrderSuccessResponse,
} from '../../../checkout/domain/models';
import {
  getSampleCheckoutStore,
  SampleStoreResetError,
} from '../../../checkout/server/store';
import { submitOrder } from '../../../checkout/server/submit-order';
import {
  checkoutModeSchema,
  orderRequestSchema,
} from '../../../checkout/validation/order-request';

export const runtime = 'nodejs';

function extractRejectedIdentity(body: unknown): {
  checkoutAttemptKey: string | null;
  mode: CheckoutMode | null;
} {
  if (typeof body !== 'object' || body === null) {
    return { checkoutAttemptKey: null, mode: null };
  }

  const values = body as Record<string, unknown>;
  const parsedMode = checkoutModeSchema.safeParse(values.mode);
  return {
    checkoutAttemptKey:
      typeof values.checkoutAttemptKey === 'string' &&
      values.checkoutAttemptKey.trim() !== ''
        ? values.checkoutAttemptKey
        : null,
    mode: parsedMode.success ? parsedMode.data : null,
  };
}

function invalidRequestResponse(
  message: string,
  issues?: ApiErrorResponse['error']['issues'],
): Response {
  const error: ApiErrorResponse = {
    error: {
      code: 'INVALID_ORDER_REQUEST',
      message,
      ...(issues === undefined ? {} : { issues }),
    },
  };
  return Response.json(error, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    getSampleCheckoutStore().recordRejectedRequest({
      checkoutAttemptKey: null,
      mode: null,
    });
    return invalidRequestResponse('Request body must be valid JSON.');
  }

  const parsed = orderRequestSchema.safeParse(body);
  if (!parsed.success) {
    getSampleCheckoutStore().recordRejectedRequest(
      extractRejectedIdentity(body),
    );
    return invalidRequestResponse(
      'The order request is invalid.',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  try {
    const result = await submitOrder(parsed.data);
    const response: OrderSuccessResponse = { data: result };
    return Response.json(response, {
      status: result.operation === 'created' ? 201 : 200,
    });
  } catch (error: unknown) {
    if (error instanceof SampleStoreResetError) {
      const response: ApiErrorResponse = {
        error: {
          code: 'STORE_RESET',
          message: error.message,
        },
      };
      return Response.json(response, { status: 409 });
    }

    console.error('Unexpected sample-checkout order failure.', error);
    const response: ApiErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The sample checkout could not create the order.',
      },
    };
    return Response.json(response, { status: 500 });
  }
}
