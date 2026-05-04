import { useStore } from '../state/store';
import { PYTHON_PATH, DAEMON_PORT, DAEMON_URL } from '../api/config';

export function SettingsPanel() {
  const workspace = useStore((s) => s.workspace);
  const sessionId = useStore((s) => s.sessionId);
  const daemonStatus = useStore((s) => s.daemonStatus);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const daemonError = useStore((s) => s.daemonError);
  const modelName = useStore((s) => s.modelName);
  const showChat = useStore((s) => s.showChat);
  const leftWidth = useStore((s) => s.leftWidth);
  const rightWidth = useStore((s) => s.rightWidth);

  const sessionsRoot = workspace ? `${workspace}/.godbot-sessions` : '(no workspace)';
  const statusColor =
    daemonStatus === 'spawning' ? 'var(--warn)'
    : daemonHealthy ? 'var(--success)'
    : daemonStatus === 'error' ? 'var(--danger)'
    : 'var(--text-muted)';

  return (
    <div className="settings-panel">
      <h2>Settings</h2>
      <p className="settings-blurb">
        Live runtime info. A proper editable settings UI ships in v0.2 — for now most fields are read-only.
      </p>

      <section>
        <h3>Daemon</h3>
        <table>
          <tbody>
            <tr><td>Status</td><td><span className="dot" style={{ background: statusColor }} /> {daemonStatus} {daemonHealthy ? '(reachable)' : '(unreachable)'}</td></tr>
            <tr><td>URL</td><td><code>{DAEMON_URL}</code></td></tr>
            <tr><td>Port</td><td><code>{DAEMON_PORT}</code></td></tr>
            <tr><td>Python</td><td><code>{PYTHON_PATH}</code></td></tr>
            <tr><td>Sessions root</td><td><code>{sessionsRoot}</code></td></tr>
            {daemonError && <tr><td>Last error</td><td className="error-cell">{daemonError}</td></tr>}
          </tbody>
        </table>
        <p className="hint">
          To change the Python path, you currently need to edit <code>src/api/config.ts</code> in the source repo and rebuild. A live setting field is coming.
        </p>
      </section>

      <section>
        <h3>Session</h3>
        <table>
          <tbody>
            <tr><td>Workspace</td><td><code>{workspace ?? '(none)'}</code></td></tr>
            <tr><td>Session ID</td><td><code>{sessionId ?? '(none — open a folder to start one)'}</code></td></tr>
            <tr><td>Model</td><td><code>{modelName || '(unknown — sent on first message)'}</code></td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Layout</h3>
        <table>
          <tbody>
            <tr><td>Chat panel</td><td>{showChat ? 'Visible' : 'Hidden'} (toggle via the chat icon in the activity bar)</td></tr>
            <tr><td>Left sidebar width</td><td>{leftWidth}px</td></tr>
            <tr><td>Right sidebar width</td><td>{rightWidth}px</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>Keyboard shortcuts</h3>
        <table>
          <tbody>
            <tr><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td><td>Save active file</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>W</kbd></td><td>Close active tab (prompts if dirty)</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>Tab</kbd></td><td>Cycle tabs</td></tr>
            <tr><td><kbd>Ctrl</kbd>+<kbd>L</kbd></td><td>Focus chat composer</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h3>About</h3>
        <p>
          GodBot Studio v0.1.x — a Tauri + Monaco IDE that pairs with the GodBot agent harness.<br />
          Source: <code>https://github.com/IxMxAMAR/GodBot-Studio</code><br />
          Daemon: <code>https://github.com/IxMxAMAR/GodBot-Gemma</code>
        </p>
      </section>
    </div>
  );
}
