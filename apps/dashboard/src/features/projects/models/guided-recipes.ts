export type GuidedRecipeId =
  'duplicate_action' | 'rapid_triple_action' | 'server_duplicate_handling';

export interface GuidedRecipe {
  readonly id: GuidedRecipeId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly expectedOutcome: string;
  readonly triggerCount: 2 | 3;
  readonly intervalMs: 0 | 100 | 300;
}

export const guidedRecipes: readonly GuidedRecipe[] = [
  {
    id: 'duplicate_action',
    name: 'Accidental double-click',
    shortName: 'Double-click',
    description:
      'Repeats the action twice immediately and expects the browser to send it only once.',
    expectedOutcome: 'One request and one successful response.',
    triggerCount: 2,
    intervalMs: 0,
  },
  {
    id: 'rapid_triple_action',
    name: 'Impatient triple-click',
    shortName: 'Triple-click',
    description:
      'Triggers the action three times 100 ms apart to expose slow loading-state protection.',
    expectedOutcome: 'Still only one request and one successful response.',
    triggerCount: 3,
    intervalMs: 100,
  },
  {
    id: 'server_duplicate_handling',
    name: 'Server duplicate handling',
    shortName: 'Server safety',
    description:
      'Allows the duplicate request to reach the server, but requires at most one success and no server crash.',
    expectedOutcome:
      'Up to two requests, no more than one success, and no HTTP 5xx response.',
    triggerCount: 2,
    intervalMs: 300,
  },
];

export function guidedRecipe(id: GuidedRecipeId): GuidedRecipe {
  return guidedRecipes.find((recipe) => recipe.id === id) ?? guidedRecipes[0]!;
}
