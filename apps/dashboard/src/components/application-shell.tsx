'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

type NavigationItem = Readonly<{
  href: string;
  icon: 'sample' | 'projects' | 'runs';
  label: string;
  match: (pathname: string, hash: string) => boolean;
}>;

const navigation: readonly NavigationItem[] = [
  {
    href: '/',
    icon: 'sample',
    label: 'Sample Checkout',
    match: (pathname, hash) => pathname === '/' && hash !== '#history-title',
  },
  {
    href: '/projects',
    icon: 'projects',
    label: 'External Projects',
    match: (pathname) => pathname.startsWith('/projects'),
  },
  {
    href: '/#history-title',
    icon: 'runs',
    label: 'Runs',
    match: (pathname, hash) =>
      pathname.startsWith('/runs') ||
      (pathname === '/' && hash === '#history-title'),
  },
];

export function ApplicationShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState('');
  const context = routeContext(pathname);

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    updateHash();
    window.addEventListener('hashchange', updateHash);
    window.addEventListener('popstate', updateHash);
    return () => {
      window.removeEventListener('hashchange', updateHash);
      window.removeEventListener('popstate', updateHash);
    };
  }, [pathname]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="app-sidebar" aria-label="Application sidebar">
        <Link
          className="app-brand"
          href="/"
          aria-label="FormCrash home"
          onClick={() => setHash('')}
        >
          <span className="app-brand-mark" aria-hidden="true">
            FC
          </span>
          <span>
            <strong>FormCrash</strong>
            <small>Controlled failure workbench</small>
          </span>
        </Link>

        <nav className="app-navigation" aria-label="Primary navigation">
          <p className="app-navigation-label">Workspaces</p>
          {navigation.map((item) => {
            const active = item.match(pathname, hash);
            return (
              <Link
                className={`app-navigation-link${active ? ' app-navigation-link-active' : ''}`}
                href={item.href}
                key={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() =>
                  setHash(
                    item.href === '/#history-title' ? '#history-title' : '',
                  )
                }
              >
                <NavigationIcon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="app-sidebar-footer">
          <span className="local-status" aria-hidden="true" />
          <span>
            <strong>Local workbench</strong>
            <small>Controlled environments only</small>
          </span>
        </div>
      </aside>

      <div className="app-shell-main">
        <header className="project-context-bar" aria-label="Current workspace">
          <div>
            <span className="project-context-label">Current workspace</span>
            <strong title={context.title}>{context.title}</strong>
          </div>
          <span className="project-context-detail">{context.detail}</span>
        </header>
        <div className="app-content-boundary" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}

function routeContext(
  pathname: string,
): Readonly<{ title: string; detail: string }> {
  if (pathname.startsWith('/projects')) {
    return {
      title: 'External projects',
      detail: 'Recording · Guided and Advanced testing',
    };
  }
  if (pathname.startsWith('/runs')) {
    return {
      title: 'Bundled Sample Checkout',
      detail: 'Persisted run evidence',
    };
  }
  return {
    title: 'Bundled Sample Checkout',
    detail: 'Local sample workspace',
  };
}

function NavigationIcon({ name }: { readonly name: NavigationItem['icon'] }) {
  const paths = {
    sample: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
    projects: <path d="M4 7h6l2 2h8v10H4zM4 7V5h6l2 2" />,
    runs: <path d="M12 3a9 9 0 1 1-6.4 2.7M3 3v6h6M12 7v5l3 2" />,
  } as const;
  return (
    <svg
      aria-hidden="true"
      className="app-navigation-icon"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      {paths[name]}
    </svg>
  );
}
