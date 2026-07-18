import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationShell } from '../src/components/application-shell';
import { Button } from '../src/components/ui/button';
import { CopyButton } from '../src/components/ui/copy-button';
import { DisclosurePanel } from '../src/components/ui/disclosure-panel';
import { StateMessage } from '../src/components/ui/state-message';
import { StatusBadge } from '../src/components/ui/status-badge';

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

describe('shared application foundation', () => {
  beforeEach(() => {
    navigation.pathname = '/';
    window.history.replaceState(null, '', '/');
  });

  it('marks Runs current when the bundled history anchor is active', async () => {
    window.history.replaceState(null, '', '/#history-title');
    render(
      <ApplicationShell>
        <main>Run history</main>
      </ApplicationShell>,
    );

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expect(
      screen.getByRole('link', { name: 'Sample Checkout' }),
    ).not.toHaveAttribute('aria-current');
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
  });

  it('renders the real application routes, one current route, and route context', () => {
    render(
      <ApplicationShell>
        <main>Existing page</main>
      </ApplicationShell>,
    );

    expect(screen.getByLabelText('FormCrash home')).toHaveAttribute(
      'href',
      '/',
    );
    expect(
      screen.getByRole('link', { name: 'Sample Checkout' }),
    ).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('link', { name: 'External Projects' }),
    ).toHaveAttribute('href', '/projects');
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      '/#history-title',
    );
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
    expect(screen.getByText('Bundled Sample Checkout')).toBeVisible();
    expect(screen.getByRole('main')).toHaveTextContent('Existing page');
    expect(
      screen.queryByText(/billing|analytics|marketplace/i),
    ).not.toBeInTheDocument();
  });

  it('marks external projects current and exposes its Guided and Advanced context', () => {
    navigation.pathname = '/projects';
    render(
      <ApplicationShell>
        <main>Project page</main>
      </ApplicationShell>,
    );

    expect(
      screen.getByRole('link', { name: 'External Projects' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByText('Recording · Guided and Advanced testing'),
    ).toBeVisible();
  });

  it('keeps disabled buttons noninteractive and exposes stable variants', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary">Run experiment</Button>
        <Button variant="secondary" disabled onClick={onClick}>
          Refresh
        </Button>
        <Button variant="destructive">Delete</Button>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Run experiment' })).toHaveClass(
      'button-primary',
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'button-destructive',
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders readable, text-backed semantic status tones', () => {
    render(
      <>
        <StatusBadge tone="disruption">Repeated submission</StatusBadge>
        <StatusBadge tone="failure">Failed</StatusBadge>
        <StatusBadge tone="pass">Passed</StatusBadge>
        <StatusBadge tone="warning">Could not verify</StatusBadge>
        <StatusBadge tone="neutral">Not configured</StatusBadge>
      </>,
    );

    expect(screen.getByText('Repeated submission')).toHaveClass(
      'status-tone-disruption',
    );
    expect(screen.getByText('Failed')).toHaveClass('status-tone-failure');
    expect(screen.getByText('Passed')).toHaveClass('status-tone-pass');
    expect(screen.getByText('Could not verify')).toHaveClass(
      'status-tone-warning',
    );
    expect(screen.getByText('Not configured')).toHaveClass(
      'status-tone-neutral',
    );
  });

  it('uses native keyboard-accessible disclosure semantics', async () => {
    const user = userEvent.setup();
    render(
      <DisclosurePanel
        description="3 recorded events"
        title="Technical timeline"
      >
        <p>Technical evidence</p>
      </DisclosurePanel>,
    );

    const summary = screen.getByText('Technical timeline').closest('summary');
    expect(summary).not.toBeNull();
    await user.tab();
    expect(summary).toHaveFocus();
    await user.click(summary!);
    expect(summary?.parentElement).toHaveAttribute('open');
  });

  it('exposes loading, error, labeled input, and copy semantics', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <>
        <StateMessage variant="loading">Loading evidence</StateMessage>
        <StateMessage variant="error">Evidence unavailable</StateMessage>
        <label>
          Project name
          <input name="projectName" />
        </label>
        <CopyButton label="Copy run ID" value="run-123" />
      </>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading evidence');
    expect(screen.getByRole('alert')).toHaveTextContent('Evidence unavailable');
    expect(screen.getByRole('textbox', { name: 'Project name' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Copy run ID' }));
    expect(writeText).toHaveBeenCalledWith('run-123');
  });
});
