'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import { getProject, listProjects } from '../api/projects';

const tabs = [
  { label: 'Overview', segment: '' },
  { label: 'Journeys', segment: '/journeys' },
  { label: 'Tests', segment: '/tests' },
  { label: 'Runs', segment: '/runs' },
  { label: 'Settings', segment: '/settings' },
] as const;

export function ProjectWorkspaceLayout({
  children,
  projectId,
}: {
  readonly children: ReactNode;
  readonly projectId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void Promise.all([getProject(projectId), listProjects()])
      .then(([nextProject, nextProjects]) => {
        if (!active) return;
        setProject(nextProject);
        setProjects(
          nextProjects.filter((item) => item.id !== 'project-sample-checkout'),
        );
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  if (error !== null) {
    return (
      <main className="dashboard-shell crm-screen">
        <StateMessage variant="error">{error}</StateMessage>
        <Link className="button button-secondary" href="/projects">
          Return to projects
        </Link>
      </main>
    );
  }

  if (project === null) {
    return (
      <main className="dashboard-shell crm-screen">
        <StateMessage variant="loading">
          Loading project workspace…
        </StateMessage>
      </main>
    );
  }

  const base = `/projects/${project.id}`;
  const activeTab = tabs.find((tab) =>
    tab.segment === ''
      ? pathname === base
      : pathname === `${base}${tab.segment}` ||
        pathname.startsWith(`${base}${tab.segment}/`),
  );

  return (
    <div className="crm-project-workspace">
      <header className="crm-project-header">
        <nav aria-label="Breadcrumb" className="crm-breadcrumbs">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{project.name}</span>
        </nav>
        <div className="crm-project-heading">
          <div>
            <p className="eyebrow">External project</p>
            <h1>{project.name}</h1>
            <a href={project.targetUrl} rel="noreferrer" target="_blank">
              {project.targetUrl}
            </a>
          </div>
          <div className="crm-project-context-actions">
            <StatusBadge
              tone={
                project.environment === 'production' ? 'warning' : 'neutral'
              }
            >
              {environmentLabel(project.environment)}
            </StatusBadge>
            <label>
              <span>Switch project</span>
              <select
                aria-label="Switch project"
                value={project.id}
                onChange={(event) =>
                  router.push(`/projects/${event.target.value}`)
                }
              >
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <nav aria-label="Project sections" className="crm-project-tabs">
          {tabs.map((tab) => (
            <Link
              aria-current={activeTab === tab ? 'page' : undefined}
              href={`${base}${tab.segment}`}
              key={tab.label}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="crm-project-content">{children}</div>
    </div>
  );
}

function environmentLabel(environment: Project['environment']): string {
  if (environment === 'local') return 'Local environment';
  if (environment === 'staging') return 'Staging environment';
  return 'Production environment';
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The project workspace could not be loaded.';
}
