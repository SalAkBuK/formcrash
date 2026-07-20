import { createHash } from 'node:crypto';

import {
  externalRunComparisonResponseSchema,
  type ExternalRunComparisonDifference,
  type ExternalRunComparisonMatchedProperty,
  type ExternalRunComparisonPresentation,
  type ExternalRunComparisonResponse,
  type ExternalRunComparisonStatus,
  type ExternalRunDetail,
  type ExternalRunPresentationCondition,
  type OutcomeCheck,
  type RunArtifact,
} from '@formcrash/contracts';

const DATABASE_UNKNOWN = 'Database state was not inspected.';
const BACKEND_UNKNOWN =
  'Hidden backend records or side effects were not evaluated.';
const CAUSE_UNKNOWN =
  'FormCrash did not prove which frontend or backend code change caused the result.';

type DifferenceCode = ExternalRunComparisonDifference['code'];

export function compareExternalRuns(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
): ExternalRunComparisonResponse {
  const differences: ExternalRunComparisonDifference[] = [];
  const matchedProperties: ExternalRunComparisonMatchedProperty[] = [];
  const addDifference = (code: DifferenceCode, message: string): void => {
    if (!differences.some((item) => item.code === code)) {
      differences.push({ code, message });
    }
  };

  validateRun(before, 'Before', addDifference);
  validateRun(after, 'After', addDifference);

  if (before.runId === after.runId) {
    addDifference(
      'same_run',
      'Before fix and After fix must be different runs.',
    );
  }
  if (before.projectId !== after.projectId) {
    addDifference(
      'different_project',
      'The runs belong to different projects.',
    );
  } else {
    matchedProperties.push({
      key: 'project',
      label: 'Project',
      value: before.projectName,
    });
  }

  const beforeJourney = before.experimentSnapshot.journeySnapshot;
  const afterJourney = after.experimentSnapshot.journeySnapshot;
  if (
    before.journeyId !== after.journeyId ||
    beforeJourney.id !== afterJourney.id ||
    beforeJourney.version !== afterJourney.version
  ) {
    addDifference(
      'different_journey_version',
      'Journey versions differ; this release compares only the same exact journey version.',
    );
  } else {
    matchedProperties.push({
      key: 'journey_version',
      label: 'Journey version',
      value: `${beforeJourney.name} v${beforeJourney.version}`,
    });
  }

  const beforeAction = before.outcomeCheckSnapshot.criticalAction;
  const afterAction = after.outcomeCheckSnapshot.criticalAction;
  if (
    beforeAction === null ||
    afterAction === null ||
    beforeAction.id !== afterAction.id ||
    beforeAction.stepId !== afterAction.stepId ||
    beforeAction.label !== afterAction.label
  ) {
    addDifference(
      'different_critical_action',
      'Critical Actions or their recorded journey steps differ.',
    );
  } else {
    matchedProperties.push({
      key: 'critical_action',
      label: 'Critical Action',
      value: `${beforeAction.label} (${stepName(before, beforeAction.stepId)})`,
    });
  }

  const beforeExperiment = before.experimentSnapshot;
  const afterExperiment = after.experimentSnapshot;
  if (
    beforeExperiment.experimentType !== afterExperiment.experimentType ||
    beforeExperiment.targetStepId !== afterExperiment.targetStepId
  ) {
    addDifference(
      'different_failure_recipe',
      'Repeated-action failure recipes or target steps differ.',
    );
  }
  if (beforeExperiment.triggerCount !== afterExperiment.triggerCount) {
    addDifference('different_trigger_count', 'Failure trigger counts differ.');
  }
  if (beforeExperiment.intervalMs !== afterExperiment.intervalMs) {
    addDifference(
      'different_trigger_interval',
      'Failure trigger intervals differ.',
    );
  }
  if (
    beforeExperiment.continueAfterTarget !== afterExperiment.continueAfterTarget
  ) {
    addDifference(
      'different_continuation_behavior',
      'Post-trigger continuation behavior differs.',
    );
  }
  if (
    beforeExperiment.guided !== afterExperiment.guided ||
    stableStringify(journeyStructure(before)) !==
      stableStringify(journeyStructure(after))
  ) {
    addDifference(
      'different_experiment_configuration',
      'Relevant experiment or journey replay configuration differs.',
    );
  }
  if (
    !differences.some((item) =>
      [
        'different_failure_recipe',
        'different_trigger_count',
        'different_trigger_interval',
        'different_continuation_behavior',
        'different_experiment_configuration',
      ].includes(item.code),
    )
  ) {
    matchedProperties.push({
      key: 'failure_recipe',
      label: 'Failure recipe',
      value: `${beforeExperiment.triggerCount} triggers, ${beforeExperiment.intervalMs} ms interval, ${beforeExperiment.continueAfterTarget ? 'continue after target' : 'stop after target'}`,
    });
  }

  const beforeChecks = normalizedChecks(before);
  const afterChecks = normalizedChecks(after);
  if (
    stableStringify(beforeChecks.map((item) => item.definition)) !==
    stableStringify(afterChecks.map((item) => item.definition))
  ) {
    addDifference(
      'different_outcome_checks',
      'Outcome Check definitions differ.',
    );
  } else if (beforeChecks.length > 0) {
    matchedProperties.push({
      key: 'outcome_checks',
      label: 'Outcome Checks',
      value: beforeChecks
        .map((item) => item.definition.description)
        .join(' · ')
        .slice(0, 500),
    });
  }

  const beforeTemplates = generatedTemplateStrategy(before);
  const afterTemplates = generatedTemplateStrategy(after);
  if (stableStringify(beforeTemplates) !== stableStringify(afterTemplates)) {
    addDifference(
      'different_generated_template_strategy',
      'Generated-value template strategies differ.',
    );
  } else {
    matchedProperties.push({
      key: 'generated_template_strategy',
      label: 'Generated-value strategy',
      value:
        beforeTemplates.templates.length === 0
          ? 'No generated templates'
          : beforeTemplates.templates.join(', ').slice(0, 500),
    });
  }

  if (
    stableStringify(beforeExperiment.networkMatcher) !==
    stableStringify(afterExperiment.networkMatcher)
  ) {
    addDifference(
      'different_request_matcher',
      'Request matcher configuration differs.',
    );
  } else {
    const matcher = beforeExperiment.networkMatcher;
    matchedProperties.push({
      key: 'request_matcher',
      label: 'Request matcher',
      value:
        matcher === null
          ? 'No request matcher'
          : `${matcher.method} ${matcher.host}${matcher.pathname}`,
    });
  }

  if (
    stableStringify(normalizedAssertions(before)) !==
    stableStringify(normalizedAssertions(after))
  ) {
    addDifference(
      'different_assertions',
      'Required technical assertion configuration differs.',
    );
  } else {
    matchedProperties.push({
      key: 'technical_assertions',
      label: 'Technical assertions',
      value: `${beforeExperiment.assertions.length} matching definition${beforeExperiment.assertions.length === 1 ? '' : 's'}`,
    });
  }

  if (Date.parse(before.createdAt) >= Date.parse(after.createdAt)) {
    addDifference(
      'reverse_chronology',
      'Before fix must have been created earlier than After fix.',
    );
  }

  if (differences.length > 0) {
    return externalRunComparisonResponseSchema.parse({
      compatibility: 'incompatible',
      primaryStatus: 'incompatible',
      differences: differences.slice(0, 20),
      matchedProperties,
      presentation: null,
    });
  }

  const presentation = buildPresentation(before, after);
  return externalRunComparisonResponseSchema.parse({
    compatibility: 'compatible',
    primaryStatus: presentation.primaryStatus,
    differences: [],
    matchedProperties,
    presentation,
  });
}

