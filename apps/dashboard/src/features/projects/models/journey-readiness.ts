import type {
  EphemeralRuntimeValues,
  PersistedJourney,
  RecordedJourneyStep,
} from '@formcrash/contracts';

import type { JourneyRuntimeRequirement } from './journey-runtime';

export type JourneyReadinessLevel = 'pass' | 'warning' | 'blocker';

export interface JourneyReadinessItem {
  readonly id: string;
  readonly level: JourneyReadinessLevel;
  readonly title: string;
  readonly detail: string;
}

export interface JourneyReadinessReport {
  readonly status: 'ready' | 'review' | 'blocked';
  readonly score: number;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly items: readonly JourneyReadinessItem[];
}

export function assessJourneyReadiness(input: {
  readonly journey: PersistedJourney;
  readonly targetStep: RecordedJourneyStep | null;
  readonly runtimeRequirements: readonly JourneyRuntimeRequirement[];
  readonly runtimeValues: EphemeralRuntimeValues;
  readonly generatedValueCount: number;
  readonly authenticationAvailable: boolean;
  readonly cleanupConfigured: boolean;
  readonly production: boolean;
}): JourneyReadinessReport {
  const items: JourneyReadinessItem[] = [];
  items.push(actionReadiness(input.targetStep));
  items.push(runtimeReadiness(input.runtimeRequirements, input.runtimeValues));
  items.push(locatorReadiness(input.journey, input.targetStep));
  items.push(generatedValueReadiness(input.generatedValueCount));
  items.push(normalizationReadiness(input.journey));
  items.push(authenticationReadiness(input.authenticationAvailable));
  items.push(cleanupReadiness(input.cleanupConfigured, input.targetStep));
  if (input.production) {
    items.push({
      id: 'production',
      level: 'warning',
      title: 'This project targets production',
      detail:
        'Analysis and execution can create or modify real data. Explicit confirmation is required.',
    });
  }
  if (input.journey.recordingMetadata.warningCount > 0) {
    items.push({
      id: 'recording-warnings',
      level: 'warning',
      title: `${input.journey.recordingMetadata.warningCount} recorder warning(s) were saved`,
      detail:
        'Review the recorded steps if replay fails or the selected action behaves differently.',
    });
  }

  const blockerCount = items.filter((item) => item.level === 'blocker').length;
  const warningCount = items.filter((item) => item.level === 'warning').length;
  return {
    status:
      blockerCount > 0 ? 'blocked' : warningCount > 0 ? 'review' : 'ready',
    score: Math.max(0, 100 - blockerCount * 35 - warningCount * 8),
    blockerCount,
    warningCount,
    items,
  };
}

function actionReadiness(
  targetStep: RecordedJourneyStep | null,
): JourneyReadinessItem {
  if (targetStep === null) {
    return {
      id: 'action',
      level: 'blocker',
      title: 'No testable action was recorded',
      detail:
        'Record a click or submit action before running a failure experiment.',
    };
  }
  if (targetStep.locator === null) {
    return {
      id: 'action',
      level: 'blocker',
      title: 'The selected action has no replay locator',
      detail:
        'Record the action again so FormCrash can identify the same element during replay.',
    };
  }
  return {
    id: 'action',
    level: 'pass',
    title: 'A replayable action is selected',
    detail: `${targetStep.name} will be used as the disruption point.`,
  };
}

function runtimeReadiness(
  requirements: readonly JourneyRuntimeRequirement[],
  runtimeValues: EphemeralRuntimeValues,
): JourneyReadinessItem {
  const missing = requirements.filter(
    (requirement) =>
      (runtimeValues[requirement.name] ?? '').trim().length === 0,
  );
  if (missing.length > 0) {
    return {
      id: 'runtime',
      level: 'blocker',
      title: `${missing.length} required runtime value(s) are missing`,
      detail: missing.map((requirement) => requirement.label).join(', '),
    };
  }
  return {
    id: 'runtime',
    level: 'pass',
    title: 'Required runtime values are ready',
    detail:
      requirements.length === 0
        ? 'This journey has no unresolved sensitive or custom variables.'
        : `${requirements.length} required value(s) were provided for this run.`,
  };
}

