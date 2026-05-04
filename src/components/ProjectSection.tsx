import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { GodbotClient } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { RefreshIcon } from './Icons';

/**
 * Project understanding subsection — auto-summarizes the current workspace
 * on first open, caches the result in `projectSummary[workspace]`. Refresh
 * forces a re-summarize through the daemon's auto_summarize endpoint.
 */
export function ProjectSection() {
  const workspace = useStore((s) => s.workspace);
  const projectSummary = useStore((s) => s.projectSummary);
  const setProjectSummary = useStore((s) => s.setProjectSummary);
  const daemonHealthy = useStore((s) => s.daemonHealthy);

  const client = useRef(new GodbotClient(DAEMON_URL)).current;
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-workspace lock so we don't re-fire the auto-fetch when the
  // daemon-healthy probe flips to true after we've already fetched.
  const fetchedRef = useRef<Set<string>>(new Set());

  const summary = workspace ? projectSummary[workspace] || '' : '';

  async function fetchSummary(force: boolean) {
    if (!workspace || !daemonHealthy) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.autoSummarize(workspace, force);
      setProjectSummary(workspace, res.summary);
      fetchedRef.current.add(workspace);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!workspace || !daemonHealthy) return;
    if (summary || fetchedRef.current.has(workspace)) return;
    void fetchSummary(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, daemonHealthy]);

  if (!workspace) return null;

  return (
    <div className="project-section">
      <div className="project-section-head">
        <button
          className="session-list-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span className="caret">{collapsed ? '▸' : '▾'}</span>
          <span>Project</span>
        </button>
        <div className="session-list-actions">
          <button
            className="icon-btn"
            title="Re-summarize"
            onClick={() => fetchSummary(true)}
            disabled={loading || !daemonHealthy}
          ><RefreshIcon /></button>
        </div>
      </div>
      {!collapsed && (
        <div className="project-section-body">
          {error && <div className="project-section-error">{error}</div>}
          {loading && !summary && <div className="project-section-empty">loading…</div>}
          {!loading && !summary && !error && (
            <div className="project-section-empty">No summary yet.</div>
          )}
          {summary && <pre className="project-summary-text">{summary}</pre>}
        </div>
      )}
    </div>
  );
}
