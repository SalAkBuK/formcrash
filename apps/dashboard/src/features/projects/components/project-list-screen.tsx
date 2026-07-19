'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Project } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { formatLocalDateTime } from '../../../lib/formatters';
import { createProject, deleteProject, listProjects } from '../api/projects';
import {
  loadProjectCrmData,
  scenarioSetupLabel,
  verdictLabel,
  type ProjectCrmData,
} from './crm-project-data';

export function ProjectListScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [records, setRecords] = useState<ReadonlyMap<string, ProjectCrmData>>(
    new Map(),
  );
  const [query, setQuery] = useState('');
  const [environment, setEnvironment] = useState('all');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>('loading');
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    void refresh();
  }, []);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects.filter(
      (project) =>
        (environment === 'all' || project.environment === environment) &&
        (normalized === '' ||
          `${project.name} ${project.targetUrl} ${project.description}`
            .toLowerCase()
            .includes(normalized)),
    );
  }, [environment, projects, query]);

  async function refresh(): Promise<void> {
    setBusy('loading');
    setError(null);
    try {
      const nextProjects = (await listProjects()).filter(
        (project) => project.id !== 'project-sample-checkout',
      );
      setProjects(nextProjects);
      const derived = await Promise.allSettled(
        nextProjects.map((project) => loadProjectCrmData(project, 20)),
      );
      setRecords(
        new Map(
          derived.flatMap((result) =>
            result.status === 'fulfilled'
              ? [[result.value.project.id, result.value] as const]
              : [],
          ),
        ),
      );
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  async function submitProject(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy('create');
    setError(null);
    try {
      const project = await createProject({
        name: formValue(form, 'name'),
        targetUrl: formValue(form, 'targetUrl'),
        environment: formValue(form, 'environment') as Project['environment'],
        description: formValue(form, 'description'),
      });
      router.push(`/projects/${project.id}`);
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  async function removeSelected(): Promise<void> {
    const targets = projects.filter(
      (project) =>
        selectedIds.has(project.id) && project.id !== 'project-sample-checkout',
    );
    if (
      targets.length === 0 ||
      !window.confirm(
        `Delete ${targets.length} selected project${targets.length === 1 ? '' : 's'} and all associated evidence? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy('delete');
    setError(null);
    try {
      await Promise.all(
        targets.map((project) => deleteProject(project.id, true)),
      );
      setSelectedIds(new Set());
      await refresh();
    } catch (reason: unknown) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  return (
    <main className="dashboard-shell crm-screen projects-screen">
      <header className="crm-page-heading">
        <div>
          <p className="eyebrow">External workflow</p>
          <h1>Projects</h1>
          <p>
            Controlled application targets, recorded Scenarios, Configurations,
            and durable Run evidence.
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() => setCreating((current) => !current)}
          type="button"
        >
          {creating ? 'Close form' : 'New Project'}
        </button>
      </header>

      <p className="safety-notice">
        <strong>Controlled environments only.</strong> Production targets
        require explicit confirmation before replay or testing.
      </p>

      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}

      {creating ? (
        <form
          className="panel crm-create-form"
          onSubmit={(event) => void submitProject(event)}
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">New project</p>
              <h2>Connect a target</h2>
            </div>
          </div>
          <div className="crm-form-grid">
            <label>
              Project name
              <input maxLength={120} name="name" required />
            </label>
            <label>
              Target URL
              <input
                name="targetUrl"
                placeholder="http://localhost:4300"
                required
                type="url"
              />
            </label>
            <label>
              Environment
              <select defaultValue="local" name="environment" required>
                <option value="local">Local development</option>
                <option value="staging">Staging / disposable data</option>
                <option value="production">Production / real data</option>
              </select>
            </label>
            <label>
              Description <span>(optional)</span>
              <input maxLength={1000} name="description" />
            </label>
          </div>
          <div className="crm-form-actions">
            <button
              className="button button-primary"
              disabled={busy !== null}
              type="submit"
            >
              {busy === 'create' ? 'Creating…' : 'Create project'}
            </button>
            <button
              className="button button-secondary"
              onClick={() => setCreating(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <section
        className="panel crm-list-panel"
        aria-labelledby="projects-title"
      >
        <div className="crm-list-toolbar">
          <div>
            <p className="eyebrow">Project directory</p>
            <h2 id="projects-title">Saved targets</h2>
          </div>
          <div className="crm-list-filters">
            <label>
              <span className="visually-hidden">Search projects</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                type="search"
                value={query}
              />
            </label>
            <label>
              <span className="visually-hidden">Filter environment</span>
              <select
                aria-label="Filter environment"
                onChange={(event) => setEnvironment(event.target.value)}
                value={environment}
              >
                <option value="all">All environments</option>
                <option value="local">Local</option>
                <option value="staging">Staging</option>
                <option value="production">Production</option>
              </select>
            </label>
            {selectedIds.size > 0 ? (
              <button
                className="button button-destructive button-compact"
                disabled={busy !== null}
                onClick={() => void removeSelected()}
                type="button"
              >
                Delete selected ({selectedIds.size})
              </button>
            ) : null}
          </div>
        </div>

        {busy === 'loading' ? (
          <StateMessage variant="loading">Loading projects…</StateMessage>
        ) : visibleProjects.length === 0 ? (
          <div className="empty-state">
            <h3>{projects.length === 0 ? 'No projects yet' : 'No matches'}</h3>
            <p>
              {projects.length === 0
                ? 'Create a controlled target to begin recording.'
                : 'Adjust the search or environment filter.'}
            </p>
          </div>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th aria-label="Select" scope="col" />
                  <th scope="col">Project</th>
                  <th scope="col">Target origin</th>
                  <th scope="col">Environment</th>
                  <th scope="col">Authentication</th>
                  <th scope="col">Scenario setup</th>
                  <th scope="col">Latest result</th>
                  <th scope="col">Last activity</th>
                  <th aria-label="Actions" scope="col" />
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr key={project.id}>
                    <td data-label="Select">
                      {project.id === 'project-sample-checkout' ? null : (
                        <input
                          aria-label={`Select ${project.name}`}
                          checked={selectedIds.has(project.id)}
                          onChange={(event) =>
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(project.id);
                              else next.delete(project.id);
                              return next;
                            })
                          }
                          type="checkbox"
                        />
                      )}
                    </td>
                    <td data-label="Project">
                      <Link
                        className="crm-primary-link"
                        href={`/projects/${project.id}`}
                      >
                        <strong>{project.name}</strong>
                        <span>{project.description || 'No description'}</span>
                      </Link>
                    </td>
                    <td data-label="Target origin">
                      <code>{safeOrigin(project.targetUrl)}</code>
                    </td>
                    <td data-label="Environment">
                      <StatusBadge
                        tone={
                          project.environment === 'production'
                            ? 'warning'
                            : 'neutral'
                        }
                      >
                        {project.environment}
                      </StatusBadge>
                    </td>
                    <td data-label="Authentication">
                      <AuthenticationCell record={records.get(project.id)} />
                    </td>
                    <td data-label="Scenario setup">
                      <ScenarioStateCell record={records.get(project.id)} />
                    </td>
                    <td data-label="Latest result">
                      <LatestResultCell record={records.get(project.id)} />
                    </td>
                    <td data-label="Last activity">
                      {formatLocalDateTime(
                        records.get(project.id)?.lastActivity ??
                          project.updatedAt,
                      )}
                    </td>
                    <td data-label="Actions">
                      <Link
                        className="button button-secondary button-compact"
                        href={`/projects/${project.id}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function AuthenticationCell({
  record,
}: {
  readonly record: ProjectCrmData | undefined;
}) {
  if (record === undefined)
    return <StatusBadge tone="neutral">Unavailable</StatusBadge>;
  if (record.settings.status === 'unavailable')
    return <StatusBadge tone="neutral">Unavailable</StatusBadge>;
  return (
    <StatusBadge
      tone={record.settings.value.authentication.available ? 'pass' : 'warning'}
    >
      {record.settings.value.authentication.available
        ? 'Saved and available'
        : 'Not available'}
    </StatusBadge>
  );
}

function ScenarioStateCell({
  record,
}: {
  readonly record: ProjectCrmData | undefined;
}) {
  if (record === undefined || record.scenarios.status === 'unavailable')
    return <StatusBadge tone="neutral">Unavailable</StatusBadge>;
  const scenario = record.scenarios.value[0];
  if (scenario === undefined)
    return <StatusBadge tone="warning">No Scenarios</StatusBadge>;
  return (
    <span className="crm-stacked-state">
      <StatusBadge tone={scenario.setupState === 'ready' ? 'pass' : 'warning'}>
        {scenarioSetupLabel(scenario.setupState)}
      </StatusBadge>
      <small>{record.scenarios.value.length} lineages</small>
    </span>
  );
}

function LatestResultCell({
  record,
}: {
  readonly record: ProjectCrmData | undefined;
}) {
  if (record === undefined || record.runs.status === 'unavailable')
    return <StatusBadge tone="neutral">Unavailable</StatusBadge>;
  const run = record.runs.value[0] ?? null;
  return (
    <StatusBadge
      tone={
        run === null
          ? 'neutral'
          : run.status === 'runner_error' || run.outcomeAggregate === 'failed'
            ? 'failure'
            : run.outcomeAggregate === 'passed'
              ? 'pass'
              : 'warning'
      }
    >
      {verdictLabel(run)}
    </StatusBadge>
  );
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The project operation could not be completed.';
}