function validateRun(
  run: ExternalRunDetail,
  label: 'Before' | 'After',
  addDifference: (code: DifferenceCode, message: string) => void,
): void {
  if (run.lifecycleStatus === 'runner_error' || run.runnerError !== null) {
    addDifference(
      'runner_error',
      `${label} fix ended with a runner error and is not a completed outcome.`,
    );
  } else if (run.lifecycleStatus !== 'completed') {
    addDifference('run_not_completed', `${label} fix has not completed.`);
  }
  if (
    run.outcomeAggregate === 'not_configured' ||
    run.outcomeCheckSnapshot.criticalAction === null ||
    run.outcomeCheckSnapshot.checks.length === 0
  ) {
    addDifference(
      'outcome_checks_not_configured',
      `${label} fix predates configured Outcome Checks or has no approved Outcome Checks.`,
    );
  }
  const resultIds = new Set(
    run.outcomeCheckResults.map((result) => result.outcomeCheckId),
  );
  if (
    run.outcomeCheckResults.length === 0 ||
    run.outcomeCheckResults.length !== run.outcomeCheckSnapshot.checks.length ||
    run.outcomeCheckSnapshot.checks.some((check) => !resultIds.has(check.id)) ||
    run.outcomeCheckResults.some((result) => {
      const check = run.outcomeCheckSnapshot.checks.find(
        (item) => item.id === result.outcomeCheckId,
      );
      return (
        check === undefined ||
        check.type !== result.type ||
        result.journeyId !== run.journeyId ||
        result.criticalActionId !== run.outcomeCheckSnapshot.criticalAction?.id
      );
    })
  ) {
    addDifference(
      'outcome_results_missing',
      `${label} fix has no complete persisted Outcome Check results.`,
    );
  }
}

