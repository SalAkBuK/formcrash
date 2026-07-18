import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  readonly compact?: boolean;
}

export function Button({
  className = '',
  compact = false,
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  const classes = [
    'button',
    `button-${variant}`,
    compact ? 'button-compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button className={classes} type={type} {...props} />;
}
