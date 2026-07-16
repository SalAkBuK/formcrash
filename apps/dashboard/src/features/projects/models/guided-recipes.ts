import type {
  DiscoveredRequest,
  ExternalAssertion,
} from '@formcrash/contracts';

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

export function recipeAssertions(
  recipe: GuidedRecipe,
  candidate: DiscoveredRequest,
): readonly ExternalAssertion[] {
  const allowedStatuses = allowedResponseStatuses(candidate, recipe);
  if (recipe.id === 'server_duplicate_handling') {
    return [
      {
        id: crypto.randomUUID(),
        type: 'network_request_max',
        maximum: 2,
        description: 'No more than two matching requests are sent.',
      },
      {
        id: crypto.randomUUID(),
        type: 'network_success_max',
        maximum: 1,
        description: 'No more than one matching request succeeds.',
      },
      {
        id: crypto.randomUUID(),
        type: 'network_no_server_errors',
        description: 'No matching response returns HTTP 5xx.',
      },
      {
        id: crypto.randomUUID(),
        type: 'network_all_status',
        allowedStatuses,
        description: `Every matching response uses ${allowedStatuses.join(' or ')}.`,
      },
    ];
  }
  return [
    {
      id: crypto.randomUUID(),
      type: 'network_request_exact',
      expected: 1,
      description: 'Only one matching request is sent.',
    },
    {
      id: crypto.randomUUID(),
      type: 'network_no_server_errors',
      description: 'No matching response returns HTTP 5xx.',
    },
    {
      id: crypto.randomUUID(),
      type: 'network_success_exact',
      expected: 1,
      description: 'Exactly one matching request succeeds.',
    },
    {
      id: crypto.randomUUID(),
      type: 'network_all_status',
      allowedStatuses,
      description: `Every matching response uses ${allowedStatuses.join(' or ')}.`,
    },
  ];
}

function allowedResponseStatuses(
  candidate: DiscoveredRequest,
  recipe: GuidedRecipe,
): number[] {
  const successfulStatuses =
    candidate.status !== null &&
    candidate.status >= 200 &&
    candidate.status < 400
      ? [candidate.status]
      : isMutationMethod(candidate.method)
        ? [200, 201, 202, 204]
        : [200, 204, 304];
  return recipe.id === 'server_duplicate_handling'
    ? [...new Set([...successfulStatuses, 409])]
    : successfulStatuses;
}

function isMutationMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}
