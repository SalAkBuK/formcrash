import { JourneyWorkspaceScreen } from '../../../../../../features/projects/components/journey-workspace-screen';

export default async function JourneySequencePage({
  params,
}: {
  readonly params: Promise<{ projectId: string; journeyId: string }>;
}) {
  const { projectId, journeyId } = await params;
  return (
    <JourneyWorkspaceScreen
      journeyId={journeyId}
      projectId={projectId}
      view="sequence"
    />
  );
}
