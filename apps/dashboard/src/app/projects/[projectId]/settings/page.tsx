import { ProjectSettingsScreen } from '../../../../features/projects/components/project-settings-screen';

export default async function SettingsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ProjectSettingsScreen projectId={projectId} />;
}
