import type {
  EphemeralRuntimeValues,
  ExternalAssertion,
  HttpHook,
  PersistedJourney,
  RecordedJourneyStep,
  RuntimeVariableDeclarationInput,
} from '@formcrash/contracts';

export interface ResolvedRuntimeValue {
  readonly value: string;
  readonly secret: boolean;
}

export interface RunTemplateContext {
  readonly runId: string;
  readonly shortId: string;
  readonly timestamp: string;
  readonly uniqueEmail: string;
}

export interface ResolvedRuntime {
  readonly values: ReadonlyMap<string, ResolvedRuntimeValue>;
  readonly safeSnapshot: Readonly<Record<string, string>>;
  readonly context: RunTemplateContext;
}

export class MissingRuntimeVariablesError extends Error {
  constructor(readonly missingVariables: readonly string[]) {
    super(
      `Required runtime variables are missing: ${missingVariables.join(', ')}.`,
    );
    this.name = 'MissingRuntimeVariablesError';
  }
}

export class InvalidTemplateError extends Error {
  constructor(expression: string) {
    super(`Unknown or unavailable template expression: {{${expression}}}.`);
    this.name = 'InvalidTemplateError';
  }
}

export function environmentName(name: string): string {
  return `FORMCRASH_VAR_${name}`;
}

export function isVariableConfigured(
  declaration: RuntimeVariableDeclarationInput,
): boolean {
  return (
    declaration.template !== null ||
    process.env[environmentName(declaration.name)] !== undefined
  );
}

export function resolveRuntime(input: {
  readonly runId: string;
  readonly journey: PersistedJourney;
  readonly declarations: readonly RuntimeVariableDeclarationInput[];
  readonly ephemeral: EphemeralRuntimeValues;
  readonly hooks: readonly (HttpHook | null)[];
  readonly assertions?: readonly ExternalAssertion[];
}): ResolvedRuntime {
  const timestamp = new Date().toISOString();
  const shortId = input.runId.replaceAll('-', '').slice(0, 12);
  const context: RunTemplateContext = {
    runId: input.runId,
    shortId,
    timestamp,
    uniqueEmail: `formcrash+${shortId}@example.test`,
  };
  const values = new Map<string, ResolvedRuntimeValue>();
  const declarations = new Map(
    input.declarations.map((declaration) => [declaration.name, declaration]),
  );
  const required = collectReferencedVariables(input.journey, input.hooks);
  collectAssertionVariables(input.assertions ?? [], required);

  for (const name of new Set([
    ...declarations.keys(),
    ...required,
    ...Object.keys(input.ephemeral),
  ])) {
    const declaration = declarations.get(name);
    const ephemeral = input.ephemeral[name];
    const fromEnvironment =
      process.env[environmentName(name)] ??
      // Chunk 5 generated names were themselves used as environment keys.
      // Keep those already-saved journeys runnable while all new declarations
      // use the FORMCRASH_VAR_<NAME> convention.
      (declaration === undefined ? process.env[name] : undefined);
    const direct = ephemeral ?? fromEnvironment;
    if (direct !== undefined) {
      values.set(name, {
        value: direct,
        secret: declaration?.secret ?? required.has(name),
      });
    }
  }

  expandTemplateDependencies(required, declarations, values);
  const pendingTemplates = [...required]
    .map((name) => declarations.get(name))
    .filter(
      (declaration): declaration is RuntimeVariableDeclarationInput =>
        declaration !== undefined &&
        declaration.template !== null &&
        !values.has(declaration.name),
    );
  for (let pass = 0; pass <= pendingTemplates.length; pass += 1) {
    for (const declaration of pendingTemplates) {
      if (values.has(declaration.name) || declaration.template === null)
        continue;
      try {
        const value = resolveTemplate(declaration.template, values, context);
        values.set(declaration.name, {
          value,
          secret: declaration.secret,
        });
      } catch (error: unknown) {
        if (!(error instanceof InvalidTemplateError)) throw error;
      }
    }
  }

  const missing = [...required].filter((name) => !values.has(name)).sort();
  if (missing.length > 0) throw new MissingRuntimeVariablesError(missing);

  // Validate every template used by this execution before any side effect.
  for (const name of required) {
    const declaration = declarations.get(name);
    if (declaration?.template !== null && declaration !== undefined) {
      resolveTemplate(declaration.template, values, context);
    }
  }
  for (const hook of input.hooks) {
    if (hook !== null) resolveHook(hook, values, context);
  }
  for (const step of input.journey.steps) {
    if (step.value?.kind === 'safe') {
      resolveTemplate(step.value.value, values, context);
    }
  }
  validateAssertionTemplates(input.assertions ?? [], values, context);

  return {
    values,
    safeSnapshot: Object.fromEntries(
      [...values.entries()]
        .filter(([, resolved]) => !resolved.secret)
        .map(([name, resolved]) => [name, resolved.value]),
    ),
    context,
  };
}