function buildPresentation(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
): ExternalRunComparisonPresentation {
  const checkPairs = pairedChecks(before, after);
  const defining =
    checkPairs.find((check) => check.beforeStatus === 'failed') ??
    checkPairs[0];
  if (defining === undefined) {
    throw new Error('Compatible comparisons require a defining Outcome Check.');
  }
  const evidenceComplete =
    defining.beforeObservedCondition.kind !== 'unavailable' &&
    defining.afterObservedCondition.kind !== 'unavailable';
  const primaryStatus = comparisonStatus(
    before,
    after,
    defining,
    evidenceComplete,
  );
  const requestCounts = successfulRequestCounts(before, after);
  const exactOnce = checkPairs.find(
    (check) => check.type === 'matching_item_appears_exactly_once',
  );
  const evidenceTable: ExternalRunComparisonPresentation['evidenceTable'] = [
    {
      key: 'critical_action_triggers',
      label: 'Critical-action triggers',
      before: before.triggerAttempts,
      after: after.triggerAttempts,
    },
  ];
  if (requestCounts !== null) {
    evidenceTable.push({
      key: 'successful_matching_requests',
      label: 'Successful matching requests',
      before: requestCounts.before,
      after: requestCounts.after,
    });
  }
  if (exactOnce !== undefined) {
    evidenceTable.push(
      {
        key: 'visible_matching_results',
        label: 'Visible matching results',
        before:
          conditionCount(exactOnce.beforeObservedCondition) ?? 'Unavailable',
        after:
          conditionCount(exactOnce.afterObservedCondition) ?? 'Unavailable',
      },
      {
        key: 'expected_visible_results',
        label: 'Expected visible results',
        before: conditionCount(exactOnce.expectedCondition) ?? 'Unavailable',
        after: conditionCount(exactOnce.expectedCondition) ?? 'Unavailable',
      },
    );
  }
  evidenceTable.push({
    key: 'outcome',
    label: 'Outcome',
    before: aggregateLabel(before.outcomeAggregate),
    after: aggregateLabel(after.outcomeAggregate),
  });

  const action = before.outcomeCheckSnapshot.criticalAction;
  if (action === null) throw new Error('Compatible comparison has no action.');
  const targetStep = before.experimentSnapshot.journeySnapshot.steps.find(
    (step) => step.id === before.experimentSnapshot.targetStepId,
  );
  if (targetStep === undefined) {
    throw new Error('Compatible comparison target step is missing.');
  }
  const fingerprint = createHash('sha256')
    .update(stableStringify(configurationIdentity(before)))
    .digest('hex');

  return {
    primaryStatus,
    headline: headline(primaryStatus),
    summary: summary(primaryStatus),
    beforeRun: runReference(before, 'Before fix'),
    afterRun: runReference(after, 'After fix'),
    criticalAction: {
      id: action.id,
      stepId: action.stepId,
      label: action.label,
      recordedStepName: stepName(before, action.stepId),
    },
    failureRecipe: {
      type: 'impatient_user',
      targetStepId: before.experimentSnapshot.targetStepId,
      targetStepName: targetStep.name,
      triggerCount: before.experimentSnapshot.triggerCount,
      intervalMs: before.experimentSnapshot.intervalMs,
      continueAfterTarget: before.experimentSnapshot.continueAfterTarget,
    },
    checks: checkPairs,
    evidenceTable,
    successfulRequestCounts: requestCounts,
    technicalAssertionAggregates: {
      before: before.assertionAggregate,
      after: after.assertionAggregate,
    },
    screenshots: screenshotPairs(before, after),
    configurationIdentity: { algorithm: 'sha256', fingerprint },
    observed: observedFacts(before, after, exactOnce, requestCounts),
    conclusion: conclusion(primaryStatus, exactOnce !== undefined),
    unknowns: [DATABASE_UNKNOWN, BACKEND_UNKNOWN, CAUSE_UNKNOWN],
  };
}

