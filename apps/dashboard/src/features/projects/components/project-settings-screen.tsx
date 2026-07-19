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
        beforeRunHook: parseHook(beforeHook, 'Preparation hook'),
        afterRunHook: parseHook(afterHook, 'Cleanup hook'),
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
      setAuthMessage('Saved authentication is available for future Runs.');
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
    if (!window.confirm('Clear saved authentication for this project?')) return;
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

  const missingVariables = settings.variables.filter(
    (variable) => !variable.configured,
  );

  return (
    <main className="dashboard-shell crm-screen crm-settings-screen">
      <header className="crm-page-heading crm-compact-heading">
        <div>
          <p className="eyebrow">Project record</p>
          <h1>Settings</h1>
          <p>Execution boundaries and reusable project configuration.</p>
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

      {error !== null ? (
        <StateMessage variant="error">{error}</StateMessage>
      ) : null}

      <div className="crm-settings-layout">
        <div className="crm-settings-primary">
          <section
            className="panel crm-settings-section"
            aria-labelledby="target-settings"
          >
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Target and environment</p>
                <h2 id="target-settings">Controlled application</h2>
              </div>
              <StatusBadge
                tone={
                  project.environment === 'production' ? 'warning' : 'neutral'
                }
              >
                {project.environment}
              </StatusBadge>
            </div>
            <dl className="crm-metadata-rows">
              <div>
                <dt>Project</dt>
                <dd>{project.name}</dd>
              </div>
              <div>
                <dt>Target URL</dt>
                <dd>
                  <code>{project.targetUrl}</code>
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{sentenceCase(project.environment)}</dd>
              </div>
              <div>
                <dt>Editing</dt>
                <dd>Read-only · no project update API is available</dd>
              </div>
            </dl>
          </section>

          <section
            className="panel crm-settings-section"
            aria-labelledby="auth-settings"
          >
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Authentication</p>
                <h2 id="auth-settings">Saved browser session</h2>
              </div>
              <StatusBadge
                tone={settings.authentication.available ? 'pass' : 'warning'}
              >
                {settings.authentication.available
                  ? 'Saved authentication available'
                  : 'No saved authentication'}
              </StatusBadge>
            </div>
            <p>
              FormCrash may discover during replay that authentication is
              required. Cookies, tokens, authorization headers, and captured
              payloads are never displayed here.
            </p>
            {settings.authentication.missingReason !== null ? (
              <StateMessage variant="warning">
                {settings.authentication.missingReason}
              </StateMessage>
            ) : null}
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
                    : 'Save signed-in session'}
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

          <section
            className="panel crm-settings-section"
            aria-labelledby="runtime-settings"
          >
            <div className="section-heading-row">
              <div>
                <p className="eyebrow">Runtime variables</p>
                <h2 id="runtime-settings">Declarations and readiness</h2>
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
            <p>
              Only declaration names and configuration state are shown. Runtime
              environment values and derived secrets remain hidden.
            </p>
            {missingVariables.length > 0 ? (
              <StateMessage variant="warning">
                Missing required names:{' '}
                {missingVariables.map((item) => item.name).join(', ')}
              </StateMessage>
            ) : null}
            {variables.length === 0 ? (
              <div className="empty-state crm-compact-empty">
                <h3>No project-level variables</h3>
                <p>
                  Journey-specific sensitive values are still requested at Run
                  time.
                </p>
              </div>
            ) : (
              <div className="crm-variable-list">
                {variables.map((variable, index) => {
                  const persisted = settings.variables.find(
                    (item) => item.name === variable.name,
                  );
                  return (
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
                        Generated template
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
                      <span className="crm-variable-readiness">
                        <StatusBadge
                          tone={persisted?.configured ? 'pass' : 'warning'}
                        >
                          {persisted?.configured ? 'Ready' : 'Missing'}
                        </StatusBadge>
                      </span>
                      <label className="inline-check">
                        <input
                          checked={variable.secret}
                          onChange={(event) =>
                            updateVariable(index, {
                              secret: event.target.checked,
                            })
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
                            current.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <HookEditor
            description="Runs before replay or experiment execution to prepare controlled data."
            label="Preparation hook"
            onChange={setBeforeHook}
            value={beforeHook}
          />
          <HookEditor
            description="Runs after execution. FormCrash verifies only the hook response, not resulting application state."
            label="Cleanup hook"
            onChange={setAfterHook}
            residueWarning
            value={afterHook}
          />
        </div>

        <aside className="crm-settings-rail" aria-label="Execution boundaries">
          <section className="panel crm-boundary-card">
            <p className="eyebrow">Production safeguards</p>
            <h2>Confirmation boundary</h2>
            <StatusBadge
              tone={
                project.environment === 'production' ? 'warning' : 'neutral'
              }
            >
              {project.environment === 'production'
                ? 'Required every execution'
                : 'Not a production target'}
            </StatusBadge>
            <p>
              Production confirmation is deliberately not persisted. It must be
              supplied again before every state-changing replay, discovery, or
              Run.
            </p>
          </section>
          <section className="panel crm-boundary-card">
            <p className="eyebrow">Browser boundary</p>
            <h2>Exclusive ownership</h2>
            <dl className="crm-metadata-rows">
              <div>
                <dt>Concurrency</dt>
                <dd>One browser workload at a time</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>Fresh browser context per workload</dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>No execution queue</dd>
              </div>
            </dl>
          </section>
          <section className="panel crm-boundary-card">
            <p className="eyebrow">CAPTCHA and anti-bot</p>
            <h2>Unsupported boundary</h2>
            <p>
              FormCrash does not solve CAPTCHA or bypass anti-bot protections.
              These controls may prevent deterministic replay.
            </p>
          </section>
        </aside>
      </div>
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

function HookEditor({
  description,
  label,
  onChange,
  residueWarning = false,
  value,
}: {
  readonly description: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly residueWarning?: boolean;
  readonly value: string;
}) {
  const configured = value.trim() !== '';
  const [editing, setEditing] = useState(false);
  return (
    <section className="panel crm-settings-section crm-hook-section">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{label}</p>
          <h2>
            {label === 'Preparation hook'
              ? 'Prepare controlled data'
              : 'Cleanup and residue'}
          </h2>
        </div>
        <StatusBadge
          tone={configured ? 'pass' : residueWarning ? 'warning' : 'neutral'}
        >
          {configured ? 'Configured' : 'Not configured'}
        </StatusBadge>
      </div>
      <p>{description}</p>
      {residueWarning && !configured ? (
        <StateMessage variant="warning">
          Runs may leave created or modified target data behind. Cleanup remains
          the target owner’s responsibility.
        </StateMessage>
      ) : null}
      <details
        className="crm-hook-editor"
        onToggle={(event) => setEditing(event.currentTarget.open)}
      >
        <summary>Edit {label.toLowerCase()} JSON</summary>
        {editing ? (
          <>
            <p>
              Hook headers or bodies may be sensitive. Their values are
              intentionally omitted from the collapsed settings summary.
            </p>
            <label>
              {label} JSON
              <textarea
                onChange={(event) => onChange(event.target.value)}
                placeholder={
                  label === 'Preparation hook'
                    ? '{\n  "method": "POST",\n  "url": "http://localhost:4300/reset",\n  "headers": {},\n  "body": null,\n  "timeoutMs": 5000\n}'
                    : 'Leave empty when no cleanup hook is configured.'
                }
                rows={12}
                value={value}
              />
            </label>
          </>
        ) : null}
      </details>
    </section>
  );
}

function parseHook(value: string, label: string): HttpHook | null {
  if (value.trim() === '') return null;
  try {
    return JSON.parse(value) as HttpHook;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function sentenceCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : 'Settings could not be updated.';
}