function collectAssertionVariables(
  assertions: readonly ExternalAssertion[],
  names: Set<string>,
): void {
  for (const assertion of assertions) {
    if (assertion.type === 'text_appeared') {
      collectFromString(assertion.text, names);
    } else if (assertion.type === 'field_retained') {
      if (assertion.expectedValue.kind === 'safe') {
        collectFromString(assertion.expectedValue.value, names);
      } else {
        names.add(assertion.expectedValue.variableName);
      }
    } else if (
      assertion.type === 'final_url_contains' ||
      assertion.type === 'final_url_not_contains'
    ) {
      collectFromString(assertion.value, names);
    }
  }
}

function validateAssertionTemplates(
  assertions: readonly ExternalAssertion[],
  values: ReadonlyMap<string, ResolvedRuntimeValue>,
  context: RunTemplateContext,
): void {
  for (const assertion of assertions) {
    if (assertion.type === 'text_appeared') {
      resolveTemplate(assertion.text, values, context);
    } else if (
      assertion.type === 'field_retained' &&
      assertion.expectedValue.kind === 'safe'
    ) {
      resolveTemplate(assertion.expectedValue.value, values, context);
    } else if (
      assertion.type === 'final_url_contains' ||
      assertion.type === 'final_url_not_contains'
    ) {
      resolveTemplate(assertion.value, values, context);
    }
  }
}

export function resolveStepValue(
  step: RecordedJourneyStep,
  runtime: ResolvedRuntime,
): string {
  if (step.value === null) throw new Error('Recorded step has no value.');
  if (step.value.kind === 'safe') {
    return resolveTemplate(step.value.value, runtime.values, runtime.context);
  }
  const resolved = runtime.values.get(step.value.variableName);
  if (resolved === undefined) {
    throw new MissingRuntimeVariablesError([step.value.variableName]);
  }
  return resolved.value;
}

export function resolveTemplate(
  template: string,
  values: ReadonlyMap<string, ResolvedRuntimeValue>,
  context: RunTemplateContext,
): string {
  return template.replace(/\{\{([^{}]+)\}\}/gu, (_match, raw: string) => {
    const expression = raw.trim();
    if (expression === 'run.id') return context.runId;
    if (expression === 'run.shortId') return context.shortId;
    if (expression === 'timestamp') return context.timestamp;
    if (expression === 'unique.email') return context.uniqueEmail;
    if (expression.startsWith('var.')) {
      const value = values.get(expression.slice(4));
      if (value !== undefined) return value.value;
    }
    throw new InvalidTemplateError(expression);
  });
}

export function resolveHook(
  hook: HttpHook,
  values: ReadonlyMap<string, ResolvedRuntimeValue>,
  context: RunTemplateContext,
): HttpHook {
  return {
    ...hook,
    url: resolveTemplate(hook.url, values, context),
    headers: Object.fromEntries(
      Object.entries(hook.headers).map(([name, value]) => [
        name,
        resolveTemplate(value, values, context),
      ]),
    ),
    body: resolveJson(hook.body, values, context) as HttpHook['body'],
  };
}

function resolveJson(
  value: unknown,
  values: ReadonlyMap<string, ResolvedRuntimeValue>,
  context: RunTemplateContext,
): unknown {
  if (typeof value === 'string') return resolveTemplate(value, values, context);
  if (Array.isArray(value)) {
    return value.map((item) => resolveJson(item, values, context));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveJson(item, values, context),
      ]),
    );
  }
  return value;
}

function collectReferencedVariables(
  journey: PersistedJourney,
  hooks: readonly (HttpHook | null)[],
): Set<string> {
  const names = new Set<string>();
  for (const step of journey.steps) {
    if (step.value?.kind === 'sensitive') names.add(step.value.variableName);
    if (step.value?.kind === 'safe') collectFromString(step.value.value, names);
  }
  for (const hook of hooks) collectFromUnknown(hook, names);
  return names;
}

function collectFromUnknown(value: unknown, names: Set<string>): void {
  if (typeof value === 'string') collectFromString(value, names);
  else if (Array.isArray(value)) {
    for (const item of value) collectFromUnknown(item, names);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectFromUnknown(item, names);
  }
}

function collectFromString(value: string, names: Set<string>): void {
  for (const match of value.matchAll(/\{\{var\.([A-Z][A-Z0-9_]*)\}\}/gu)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
}

function expandTemplateDependencies(
  required: Set<string>,
  declarations: ReadonlyMap<string, RuntimeVariableDeclarationInput>,
  values: ReadonlyMap<string, ResolvedRuntimeValue>,
): void {
  const pending = [...required];
  for (let index = 0; index < pending.length; index += 1) {
    const name = pending[index];
    if (name === undefined || values.has(name)) continue;
    const template = declarations.get(name)?.template;
    if (template === null || template === undefined) continue;
    const dependencies = new Set<string>();
    collectFromString(template, dependencies);
    for (const dependency of dependencies) {
      if (required.has(dependency)) continue;
      required.add(dependency);
      pending.push(dependency);
    }
  }
}
