import {
  projectExecutionSettingsSchema,
  type ProjectExecutionSettings,
  type ProjectExecutionSettingsInput,
} from '@formcrash/contracts';

import type { ProjectJourneyRepository } from '../../persistence/project-journey-repository.js';
import type { ProjectSettingsRepository } from '../../persistence/project-settings-repository.js';
import type { AuthStateStore } from './auth-session.js';
import { environmentName, isVariableConfigured } from './runtime-values.js';

export class ProjectSettingsService {
  constructor(
    private readonly projects: ProjectJourneyRepository,
    private readonly repository: ProjectSettingsRepository,
    private readonly authStore: AuthStateStore,
  ) {}

  get(projectId: string): ProjectExecutionSettings {
    if (this.projects.getProject(projectId) === null) {
      throw new Error('Project was not found.');
    }
    const stored = this.repository.get(projectId);
    return projectExecutionSettingsSchema.parse({
      projectId,
      variables: stored.variables.map((declaration) => ({
        ...declaration,
        environmentName: environmentName(declaration.name),
        configured: isVariableConfigured(declaration),
      })),
      beforeRunHook: stored.beforeRunHook,
      afterRunHook: stored.afterRunHook,
      authentication: this.authStore.status(projectId),
      updatedAt: stored.updatedAt,
    });
  }

  save(
    projectId: string,
    input: ProjectExecutionSettingsInput,
  ): ProjectExecutionSettings {
    if (this.projects.getProject(projectId) === null) {
      throw new Error('Project was not found.');
    }
    const names = input.variables.map((item) => item.name);
    if (new Set(names).size !== names.length) {
      throw new Error('Runtime variable names must be unique.');
    }
    for (const variable of input.variables) {
      if (variable.secret && variable.template !== null) {
        throw new Error('Secret runtime variables cannot persist templates.');
      }
    }
    this.repository.save(projectId, input);
    return this.get(projectId);
  }

  clearAuthentication(projectId: string): ProjectExecutionSettings {
    if (this.projects.getProject(projectId) === null) {
      throw new Error('Project was not found.');
    }
    this.authStore.clear(projectId);
    return this.get(projectId);
  }
}
