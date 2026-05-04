import { useEffect, useMemo, useState } from 'react';
import { pickWorkspace, listDir } from '../api/tauri';
import { useStore } from '../state/store';
import { spawnDaemon } from '../api/daemon';
import { GodbotClient, type WorkspaceSummary } from '../api/godbot';
import { DAEMON_URL } from '../api/config';

const RECENT_LIMIT = 10;

export function WorkspacePicker() {
  const setWorkspace = useStore((s) => s.setWorkspace);
  const setFileTree = useStore((s) => s.setFileTree);

  // Recent workspaces dropdown — populated once on mount from the
  // daemon's `/api/workspaces` endpoint. The endpoint can fail when the
  // daemon isn't running yet (the WorkspacePicker only renders when no
  // folder is open, which usually means no daemon either) — in that
  // case we silently render only the "Open Folder…" button.
  const client = useMemo(() => new GodbotClient(DAEMON_URL), []);
  const [recents, setRecents] = useState<WorkspaceSummary[] | null>(null);
  const [recentsError, setRecentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await client.listWorkspaces();
        if (cancel) return;
        const sorted = (r.workspaces ?? []).slice().sort((a, b) => {
          const at = a.last_activity ?? '';
          const bt = b.last_activity ?? '';
          return bt.localeCompare(at);
        });
        setRecents(sorted.slice(0, RECENT_LIMIT));
      } catch (e: any) {
        if (cancel) return;
        // Daemon offline is the expected case — keep the message subtle.
        setRecentsError(String(e?.message ?? e));
      }
    })();
    return () => { cancel = true; };
  }, [client]);

  /**
   * Bind a workspace path: mirror what `onPick` does, minus the file
   * picker dialog. Used by the recent-workspaces dropdown.
   */
  async function openPath(path: string) {
    setWorkspace(path);
    try {
      const tree = await listDir(path);
      setFileTree(tree);
    } catch (e) {
      // listDir can fail if the folder was moved/deleted on disk —
      // surface the error path through the chat panel via spawnDaemon's
      // own error handling (it'll fail downstream and render).
      console.warn('listDir failed', e);
      setFileTree([]);
    }
    await spawnDaemon(path);
  }

  async function onPick() {
    const path = await pickWorkspace();
    if (!path) return;
    await openPath(path);
  }

  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
      <p>No folder open.</p>
      <button
        onClick={onPick}
        style={{
          background: 'var(--accent)',
          color: 'var(--bg)',
          padding: '6px 16px',
          borderRadius: 4,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Open Folder...
      </button>
      {recents && recents.length > 0 && (
        <div style={{ marginTop: 18, textAlign: 'left' }}>
          <div style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            color: 'var(--text-muted)',
            marginBottom: 6,
            paddingLeft: 4,
          }}>
            Recent workspaces
          </div>
          <div className="recent-workspaces">
            {recents.map((w) => (
              <button
                key={w.path}
                className="recent-workspace-row"
                onClick={() => { void openPath(w.path); }}
                title={`${w.path}\n${w.sessions} session${w.sessions === 1 ? '' : 's'}${w.last_activity ? `\nlast: ${w.last_activity}` : ''}`}
              >
                <span className="recent-workspace-path">{shortenPath(w.path)}</span>
                <span className="recent-workspace-meta">
                  {w.sessions}{w.last_activity ? ` · ${shortDate(w.last_activity)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {recents && recents.length === 0 && !recentsError && (
        <div style={{ marginTop: 14, fontSize: 11, opacity: 0.6 }}>
          No prior workspaces yet.
        </div>
      )}
    </div>
  );
}

/** Trim the workspace path to the last two segments for compact display. */
function shortenPath(p: string): string {
  const norm = p.replace(/[\\]+/g, '/').replace(/\/+$/, '');
  const parts = norm.split('/');
  if (parts.length <= 2) return norm;
  return '…/' + parts.slice(-2).join('/');
}

/** ISO-ish timestamp → `MM-DD HH:mm` for the recent-workspaces meta line. */
function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso.slice(0, 10);
  const [, , mo, d, hh, mm] = m;
  return `${mo}-${d} ${hh}:${mm}`;
}
