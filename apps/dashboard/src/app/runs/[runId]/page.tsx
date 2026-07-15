import { RunDetailRoute } from '../../../features/run-result/components/run-detail-route';

export default async function RunPage({
  params,
}: {
  readonly params: Promise<{ readonly runId: string }>;
}) {
  const { runId } = await params;
  return <RunDetailRoute runId={runId} />;
}