function pairedChecks(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
): ExternalRunComparisonPresentation['checks'] {
  const beforeChecks = normalizedChecks(before);
  const afterChecks = normalizedChecks(after);
  return beforeChecks.map((beforeItem, index) => {
    const afterItem = afterChecks[index];
    if (afterItem === undefined)
      throw new Error('Outcome Check pair is missing.');
    const beforeResult = before.outcomeCheckResults.find(
      (result) => result.outcomeCheckId === beforeItem.check.id,
    );
    const afterResult = after.outcomeCheckResults.find(
      (result) => result.outcomeCheckId === afterItem.check.id,
    );
    const beforePresented = before.presentation.checks.find(
      (check) => check.outcomeCheckId === beforeItem.check.id,
    );
    const afterPresented = after.presentation.checks.find(
      (check) => check.outcomeCheckId === afterItem.check.id,
    );
    if (
      beforeResult === undefined ||
      afterResult === undefined ||
      beforePresented === undefined ||
      afterPresented === undefined
    ) {
      throw new Error('Compatible Outcome Check evidence is incomplete.');
    }
    return {
      identity: createHash('sha256')
        .update(stableStringify(beforeItem.definition))
        .digest('hex')
        .slice(0, 24),
      outcomeCheckId: beforeItem.check.id,
      type: beforeItem.check.type,
      approvedDescription: beforePresented.approvedDescription,
      expectedCondition: beforePresented.expectedCondition,
      beforeStatus: beforeResult.status,
      afterStatus: afterResult.status,
      beforeObservedCondition: beforePresented.observedCondition,
      afterObservedCondition: afterPresented.observedCondition,
      templateBinding: beforeResult.templateBinding,
      beforeEvidenceReferences: beforeResult.evidenceReferences,
      afterEvidenceReferences: afterResult.evidenceReferences,
    };
  });
}

function comparisonStatus(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
  defining: ExternalRunComparisonPresentation['checks'][number],
  evidenceComplete: boolean,
): Exclude<ExternalRunComparisonStatus, 'incompatible'> {
  if (
    before.outcomeAggregate === 'could_not_verify' ||
    after.outcomeAggregate === 'could_not_verify' ||
    !evidenceComplete
  ) {
    return 'could_not_verify';
  }
  if (
    before.outcomeAggregate === 'failed' &&
    after.outcomeAggregate === 'passed' &&
    defining.beforeStatus === 'failed' &&
    defining.afterStatus === 'passed'
  ) {
    return 'protection_verified';
  }
  if (
    before.outcomeAggregate === 'failed' &&
    after.outcomeAggregate === 'failed' &&
    defining.beforeStatus === 'failed' &&
    defining.afterStatus === 'failed'
  ) {
    return 'still_failing';
  }
  if (
    before.outcomeAggregate === 'passed' &&
    after.outcomeAggregate === 'failed'
  ) {
    return 'regressed';
  }
  return 'no_material_change';
}

function headline(
  status: Exclude<ExternalRunComparisonStatus, 'incompatible'>,
): string {
  switch (status) {
    case 'protection_verified':
      return 'Repeated-submission protection verified.';
    case 'still_failing':
      return 'The repeated-submission outcome is still failing.';
    case 'regressed':
      return 'The later compatible run regressed.';
    case 'no_material_change':
      return 'No failed-to-passed improvement was demonstrated.';
    case 'could_not_verify':
      return 'FormCrash could not verify a reliable before-and-after change.';
  }
}

function summary(
  status: Exclude<ExternalRunComparisonStatus, 'incompatible'>,
): string {
  switch (status) {
    case 'protection_verified':
      return 'The same controlled repeated-action experiment failed before the fix and passed after the fix.';
    case 'still_failing':
      return 'Both compatible runs failed the approved defining Outcome Check.';
    case 'regressed':
      return 'The earlier compatible run passed, but the later run failed the approved outcome.';
    case 'no_material_change':
      return 'The compatible outcomes do not establish a failed-to-passed improvement.';
    case 'could_not_verify':
      return 'At least one completed run lacks a reliable verified outcome or defining observation.';
  }
}

