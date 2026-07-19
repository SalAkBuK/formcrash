import { ProjectScenariosScreen } from '../../../../features/projects/components/project-scenarios-screen';

export default async function ScenariosPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectScenariosScreen projectId={projectId} />;
}
