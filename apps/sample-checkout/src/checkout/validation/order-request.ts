import { z } from 'zod';

import { PRODUCT_IDS } from '../domain/catalog';
import { CHECKOUT_MODES } from '../domain/models';

const requiredText = (fieldName: string, maximumLength: number) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} is required.`)
    .max(maximumLength, `${fieldName} is too long.`);

export const checkoutModeSchema = z.enum(CHECKOUT_MODES);
export const productIdSchema = z.enum(PRODUCT_IDS);

export const orderRequestSchema = z.object({
  mode: checkoutModeSchema,
  checkoutAttemptKey: z
    .string()
    .trim()
    .min(1, 'Checkout-attempt key is required.')
    .max(200, 'Checkout-attempt key is too long.'),
  contact: z.object({
    name: requiredText('Name', 100),
    email: z
      .email('Enter a valid email address.')
      .trim()
      .max(254, 'Email address is too long.')
      .transform((email) => email.toLowerCase()),
  }),
  shipping: z.object({
    addressLine1: requiredText('Address', 200),
    city: requiredText('City', 100),
    region: requiredText('Region', 100),
    postalCode: requiredText('Postal code', 20),
  }),
  products: z
    .array(
      z.object({
        productId: productIdSchema,
        quantity: z
          .number()
          .int('Quantity must be a whole number.')
          .min(1, 'Quantity must be at least 1.')
          .max(10, 'Quantity cannot exceed 10.'),
      }),
    )
    .min(1, 'At least one product is required.')
    .superRefine((products, context) => {
      const seenProductIds = new Set<string>();

      for (const [index, product] of products.entries()) {
        if (seenProductIds.has(product.productId)) {
          context.addIssue({
            code: 'custom',
            message: 'Each product may appear only once.',
            path: [index, 'productId'],
          });
        }
        seenProductIds.add(product.productId);
      }
    }),
});
