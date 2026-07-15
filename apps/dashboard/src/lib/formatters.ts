export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return 'In progress';
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = durationMs / 1_000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

export function formatRelativeTime(relativeTimestampMs: number): string {
  if (relativeTimestampMs < 1_000) return `+${relativeTimestampMs} ms`;
  return `+${(relativeTimestampMs / 1_000).toFixed(2)} s`;
}

export function formatLocalDateTime(value: string | null): string {
  if (value === null) return 'Not completed';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function sentenceCase(value: string): string {
  const words = value.replaceAll('_', ' ').replaceAll('.', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
