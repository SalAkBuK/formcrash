'use client';

import type { Project } from '@formcrash/contracts';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { StatusBadge } from './ui/status-badge';

type NavigationItem = Readonly<{
  href: string;
  icon: 'sample' | 'projects' | 'runs';
  label: string;
  match: (pathname: string) => boolean;
}>;

export interface ApplicationProjectContext {
  readonly project: Project;
  readonly projects: readonly Project[];
}

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

const projectTabs = [
  { href: '', label: 'Overview', matches: ['overview'] },
  {
    href: '/scenarios',
    label: 'Scenarios',
    matches: ['scenarios', 'journeys', 'tests'],
  },
  { href: '/runs', label: 'Runs', matches: ['runs'] },
  { href: '/settings', label: 'Settings', matches: ['settings'] },
] as const;

const ProjectContextRegistration = createContext<
  (context: ApplicationProjectContext | null) => void
>(() => undefined);

export function useApplicationProjectContext(
  context: ApplicationProjectContext | null,
): void {
  const register = useContext(ProjectContextRegistration);
  useEffect(() => {
    register(context);
    return () => register(null);
  }, [context, register]);
}

export function ApplicationShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projectContext, setProjectContext] =
    useState<ApplicationProjectContext | null>(null);
  const previousPathname = useRef(pathname);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const shellMainRef = useRef<HTMLDivElement>(null);
  const context = routeContext(pathname);

  const closeNavigation = useCallback((restoreFocus = true) => {
    setSidebarOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus();
    });
  }, [pathname]);

  useEffect(() => {
    const main = shellMainRef.current;
    if (!sidebarOpen) {
      if (main !== null) main.inert = false;
      return;
    }

    if (main !== null) main.inert = true;
    const sidebar = sidebarRef.current;
    const focusable = () =>
      sidebar === null
        ? []
        : [
            ...sidebar.querySelectorAll<HTMLElement>('a[href], button, select'),
          ].filter((element) => !element.hasAttribute('disabled'));

    window.requestAnimationFrame(() => {
      const current = sidebar?.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      (current ?? focusable()[0])?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNavigation();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      if (main !== null) main.inert = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeNavigation, sidebarOpen]);

  const registration = useCallback(
    (next: ApplicationProjectContext | null) => setProjectContext(next),
    [],
  );

  return (
    <ProjectContextRegistration.Provider value={registration}>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <aside
          aria-label="Application sidebar"
          aria-modal={sidebarOpen ? 'true' : undefined}
          className={`app-sidebar${sidebarOpen ? ' app-sidebar-open' : ''}`}
          id="application-sidebar"
          ref={sidebarRef}
          role={sidebarOpen ? 'dialog' : undefined}
        >
          <Link className="app-brand" href="/" aria-label="FormCrash home">
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
              const active = item.match(pathname);
              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`app-navigation-link${active ? ' app-navigation-link-active' : ''}`}
                  href={item.href}
                  key={item.label}
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
              <strong>Local control server</strong>
              <small>One browser workload at a time</small>
            </span>
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="app-sidebar-backdrop"
            onClick={() => closeNavigation()}
            type="button"
          />
        ) : null}

        <div className="app-shell-main" ref={shellMainRef}>
          <header
            aria-label="Current workspace"
            className={`project-context-bar${projectContext === null ? '' : ' project-context-bar-project'}`}
          >
            <button
              aria-controls="application-sidebar"
              aria-expanded={sidebarOpen}
              aria-label="Open navigation"
              className="app-menu-button"
              onClick={() => setSidebarOpen(true)}
              ref={menuButtonRef}
              type="button"
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
            {projectContext === null ? (
              <div className="crm-global-context">
                <strong>{context.title}</strong>
                <span>{context.detail}</span>
              </div>
            ) : (
              <ProjectTopBar
                context={projectContext}
                pathname={pathname}
                switchProject={(projectId) =>
                  router.push(`/projects/${projectId}`)
                }
              />
            )}
          </header>
          <div className="app-content-boundary" id="main-content" tabIndex={-1}>
            {children}
          </div>
        </div>
      </div>
    </ProjectContextRegistration.Provider>
  );
}

function ProjectTopBar({
  context,
  pathname,
  switchProject,
}: {
  readonly context: ApplicationProjectContext;
  readonly pathname: string;
  readonly switchProject: (projectId: string) => void;
}) {
  const { project, projects } = context;
  const base = `/projects/${project.id}`;
  const section = projectSection(pathname, base);
  const targetOrigin = safeOrigin(project.targetUrl);
  const availableProjects = projects.some((item) => item.id === project.id)
    ? projects
    : [project, ...projects];

  return (
    <div className="crm-topbar-project">
      <div className="crm-topbar-record">
        <nav aria-label="Breadcrumb" className="crm-breadcrumbs">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>{project.name}</span>
          {section.label === 'Overview' ? null : (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{section.label}</span>
            </>
          )}
        </nav>
        <div className="crm-topbar-identity">
          <strong title={project.name}>{project.name}</strong>
          <a href={project.targetUrl} rel="noreferrer" target="_blank">
            {targetOrigin}
          </a>
          <StatusBadge
            tone={project.environment === 'production' ? 'warning' : 'neutral'}
          >
            {project.environment}
          </StatusBadge>
          <label className="crm-project-switcher">
            <span className="visually-hidden">Switch project</span>
            <select
              aria-label="Switch project"
              onChange={(event) => switchProject(event.target.value)}
              value={project.id}
            >
              {availableProjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <nav aria-label="Project sections" className="crm-project-tabs">
        {projectTabs.map((tab) => (
          <Link
            aria-current={section.label === tab.label ? 'page' : undefined}
            href={`${base}${tab.href}`}
            key={tab.label}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function projectSection(pathname: string, base: string) {
  const segment = pathname.slice(base.length).split('/').filter(Boolean)[0];
  if (segment === undefined) return projectTabs[0];
  return (
    projectTabs.find((tab) =>
      (tab.matches as readonly string[]).includes(segment),
    ) ?? projectTabs[0]
  );
}

function routeContext(
  pathname: string,
): Readonly<{ title: string; detail: string }> {
  if (pathname === '/projects') {
    return { title: 'Projects', detail: 'External application records' };
  }
  if (pathname.startsWith('/projects')) {
    return { title: 'Project workspace', detail: 'Loading project context' };
  }
  if (pathname.startsWith('/runs')) {
    return {
      title: pathname === '/runs' ? 'All Runs' : 'Run result',
      detail: 'Persisted run evidence',
    };
  }
  if (pathname.startsWith('/external-runs')) {
    return { title: 'Run result', detail: 'Persisted external-run evidence' };
  }
  return {
    title: 'Bundled Sample Checkout',
    detail: 'Local sample workspace',
  };
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
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
