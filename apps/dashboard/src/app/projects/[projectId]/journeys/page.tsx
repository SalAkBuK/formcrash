import { JourneyListScreen } from '../../../../features/projects/components/journey-list-screen';

export default async function JourneysPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <JourneyListScreen projectId={projectId} />;
}
