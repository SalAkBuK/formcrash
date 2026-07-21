import { TestDetailScreen } from '../../../../../features/projects/components/test-detail-screen';

export default async function TestPage({
  params,
}: {
  readonly params: Promise<{ projectId: string; testId: string }>;
}) {
  const { projectId, testId } = await params;
  return <TestDetailScreen projectId={projectId} testId={testId} />;
}
