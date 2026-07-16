import type { Project } from '@formcrash/contracts';

export class ProductionConfirmationRequiredError extends Error {
  constructor(operation: string) {
    super(
      `${operation} can create, modify, or delete real production data. Explicit production confirmation is required.`,
    );
    this.name = 'ProductionConfirmationRequiredError';
  }
}

export function assertProductionConfirmed(
  project: Project,
  confirmed: boolean,
  operation: string,
): void {
  if (project.environment === 'production' && !confirmed) {
    throw new ProductionConfirmationRequiredError(operation);
  }
}
