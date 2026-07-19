import { Suspense } from 'react';

import { TestBuilderScreen } from '../../../../../features/projects/components/test-builder-screen';

export default async function NewTestPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <Suspense
      fallback={
        <p className="state-message state-message-loading">
          Loading test builder…
        </p>
      }
    >
      <TestBuilderScreen projectId={projectId} />
    </Suspense>
  );
}
