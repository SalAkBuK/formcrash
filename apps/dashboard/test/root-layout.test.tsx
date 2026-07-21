import { Children, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import RootLayout from '../src/app/layout';

describe('root layout hydration boundary', () => {
  it('contains browser-extension attributes injected onto body', () => {
    const html = RootLayout({
      children: <main>FormCrash</main>,
    }) as ReactElement<{ children: ReactElement }>;
    const body = Children.only(html.props.children) as ReactElement<{
      suppressHydrationWarning?: boolean;
    }>;

    expect(body.type).toBe('body');
    expect(body.props.suppressHydrationWarning).toBe(true);
  });
});
