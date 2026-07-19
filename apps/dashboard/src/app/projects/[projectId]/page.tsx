import { ProjectOverviewScreen } from '../../../features/projects/components/project-overview-screen';

export default async function ProjectPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectOverviewScreen projectId={projectId} />;
}