function locatorReadiness(
  journey: PersistedJourney,
  targetStep: RecordedJourneyStep | null,
): JourneyReadinessItem {
  const brittleCount = journey.steps.filter(
    (step) => step.locator?.strategy === 'css',
  ).length;
  if (targetStep?.locator?.strategy === 'css') {
    return {
      id: 'locators',
      level: 'warning',
      title: 'The selected action uses a brittle CSS locator',
      detail:
        'A layout change may break replay. Add a stable ID, name, role, label, data-testid, or data-formcrash attribute.',
    };
  }
  if (brittleCount > 0) {
    return {
      id: 'locators',
      level: 'warning',
      title: `${brittleCount} earlier step(s) use brittle CSS locators`,
      detail:
        'The selected action is stable, but replay can still fail before reaching it.',
    };
  }
  return {
    id: 'locators',
    level: 'pass',
    title: 'Replay locators look stable',
    detail: 'No generated CSS path is required to reach the selected action.',
  };
}

function generatedValueReadiness(
  generatedValueCount: number,
): JourneyReadinessItem {
  return {
    id: 'generated-values',
    level: 'pass',
    title:
      generatedValueCount === 0
        ? 'Recorded values can be replayed as-is'
        : `${generatedValueCount} value(s) will be generated uniquely`,
    detail:
      generatedValueCount === 0
        ? 'No common identity field needs an automatic uniqueness override.'
        : 'FormCrash will avoid reusing common names, emails, phone numbers, or identifiers.',
  };
}

function normalizationReadiness(
  journey: PersistedJourney,
): JourneyReadinessItem {
  let repairCount = 0;
  for (let index = 1; index < journey.steps.length; index += 1) {
    const current = journey.steps[index];
    const previous = journey.steps[index - 1];
    if (
      current?.type === 'navigate' &&
      previous?.type === 'navigate' &&
      current.url === previous.url
    ) {
      repairCount += 1;
    } else if (
      current?.type === 'fill' &&
      previous?.type === 'fill' &&
      current.locator !== null &&
      JSON.stringify(current.locator) === JSON.stringify(previous.locator)
    ) {
      repairCount += 1;
    }
  }
  return {
    id: 'normalization',
    level: 'pass',
    title:
      repairCount === 0
        ? 'The recording has no obvious duplicate steps'
        : `${repairCount} noisy recording step(s) will be repaired`,
    detail:
      repairCount === 0
        ? 'Guided replay can use the saved sequence without coalescing input.'
        : 'Guided mode removes duplicate navigation and keeps only the final adjacent fill for the same field.',
  };
}

function authenticationReadiness(available: boolean): JourneyReadinessItem {
  return available
    ? {
        id: 'authentication',
        level: 'pass',
        title: 'Saved authentication is available',
        detail: 'The replay browser can restore the captured signed-in state.',
      }
    : {
        id: 'authentication',
        level: 'warning',
        title: 'Authentication has not been captured',
        detail:
          'This is fine for public journeys. Signed-in journeys may redirect to login during replay.',
      };
}

function cleanupReadiness(
  configured: boolean,
  targetStep: RecordedJourneyStep | null,
): JourneyReadinessItem {
  if (configured) {
    return {
      id: 'cleanup',
      level: 'pass',
      title: 'After-run cleanup is configured',
      detail:
        'The cleanup hook will run after discovery and experiment execution.',
    };
  }
  return {
    id: 'cleanup',
    level: targetStep?.type === 'submit' ? 'warning' : 'pass',
    title:
      targetStep?.type === 'submit'
        ? 'No automatic cleanup is configured'
        : 'Cleanup is optional for this action',
    detail:
      targetStep?.type === 'submit'
        ? 'If the action creates or updates data, remove it manually or configure an after-run hook.'
        : 'The selected click is not known to submit data.',
  };
}
