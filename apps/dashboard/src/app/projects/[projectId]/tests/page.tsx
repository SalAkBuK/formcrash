import { ProjectTestsScreen } from '../../../../features/projects/components/project-tests-screen';

export default async function TestsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectTestsScreen projectId={projectId} />;
}
