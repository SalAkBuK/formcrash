import { ExternalRunDetailRoute } from '../../../features/projects/components/external-run-detail-route';

export default async function ExternalRunPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const { runId } = await params;
  return <ExternalRunDetailRoute runId={runId} />;
}
