import type {
  PersistedJourney,
  ProjectExecutionSettings,
} from '@formcrash/contracts';

export interface JourneyRuntimeRequirement {
  readonly name: string;
  readonly label: string;
  readonly secret: boolean;
}

export function journeyRuntimeRequirements(
  journey: PersistedJourney,
  settings: ProjectExecutionSettings | null,
): readonly JourneyRuntimeRequirement[] {
  if (settings === null) return [];
  const declarations = new Map(
    settings.variables.map((variable) => [variable.name, variable]),
  );
  const names = new Set<string>();
  const labels = new Map<string, string>();
  for (const step of journey.steps) {
    if (step.value?.kind === 'sensitive') {
      names.add(step.value.variableName);
      labels.set(
        step.value.variableName,
        `${step.name} (${step.value.variableName})`,
      );
    } else if (step.value?.kind === 'safe') {
      collectVariableNames(step.value.value, names);
    }
  }
  collectVariableNames(JSON.stringify(settings.beforeRunHook), names);
  collectVariableNames(JSON.stringify(settings.afterRunHook), names);

  const pending = [...names];
  for (let index = 0; index < pending.length; index += 1) {
    const name = pending[index];
    if (name === undefined) continue;
    const template = declarations.get(name)?.template;
    if (template === null || template === undefined) continue;
    const dependencies = new Set<string>();
    collectVariableNames(template, dependencies);
    for (const dependency of dependencies) {
      if (names.has(dependency)) continue;
      names.add(dependency);
      pending.push(dependency);
    }
  }

  return [...names]
    .filter((name) => declarations.get(name)?.configured !== true)
    .sort()
    .map((name) => {
      const declaration = declarations.get(name);
      const description = declaration?.description.trim();
      return {
        name,
        label:
          labels.get(name) ??
          (description !== undefined && description !== ''
            ? description
            : name),
        secret: declaration?.secret ?? true,
      };
    });
}

function collectVariableNames(value: string, names: Set<string>): void {
  for (const match of value.matchAll(/\{\{var\.([A-Z][A-Z0-9_]*)\}\}/gu)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
}
