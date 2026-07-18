import type { ReactNode } from 'react';

export type StatusTone =
  | 'disruption'
  | 'failure'
  | 'pass'
  | 'warning'
  | 'neutral'
  | 'browser'
  | 'network';

export function StatusBadge({
  children,
  className = '',
  live = false,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly live?: boolean;
  readonly tone?: StatusTone;
}) {
  return (
    <span
      className={`status-badge status-tone-${tone} ${className}`.trim()}
      aria-live={live ? 'polite' : undefined}
    >
      <span className="status-badge-marker" aria-hidden="true" />
      {children}
    </span>
  );
}