function conclusion(
  status: Exclude<ExternalRunComparisonStatus, 'incompatible'>,
  exactOnce: boolean,
): string | null {
  if (status === 'protection_verified') {
    return exactOnce
      ? 'The same repeated-submission experiment produced duplicate visible results before the fix and exactly one visible result after the fix.'
      : 'The same repeated-submission experiment failed its approved browser-visible outcome before the fix and passed it after the fix.';
  }
  if (status === 'still_failing') {
    return 'The expected result still does not occur correctly under repeated submission.';
  }
  if (status === 'regressed') {
    return 'The later compatible run no longer satisfies the approved outcome.';
  }
  if (status === 'no_material_change') {
    return 'These compatible runs do not prove that repeated-submission protection improved.';
  }
  return 'The available evidence is insufficient for a verified protection conclusion.';
}

function successfulRequestCounts(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
): { readonly before: number; readonly after: number } | null {
  if (
    before.experimentSnapshot.networkMatcher === null ||
    after.experimentSnapshot.networkMatcher === null
  ) {
    return null;
  }
  const beforeIds = referencedRequestIds(before);
  const afterIds = referencedRequestIds(after);
  if (beforeIds.size === 0 || afterIds.size === 0) return null;
  return {
    before: countSuccessfulRequests(before, beforeIds),
    after: countSuccessfulRequests(after, afterIds),
  };
}

function referencedRequestIds(run: ExternalRunDetail): ReadonlySet<string> {
  return new Set(
    run.outcomeCheckResults.flatMap(
      (result) => result.evidenceReferences.requestObservationIds,
    ),
  );
}

function countSuccessfulRequests(
  run: ExternalRunDetail,
  ids: ReadonlySet<string>,
): number {
  return run.networkObservations.filter(
    (item) =>
      ids.has(item.requestId) &&
      item.matched &&
      !item.failed &&
      item.completedAtMs !== null &&
      item.status !== null &&
      item.status >= 200 &&
      item.status < 400,
  ).length;
}

function observedFacts(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
  exactOnce: ExternalRunComparisonPresentation['checks'][number] | undefined,
  requestCounts: { readonly before: number; readonly after: number } | null,
): string[] {
  const facts = [
    `The Critical Action was triggered ${before.triggerAttempts} times before and ${after.triggerAttempts} times after.`,
  ];
  if (requestCounts !== null) {
    facts.push(
      `${requestCounts.before} matching requests completed successfully before and ${requestCounts.after} after.`,
    );
  }
  if (exactOnce !== undefined) {
    facts.push(
      `${conditionCount(exactOnce.beforeObservedCondition) ?? 'An unavailable number of'} visible matching results were observed before and ${conditionCount(exactOnce.afterObservedCondition) ?? 'an unavailable number of'} after; the approved expected count was ${conditionCount(exactOnce.expectedCondition) ?? 'unavailable'}.`,
    );
  }
  return facts;
}

function screenshotPairs(
  before: ExternalRunDetail,
  after: ExternalRunDetail,
): ExternalRunComparisonPresentation['screenshots'] {
  return (
    ['before-disruption', 'after-disruption', 'final-result'] as const
  ).map((label) => ({
    label,
    before: screenshotReference(before.artifacts, label),
    after: screenshotReference(after.artifacts, label),
  }));
}

function screenshotReference(
  artifacts: readonly RunArtifact[],
  label: RunArtifact['label'],
) {
  const artifact = artifacts.find((item) => item.label === label);
  return artifact === undefined
    ? null
    : {
        artifactId: artifact.artifactId,
        runId: artifact.runId,
        label: artifact.label,
        createdAt: artifact.createdAt,
      };
}

function runReference(
  run: ExternalRunDetail,
  label: 'Before fix' | 'After fix',
) {
  if (run.completedAt === null)
    throw new Error('Completed run has no timestamp.');
  return {
    runId: run.runId,
    experimentVersionId: run.experimentVersionId,
    label,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    outcomeAggregate: run.outcomeAggregate,
    assertionAggregate: run.assertionAggregate,
  };
}

