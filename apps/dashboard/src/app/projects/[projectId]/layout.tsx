import type { ReactNode } from 'react';

import { ProjectWorkspaceLayout } from '../../../features/projects/components/project-workspace-layout';

export default async function ProjectLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <ProjectWorkspaceLayout projectId={projectId}>
      {children}
    </ProjectWorkspaceLayout>
  );
}
