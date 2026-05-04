import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { PYTHON_PATH, DAEMON_PORT, DAEMON_URL } from '../api/config';
import { GodbotClient, type ProviderInfo, type ModelEntry } from '../api/godbot';
import {
  pickWorkspace,
  validatePython,
  type PythonValidation,
} from '../api/tauri';
import { spawnDaemon } from '../api/daemon';

/**
 * Editable settings panel — replaces the read-only v0.2 panel.
 *
 * The provider+model pickers consume the daemon's
 * `/api/providers` + `/api/providers/<name>/models` endpoints (added in
 * sub-project 7) so the UI never hardcodes a list. Settings that
 * require a daemon restart (python path, provider) surface a banner
 * with a "Restart daemon" button.
 */
export function SettingsPanel() {
  // Workspace + daemon state.
  const workspace = useStore((s) => s.workspace);
  const sessionId = useStore((s) => s.sessionId);
  const daemonStatus = useStore((s) => s.daemonStatus);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const daemonError = useStore((s) => s.daemonError);
  const modelName = useStore((s) => s.modelName);

  // Persisted preferences.
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const pythonPath = useStore((s) => s.pythonPath);
  const setPythonPath = useStore((s) => s.setPythonPath);
  const defaultProvider = useStore((s) => s.defaultProvider);
  const setDefaultProvider = useStore((s) => s.setDefaultProvider);
  const defaultModel = useStore((s) => s.defaultModel);
  const setDefaultModel = useStore((s) => s.setDefaultModel);
  const autoApprove = useStore((s) => s.autoApprove);
  const setAutoApprove = useStore((s) => s.setAutoApprove);

  const client = useRef(new GodbotClient(DAEMON_URL)).current;

  // Provider list (fetched from daemon).
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Track what the user committed to disk so we can show the
  // "needs daemon restart" banner only after a relevant edit.
  const lastAppliedPython = useRef(pythonPath);
  const lastAppliedProvider = useRef(defaultProvider);
  const restartNeeded =
    pythonPath !== lastAppliedPython.current ||
    defaultProvider !== lastAppliedProvider.current;

  // Python validation result, refreshed manually via the "Validate" button.
  const [pythonCheck, setPythonCheck] = useState<PythonValidation | null>(null);
  const [pythonChecking, setPythonChecking] = useState(false);

  // Effective Python path: user override OR compile-time default.
  const effectivePython = pythonPath.trim() || PYTHON_PATH;

  // Load providers when the daemon comes up.
  useEffect(() => {
    if (!daemonHealthy) return;
    let cancel = false;
    (async () => {
      setProvidersLoading(true);
      setProvidersError(null);
      try {
        const r = await client.listProviders();
        if (cancel) return;
        setProviders(r.providers);
        // If we never picked a default provider, seed it from the daemon's.
        if (!defaultProvider && r.default) {
          setDefaultProvider(r.default);
        }
      } catch (e: any) {
        if (!cancel) setProvidersError(String(e?.message ?? e));
      } finally {
        if (!cancel) setProvidersLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [daemonHealthy, client]);

  // Load models when the chosen provider changes.
  useEffect(() => {
    if (!daemonHealthy || !defaultProvider) {
      setModels([]);
      return;
    }
    let cancel = false;
    (async () => {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const r = await client.listModels(defaultProvider);
        if (cancel) return;
        if (r.error) {
          setModelsError(r.error);
          setModels(r.models ?? []);
        } else {
          setModels(r.models);
        }
      } catch (e: any) {
        if (!cancel) setModelsError(String(e?.message ?? e));
      } finally {
        if (!cancel) setModelsLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [daemonHealthy, defaultProvider, client]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.name === defaultProvider) ?? null,
    [providers, defaultProvider],
  );

  async function onPickWorkspace() {
    const path = await pickWorkspace();
    if (!path) return;
    // Closing the current session is the conservative choice — the new
    // workspace will spawn a fresh daemon + session.
    if (sessionId && !window.confirm('Switching workspace will close the current session. Continue?')) {
      return;
    }
    useStore.getState().setWorkspace(path);
    useStore.getState().setSessionId(null);
    useStore.getState().clearChat();
    const { listDir } = await import('../api/tauri');
    try {
      const tree = await listDir(path);
      useStore.getState().setFileTree(tree);
    } catch (e) {
      console.error('listDir failed', e);
    }
    await spawnDaemon(path);
  }

  async function onValidatePython() {
    setPythonChecking(true);
    try {
      const r = await validatePython(effectivePython);
      setPythonCheck(r);
    } finally {
      setPythonChecking(false);
    }
  }

  async function onRestartDaemon() {
    if (!workspace) return;
    // The Tauri spawn_daemon command itself checks if the child is alive
    // and spawns if not — so we ask the user to confirm killing the old
    // one then call again. For a clean restart we'd need a kill_daemon
    // command, which doesn't exist yet; for v0.3 we surface a dialog.
    if (!window.confirm(
      'Restart by killing the current daemon? You may need to manually kill the old python process if it doesn\'t shut down cleanly.',
    )) return;
    await spawnDaemon(workspace);
    lastAppliedPython.current = pythonPath;
    lastAppliedProvider.current = defaultProvider;
  }

  const statusColor =
    daemonStatus === 'spawning' ? 'var(--warn)'
    : daemonHealthy ? 'var(--success)'
    : daemonStatus === 'error' ? 'var(--danger)'
    : 'var(--text-muted)';

  return (
    <div className="settings-panel">
      <h2>Settings</h2>
      <p className="settings-blurb">
        Settings are saved locally (localStorage). Provider/model + python path require a daemon restart to take effect.
      </p>

      {restartNeeded && (
        <div className="settings-banner">
          <span>Some changes need a daemon restart to take effect.</span>
          <button onClick={onRestartDaemon} disabled={!workspace}>Restart daemon</button>
        </div>
      )}

      <section>
        <h3>Default provider &amp; model</h3>
        <div className="settings-grid">
          <label>Provider</label>
          <div>
            <select
              value={defaultProvider}
              onChange={(e) => { setDefaultProvider(e.target.value); setDefaultModel(''); }}
              disabled={!daemonHealthy || providersLoading}
            >
              {!defaultProvider && <option value="">(daemon default)</option>}
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{!p.has_api_key && p.configured ? '  — no api key' : ''}
                </option>
              ))}
            </select>
            {providersLoading && <span className="settings-hint"> loading…</span>}
            {providersError && <div className="settings-err">{providersError}</div>}
            {!daemonHealthy && (
              <div className="settings-hint">Daemon offline — start it from the status bar to populate this list.</div>
            )}
            {selectedProvider && !selectedProvider.has_api_key && (
              <div className="settings-warn">
                {selectedProvider.name} has no API key configured. Set the relevant env var or fill it in <code>~/.godbot/config.toml</code>.
              </div>
            )}
          </div>

          <label>Model</label>
          <div>
            <select
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              disabled={!daemonHealthy || !defaultProvider || modelsLoading}
            >
              <option value="">(provider default: {selectedProvider?.default_model || 'auto'})</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}{m.context_length ? `  (${m.context_length} ctx)` : ''}</option>
              ))}
            </select>
            {modelsLoading && <span className="settings-hint"> loading…</span>}
            {modelsError && <div className="settings-err">{modelsError}</div>}
          </div>
        </div>
      </section>

      <section>
        <h3>Workspace</h3>
        <div className="settings-grid">
          <label>Folder</label>
          <div>
            <code>{workspace ?? '(none)'}</code>
            <button
              className="settings-inline-btn"
              onClick={onPickWorkspace}
              style={{ marginLeft: 8 }}
            >Change…</button>
          </div>
          <label>Auto-approve in sandbox</label>
          <div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
              />
              <span>Auto-approve write_file/edit_file when the target is inside the workspace.</span>
            </label>
            <div className="settings-hint">Applies to newly-created sessions.</div>
          </div>
        </div>
      </section>

      <section>
        <h3>Appearance</h3>
        <div className="settings-grid">
          <label>Theme</label>
          <div>
            <select value={theme} onChange={(e) => setTheme(e.target.value as 'dark' | 'light')}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>
      </section>

      <section>
        <h3>Daemon</h3>
        <div className="settings-grid">
          <label>Status</label>
          <div>
            <span className="dot" style={{ background: statusColor }} /> {daemonStatus}
            {daemonHealthy ? ' (reachable)' : ' (unreachable)'}
            {workspace && (
              <button
                className="settings-inline-btn"
                onClick={onRestartDaemon}
                style={{ marginLeft: 8 }}
              >Restart</button>
            )}
            {daemonError && <div className="settings-err">{daemonError}</div>}
          </div>
          <label>URL</label>
          <div><code>{DAEMON_URL}</code></div>
          <label>Port</label>
          <div><code>{DAEMON_PORT}</code></div>
        </div>
      </section>

      <section>
        <h3>Python interpreter</h3>
        <div className="settings-grid">
          <label>Path</label>
          <div>
            <input
              type="text"
              value={pythonPath}
              placeholder={PYTHON_PATH}
              onChange={(e) => setPythonPath(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                className="settings-inline-btn"
                onClick={onValidatePython}
                disabled={pythonChecking}
              >{pythonChecking ? 'Checking…' : 'Validate'}</button>
              {pythonCheck && (
                pythonCheck.ok
                  ? <span className="settings-ok">{pythonCheck.version || 'ok'}</span>
                  : <span className="settings-err">{pythonCheck.error || 'failed'}</span>
              )}
            </div>
            <div className="settings-hint">
              Leave blank to use the compile-time default (<code>{PYTHON_PATH}</code>). Restart the daemon to apply.
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3>Session</h3>
        <table>
          <tbody>
            <tr><td>Session ID</td><td><code>{sessionId ?? '(none)'}</code></td></tr>
            <tr><td>Active model</td><td><code>{modelName || '(unknown)'}</code></td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Keyboard shortcuts</h3>
        <table>
          <tbody>
            <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save active file</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>W</kbd></td><td>Close active tab</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Tab</kbd></td><td>Cycle tabs</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>L</kbd></td><td>Focus chat composer</td></tr>
            <tr><td><kbd>@</kbd></td><td>Mention a workspace file in chat</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>About</h3>
        <p>
          GodBot Studio v0.3.0 — a Tauri + Monaco IDE that pairs with the GodBot agent harness.<br />
          Source: <code>https://github.com/IxMxAMAR/GodBot-Studio</code><br />
          Daemon: <code>https://github.com/IxMxAMAR/GodBot-Gemma</code>
        </p>
      </section>
    </div>
  );
}
