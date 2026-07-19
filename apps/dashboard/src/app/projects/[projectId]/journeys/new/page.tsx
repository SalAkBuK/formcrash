import { JourneyRecordingScreen } from '../../../../../features/projects/components/journey-recording-screen';

export default async function NewJourneyPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <JourneyRecordingScreen projectId={projectId} />;
}
