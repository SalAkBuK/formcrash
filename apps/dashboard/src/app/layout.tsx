import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ApplicationShell } from '../components/application-shell';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'FormCrash Lab',
    template: '%s · FormCrash Lab',
  },
  description: 'Local resilience testing for transactional web journeys.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ApplicationShell>{children}</ApplicationShell>
      </body>
    </html>
  );
}
