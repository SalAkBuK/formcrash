'use client';

import { useEffect, useState } from 'react';
import type {
  AuthCaptureSession,
  HttpHook,
  Project,
  ProjectExecutionSettings,
  RuntimeVariableDeclarationInput,
} from '@formcrash/contracts';

import { StateMessage } from '../../../components/ui/state-message';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  clearAuthentication,
  confirmAuthenticationCapture,
  getProjectSettings,
  saveProjectSettings,
  startAuthenticationCapture,
  testAuthentication,
} from '../api/external-experiments';
import { getProject } from '../api/projects';

export function ProjectSettingsScreen({
  projectId,
}: {
  readonly projectId: string;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<ProjectExecutionSettings | null>(
    null,
  );
  const [variables, setVariables] = useState<
    readonly RuntimeVariableDeclarationInput[]
  >([]);
  const [beforeHook, setBeforeHook] = useState('');
  const [afterHook, setAfterHook] = useState('');
  const [capture, setCapture] = useState<AuthCaptureSession | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getProject(projectId), getProjectSettings(projectId)])
      .then(([nextProject, nextSettings]) => {
        if (!active) return;
        setProject(nextProject);
        applySettings(nextSettings);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  function applySettings(next: ProjectExecutionSettings): void {
    setSettings(next);
    setVariables(
      next.variables.map(({ name, secret, description, template }) => ({
        name,
        secret,
        description,
        template,
      })),
    );
    setBeforeHook(
      next.beforeRunHook === null
        ? ''
        : JSON.stringify(next.beforeRunHook, null, 2),
    );
    setAfterHook(
      next.afterRunHook === null
        ? ''
        : JSON.stringify(next.afterRunHook, null, 2),
    );
  }

  async function save(): Promise<void> {
    setBusy('save');
    setError(null);
    try {
      const saved = await saveProjectSettings(projectId, {
        variables: [...variables],
        beforeRunHook: parseHook(beforeHook, 'Before-run hook'),
        afterRunHook: parseHook(afterHook, 'After-run hook'),
      });
      applySettings(saved);
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function startAuth(): Promise<void> {
    setBusy('auth-start');
    setError(null);
    setAuthMessage(null);
    try {
      setCapture(await startAuthenticationCapture(projectId));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function confirmAuth(): Promise<void> {
    if (capture === null) return;
    setBusy('auth-confirm');
    setError(null);
    try {
      const next = await confirmAuthenticationCapture(projectId, capture.id);
      setCapture(next);
      applySettings(await getProjectSettings(projectId));
      setAuthMessage('Authentication was captured and saved for future runs.');
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function validateAuth(): Promise<void> {
    setBusy('auth-test');
    setError(null);
    try {
      const result = await testAuthentication(projectId);
      setAuthMessage(result.message);
      applySettings(await getProjectSettings(projectId));
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }
  async function removeAuth(): Promise<void> {
    if (
      !window.confirm('Clear the saved authentication state for this project?')
    )
      return;
    setBusy('auth-clear');
    setError(null);
    try {
      applySettings(await clearAuthentication(projectId));
      setCapture(null);
      setAuthMessage('Saved authentication was cleared.');
    } catch (reason: unknown) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  if (error !== null && settings === null)
    return <StateMessage variant="error">{error}</StateMessage>;
  if (settings === null || project === null)
    return (
      <StateMessage variant="loading">Loading project settings…</StateMessage>
    );

  return (
    <main className="dashboard-shell crm-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Project settings</p>
          <h2>Execution and authentication</h2>
          <p>
            Reusable configuration for recording, replay, discovery, and test
            execution.
          </p>
        </div>
        <button
          className="button button-primary"
          disabled={busy !== null}
          onClick={() => void save()}
          type="button"
        >
          {busy === 'save' ? 'Saving…' : 'Save settings'}
        </button>
      </header>
      {project.environment === 'production' ? (
        <StateMessage variant="warning">
          This project targets production. Saving configuration does not remove
          the confirmation required before state-changing execution.
        </StateMessage>
      ) : null}
      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}
      <div className="crm-settings-grid">
        <section className="panel crm-summary-panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Authentication</p>
              <h3>Saved browser session</h3>
            </div>
            <StatusBadge
              tone={settings.authentication.available ? 'pass' : 'warning'}
            >
              {settings.authentication.available
                ? 'Available'
                : settings.authentication.configured
                  ? 'Needs replacement'
                  : 'Not captured'}
            </StatusBadge>
          </div>
          <p>
            Capture sign-in state in a visible controlled browser. FormCrash
            never displays stored cookies or tokens.
          </p>
          {authMessage !== null ? (
            <StateMessage>{authMessage}</StateMessage>
          ) : null}
          <div className="crm-form-actions">
            <button
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => void startAuth()}
              type="button"
            >
              {busy === 'auth-start'
                ? 'Opening browser…'
                : settings.authentication.configured
                  ? 'Recapture authentication'
                  : 'Capture authentication'}
            </button>
            {capture?.status === 'awaiting_confirmation' ? (
              <button
                className="button button-primary"
                disabled={busy !== null}
                onClick={() => void confirmAuth()}
                type="button"
              >
                {busy === 'auth-confirm'
                  ? 'Saving…'
                  : 'I am signed in — save session'}
              </button>
            ) : null}
            {settings.authentication.configured ? (
              <>
                <button
                  className="button button-secondary"
                  disabled={busy !== null}
                  onClick={() => void validateAuth()}
                  type="button"
                >
                  {busy === 'auth-test' ? 'Testing…' : 'Test session'}
                </button>
                <button
                  className="button button-destructive"
                  disabled={busy !== null}
                  onClick={() => void removeAuth()}
                  type="button"
                >
                  Clear session
                </button>
              </>
            ) : null}
          </div>
        </section>
        <section className="panel crm-summary-panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Runtime values</p>
              <h3>Variable declarations</h3>
            </div>
            <button
              className="button button-secondary button-compact"
              onClick={() =>
                setVariables((current) => [
                  ...current,
                  { name: '', secret: true, description: '', template: null },
                ])
              }
              type="button"
            >
              Add variable
            </button>
          </div>
          {variables.length === 0 ? (
            <p>
              No project-level variables are declared. Journey-specific
              sensitive values still appear at run time.
            </p>
          ) : (
            <div className="crm-variable-list">
              {variables.map((variable, index) => (
                <div
                  className="crm-variable-row"
                  key={`${index}-${variable.name}`}
                >
                  <label>
                    Name
                    <input
                      onChange={(event) =>
                        updateVariable(index, {
                          name: event.target.value
                            .toUpperCase()
                            .replaceAll(/[^A-Z0-9_]/gu, ''),
                        })
                      }
                      pattern="[A-Z][A-Z0-9_]*"
                      value={variable.name}
                    />
                  </label>
                  <label>
                    Description
                    <input
                      maxLength={300}
                      onChange={(event) =>
                        updateVariable(index, {
                          description: event.target.value,
                        })
                      }
                      value={variable.description}
                    />
                  </label>
                  <label>
                    Template
                    <input
                      onChange={(event) =>
                        updateVariable(index, {
                          template:
                            event.target.value === ''
                              ? null
                              : event.target.value,
                        })
                      }
                      placeholder="Optional {{var.OTHER}}"
                      value={variable.template ?? ''}
                    />
                  </label>
                  <label className="inline-check">
                    <input
                      checked={variable.secret}
                      onChange={(event) =>
                        updateVariable(index, { secret: event.target.checked })
                      }
                      type="checkbox"
                    />{' '}
                    Secret
                  </label>
                  <button
                    aria-label={`Remove ${variable.name || `variable ${index + 1}`}`}
                    className="button button-destructive button-compact"
                    onClick={() =>
                      setVariables((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="panel crm-hook-settings">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Preparation and cleanup</p>
            <h3>HTTP hooks</h3>
            <p>
              Optional JSON hook objects run before and after each external
              execution.
            </p>
          </div>
        </div>
        <div className="crm-form-grid">
          <label>
            Before-run hook JSON
            <textarea
              onChange={(event) => setBeforeHook(event.target.value)}
              placeholder={
                '{\n  "method": "POST",\n  "url": "http://localhost:4300/reset",\n  "headers": {},\n  "body": null,\n  "timeoutMs": 5000\n}'
              }
              rows={12}
              value={beforeHook}
            />
          </label>
          <label>
            After-run hook JSON
            <textarea
              onChange={(event) => setAfterHook(event.target.value)}
              placeholder="Leave empty when no cleanup hook is required."
              rows={12}
              value={afterHook}
            />
          </label>
        </div>
      </section>
    </main>
  );

  function updateVariable(
    index: number,
    patch: Partial<RuntimeVariableDeclarationInput>,
  ): void {
    setVariables((current) =>
      current.map((variable, itemIndex) =>
        itemIndex === index ? { ...variable, ...patch } : variable,
      ),
    );
  }
}

function parseHook(value: string, label: string): HttpHook | null {
  if (value.trim() === '') return null;
  try {
    return JSON.parse(value) as HttpHook;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}
function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Settings could not be updated.';
}
