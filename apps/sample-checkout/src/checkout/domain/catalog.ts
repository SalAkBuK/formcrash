export const PRODUCTS = [
  {
    id: 'resilience-mug',
    name: 'Resilience Mug',
    description: 'A ceramic reminder to test the unhappy path.',
    unitPriceCents: 1800,
  },
  {
    id: 'retry-notebook',
    name: 'Retry Notebook',
    description: 'A ruled notebook for deterministic test plans.',
    unitPriceCents: 1250,
  },
] as const;

export type ProductId = (typeof PRODUCTS)[number]['id'];

export const PRODUCT_IDS = PRODUCTS.map((product) => product.id) as [
  ProductId,
  ...ProductId[],
];

export function getProduct(productId: ProductId) {
  const product = PRODUCTS.find((candidate) => candidate.id === productId);

  if (product === undefined) {
    throw new Error(
      `Known product ${productId} is missing from the catalogue.`,
    );
  }

  return product;
}
