'use client';

import { useState } from 'react';

export function CopyButton({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      className="copy-button"
      type="button"
      aria-label={label}
      onClick={() => void copy()}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