function normalizedChecks(run: ExternalRunDetail): Array<{
  readonly check: OutcomeCheck;
  readonly definition: Record<string, unknown>;
}> {
  return run.outcomeCheckSnapshot.checks
    .map((check) => ({ check, definition: normalizedCheck(check) }))
    .sort((left, right) => {
      const priority =
        checkPriority(left.check.type) - checkPriority(right.check.type);
      return priority !== 0
        ? priority
        : stableStringify(left.definition).localeCompare(
            stableStringify(right.definition),
          );
    });
}

function normalizedCheck(check: OutcomeCheck): Record<string, unknown> {
  const definition: Record<string, unknown> = { ...check };
  delete definition.id;
  delete definition.journeyId;
  delete definition.criticalActionId;
  delete definition.createdAt;
  return definition;
}

function normalizedAssertions(run: ExternalRunDetail): unknown[] {
  return run.experimentSnapshot.assertions
    .map((assertion) => {
      const configuration: Record<string, unknown> = { ...assertion };
      delete configuration.id;
      delete configuration.description;
      return configuration;
    })
    .sort((left, right) =>
      stableStringify(left).localeCompare(stableStringify(right)),
    );
}

function generatedTemplateStrategy(run: ExternalRunDetail): {
  readonly steps: readonly unknown[];
  readonly templates: readonly string[];
} {
  const steps = run.experimentSnapshot.journeySnapshot.steps.map((step) => {
    if (step.value === null) return { stepId: step.id, value: 'none' };
    if (step.value.kind === 'sensitive') {
      return {
        stepId: step.id,
        value: 'runtime_variable',
        variableName: step.value.variableName,
      };
    }
    const templates = step.value.value.match(/\{\{[^{}]+\}\}/gu) ?? [];
    return {
      stepId: step.id,
      value: templates.length === 0 ? 'static' : 'templates',
      templates,
    };
  });
  const templates = [
    ...new Set([
      ...steps.flatMap((step) =>
        'templates' in step && Array.isArray(step.templates)
          ? step.templates
          : [],
      ),
      ...run.outcomeCheckSnapshot.checks.flatMap((check) =>
        check.type === 'matching_item_appears_exactly_once'
          ? [check.binding.template]
          : [],
      ),
    ]),
  ].sort();
  return { steps, templates };
}

function journeyStructure(run: ExternalRunDetail): unknown[] {
  return run.experimentSnapshot.journeySnapshot.steps.map((step) => ({
    id: step.id,
    name: step.name,
    type: step.type,
    locator: step.locator,
    fingerprint: step.fingerprint,
    sensitive: step.sensitive,
  }));
}

function configurationIdentity(run: ExternalRunDetail): unknown {
  const action = run.outcomeCheckSnapshot.criticalAction;
  return {
    projectId: run.projectId,
    journey: {
      id: run.journeyId,
      version: run.experimentSnapshot.journeySnapshot.version,
      structure: journeyStructure(run),
    },
    criticalAction:
      action === null
        ? null
        : { id: action.id, stepId: action.stepId, label: action.label },
    recipe: {
      type: run.experimentSnapshot.experimentType,
      targetStepId: run.experimentSnapshot.targetStepId,
      triggerCount: run.experimentSnapshot.triggerCount,
      intervalMs: run.experimentSnapshot.intervalMs,
      continueAfterTarget: run.experimentSnapshot.continueAfterTarget,
      guided: run.experimentSnapshot.guided,
    },
    outcomeChecks: normalizedChecks(run).map((item) => item.definition),
    templates: generatedTemplateStrategy(run),
    requestMatcher: run.experimentSnapshot.networkMatcher,
    assertions: normalizedAssertions(run),
  };
}

function stepName(run: ExternalRunDetail, stepId: string): string {
  return (
    run.experimentSnapshot.journeySnapshot.steps.find(
      (step) => step.id === stepId,
    )?.name ?? 'Recorded action'
  );
}

function checkPriority(type: OutcomeCheck['type']): number {
  if (type === 'matching_item_appears_exactly_once') return 0;
  if (type === 'visible_element_exists') return 1;
  return 2;
}

function conditionCount(
  condition: ExternalRunPresentationCondition,
): number | null {
  return condition.kind === 'visible_match_count' ? condition.count : null;
}

function aggregateLabel(value: ExternalRunDetail['outcomeAggregate']): string {
  if (value === 'could_not_verify') return 'Could not verify';
  if (value === 'not_configured') return 'Not configured';
  return value === 'passed' ? 'Passed' : 'Failed';
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]),
  );
}
