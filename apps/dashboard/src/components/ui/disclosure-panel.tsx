import type { ReactNode } from 'react';

export function DisclosurePanel({
  action = 'Open details',
  children,
  className = '',
  description,
  eyebrow = 'Developer detail',
  title,
}: {
  readonly action?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly description: string;
  readonly eyebrow?: string;
  readonly title: string;
}) {
  return (
    <details className={`panel disclosure-panel ${className}`.trim()}>
      <summary tabIndex={0}>
        <span>
          <small>{eyebrow}</small>
          <strong>{title}</strong>
          <span>{description}</span>
        </span>
        <span className="disclosure-action">{action}</span>
      </summary>
      <div className="disclosure-panel-body">{children}</div>
    </details>
  );
}
