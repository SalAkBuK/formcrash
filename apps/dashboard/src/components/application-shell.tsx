'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
    label: 'Bundled Sample',
    match: (pathname) => pathname === '/',
  },
  {
    href: '/projects',
    icon: 'projects',
    label: 'Projects',
    match: (pathname) => pathname.startsWith('/projects'),
  },
  {
    href: '/runs',
    icon: 'runs',
    label: 'All Runs',
    match: (pathname) =>
      pathname.startsWith('/runs') || pathname.startsWith('/external-runs'),
  },
];

export function ApplicationShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const previousPathname = useRef(pathname);
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

  useEffect(() => {
    setSidebarOpen(false);
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      window.requestAnimationFrame(() => {
        document.getElementById('main-content')?.focus();
      });
    }
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sidebarOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside
        className={`app-sidebar${sidebarOpen ? ' app-sidebar-open' : ''}`}
        aria-label="Application sidebar"
        id="application-sidebar"
      >
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
            <small>Reliability workbench</small>
          </span>
        </Link>

        <nav className="app-navigation" aria-label="Primary navigation">
          <p className="app-navigation-label">Workbench</p>
          {navigation.map((item) => {
            const active = item.match(pathname, hash);
            return (
              <Link
                className={`app-navigation-link${active ? ' app-navigation-link-active' : ''}`}
                href={item.href}
                key={item.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => setHash('')}
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
            <strong>Local environment</strong>
            <small>Controlled targets only</small>
          </span>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          aria-label="Close navigation"
          className="app-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <div className="app-shell-main">
        <header className="project-context-bar" aria-label="Current workspace">
          <button
            aria-controls="application-sidebar"
            aria-expanded={sidebarOpen}
            aria-label="Open navigation"
            className="app-menu-button"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
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
      title: 'Journey workspace',
      detail: 'Recording · Guided and Advanced testing',
    };
  }
  if (pathname.startsWith('/runs')) {
    return {
      title: pathname === '/runs' ? 'Runs' : 'Run result',
      detail: 'Persisted run evidence',
    };
  }
  if (pathname.startsWith('/external-runs')) {
    return {
      title: 'Run result',
      detail: 'Persisted external-run evidence',
    };
  }
  return {
    title: 'Bundled Sample Checkout',
    detail: 'Local sample workspace',
  };
}

function NavigationIcon({ name }: { readonly name: NavigationItem['icon'] }) {
  const paths = {
    sample: <path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h3" />,
    projects: (
      <path d="M5 4v5a3 3 0 0 0 3 3h8a3 3 0 0 1 3 3v5M5 4h4M15 20h4M12 9l3 3-3 3" />
    ),
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
