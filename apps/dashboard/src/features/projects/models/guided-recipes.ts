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
      'Repeats the action twice immediately and evaluates the approved browser Outcome Checks.',
    expectedOutcome: 'Every approved browser Outcome Check passes.',
    triggerCount: 2,
    intervalMs: 0,
  },
  {
    id: 'rapid_triple_action',
    name: 'Impatient triple-click',
    shortName: 'Triple-click',
    description:
      'Triggers the action three times 100 ms apart and evaluates the approved browser Outcome Checks.',
    expectedOutcome: 'Every approved browser Outcome Check passes.',
    triggerCount: 3,
    intervalMs: 100,
  },
  {
    id: 'server_duplicate_handling',
    name: 'Delayed repeated action',
    shortName: 'Delayed repeat',
    description:
      'Repeats the action after 300 ms and evaluates the approved browser Outcome Checks.',
    expectedOutcome: 'Every approved browser Outcome Check passes.',
    triggerCount: 2,
    intervalMs: 300,
  },
];

export function guidedRecipe(id: GuidedRecipeId): GuidedRecipe {
  return guidedRecipes.find((recipe) => recipe.id === id) ?? guidedRecipes[0]!;
}
