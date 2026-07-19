'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@formcrash/contracts';

import {
  useApplicationProjectContext,
  type ApplicationProjectContext,
} from '../../../components/application-shell';
import { StateMessage } from '../../../components/ui/state-message';
import { getProject, listProjects } from '../api/projects';

export function ProjectWorkspaceLayout({
  children,
  projectId,
}: {
  readonly children: ReactNode;
  readonly projectId: string;
}) {
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

  const shellContext = useMemo<ApplicationProjectContext | null>(
    () => (project === null ? null : { project, projects }),
    [project, projects],
  );
  useApplicationProjectContext(shellContext);

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

  return <div className="crm-project-content">{children}</div>;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'The project workspace could not be loaded.';
}
