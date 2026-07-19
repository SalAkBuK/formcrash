import { TestDetailScreen } from '../../../../../features/projects/components/test-detail-screen';

export default async function TestPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; experimentVersionId: string }>;
}) {
  const { projectId, experimentVersionId } = await params;
  return (
    <TestDetailScreen
      experimentVersionId={experimentVersionId}
      projectId={projectId}
    />
  );
}
