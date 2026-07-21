import { redirect } from 'next/navigation';

export default async function JourneyOutcomesPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; journeyId: string }>;
}) {
  const { projectId, journeyId } = await params;
  redirect(
    `/projects/${projectId}/tests/new?journeyId=${journeyId}&step=outcome`,
  );
}
