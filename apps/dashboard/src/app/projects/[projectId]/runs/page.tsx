import { ProjectRunsScreen } from '../../../../features/projects/components/project-runs-screen';

export default async function ProjectRunsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectRunsScreen projectId={projectId} />;
}
