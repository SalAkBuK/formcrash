import type { ReactNode } from 'react';

export function StateMessage({
  children,
  variant = 'neutral',
}: {
  readonly children: ReactNode;
  readonly variant?: 'loading' | 'error' | 'neutral' | 'warning';
}) {
  const role = variant === 'error' ? 'alert' : 'status';
  return (
    <div
      className={`state-message state-message-${variant}`}
      role={role}
      aria-live={variant === 'loading' ? 'polite' : undefined}
    >
      {children}
    </div>
  );
}
