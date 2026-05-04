import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  listSessions,
  deleteSession,
  type SessionEntry,
} from '../api/tauri';
import { GodbotClient, type SearchHit } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { CloseIcon, RefreshIcon } from './Icons';

const VISIBLE_LIMIT = 50;

/**
 * Sessions list rendered above the FileTree in the left sidebar.
 *
 * Lists every session under `<workspace>/.godbot-sessions/` newest-first.
 * Click a row to switch the chat panel to that session: we clear the
 * current chat state and reload the target session's history via the
 * daemon's GET /api/sessions/{sid}.
 *
 * "+ New" creates a fresh session via the daemon, replacing the active
 * one. Hover-x deletes after a confirm.
 */
export function SessionList() {
  const workspace = useStore((s) => s.workspace);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const setMessages = useStore((s) => s.setMessages);
  const clearChat = useStore((s) => s.clearChat);
  const setModel = useStore((s) => s.setModel);
  const daemonHealthy = useStore((s) => s.daemonHealthy);

  const client = useRef(new GodbotClient(DAEMON_URL)).current;
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Cross-session search state. When `searchResults` is non-null we
  // render the result list in place of the regular session rows; ESC
  // (or clearing the input) restores the normal view.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const sessionsRoot = workspace ? `${workspace}/.godbot-sessions` : null;

  async function refresh() {
    if (!sessionsRoot) { setEntries([]); return; }
    setLoading(true);
    setError(null);
    try {
      const list = await listSessions(sessionsRoot);
      setEntries(list);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [workspace]);

  // Re-fetch whenever sessionId changes — covers new sessions started
  // outside our control (e.g. ChatPanel's auto-create on workspace open).
  useEffect(() => { void refresh(); }, [sessionId]);

  async function switchTo(sid: string) {
    if (sid === sessionId) return;
    if (!daemonHealthy) {
      setError('Daemon offline — start it from the status bar first.');
      return;
    }
    try {
      const info = await client.getSession(sid);
      if (!info) {
        setError(`Session ${sid} not found on daemon.`);
        return;
      }
      // Reset the active chat then bind to the new session.
      clearChat();
      setSessionId(sid);
      if (info.model) setModel(info.model);
      // Map the daemon's LLM-format messages back to ChatMessage shape.
      // We only carry user/assistant turns; tool calls, gates and
      // raw-stream metadata are dropped because the daemon's stored
      // history is the LLM-facing view, not the UI-facing event log.
      // Restoring the full UI log would require parsing events.jsonl
      // ourselves — out of scope for v0.3.
      const restored = info.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          id: crypto.randomUUID(),
          role: m.role as 'user' | 'assistant',
          text: m.content,
        }));
      setMessages(restored);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function newSession() {
    if (!workspace || !daemonHealthy) {
      setError('Open a folder + wait for the daemon before starting a new session.');
      return;
    }
    try {
      const { defaultProvider, defaultModel, autoApprove, defaultMaxTokens, defaultMaxUsd } =
        useStore.getState();
      const sid = await client.newSession(workspace, autoApprove, {
        provider: defaultProvider || undefined,
        model: defaultModel || undefined,
      });
      clearChat();
      setSessionId(sid);
      if (defaultMaxTokens != null || defaultMaxUsd != null) {
        try {
          await client.setBudget(sid, {
            max_total_tokens: defaultMaxTokens,
            max_usd: defaultMaxUsd,
          });
        } catch (be) {
          console.warn('setBudget failed', be);
        }
      }
      const info = await client.getSession(sid);
      if (info?.model) setModel(info.model);
      void refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onDelete(sid: string) {
    if (!sessionsRoot) return;
    if (!window.confirm(`Delete session ${sid}? This cannot be undone.`)) return;
    try {
      await deleteSession(sessionsRoot, sid);
      // If we just deleted the active session, drop the binding.
      if (sid === sessionId) {
        setSessionId(null);
        clearChat();
      }
      void refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  const visible = useMemo(() => {
    return showAll ? entries : entries.slice(0, VISIBLE_LIMIT);
  }, [entries, showAll]);

  async function runSearch() {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    if (!daemonHealthy) {
      setError('Daemon offline — start it from the status bar first.');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const r = await client.searchSessions(q, workspace || undefined, 20);
      setSearchResults(r.matches ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults(null);
  }

  if (!workspace) return null;

  return (
    <div className="session-list">
      <div className="session-list-head">
        <button
          className="session-list-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <span className="caret">{collapsed ? '▸' : '▾'}</span>
          <span>Sessions</span>
          {entries.length > 0 && <span className="count">{entries.length}</span>}
        </button>
        <div className="session-list-actions">
          <button
            className="icon-btn"
            title="New session"
            onClick={newSession}
            disabled={!daemonHealthy}
          >+</button>
          <button
            className="icon-btn"
            title="Refresh"
            onClick={refresh}
            disabled={loading}
          ><RefreshIcon /></button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="session-search">
            <input
              type="text"
              className="session-search-input"
              value={searchQuery}
              placeholder="Search sessions…"
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() === '') setSearchResults(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  clearSearch();
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {searchQuery && (
              <button
                className="session-search-clear"
                onClick={clearSearch}
                title="Clear search (Esc)"
              >×</button>
            )}
          </div>
          {error && <div className="session-list-error">{error}</div>}
          {searchResults !== null ? (
            <>
              {searching && <div className="session-list-empty">searching…</div>}
              {!searching && searchResults.length === 0 && (
                <div className="session-list-empty">No matches.</div>
              )}
              {searchResults.map((hit, i) => (
                <SearchResultRow
                  key={`${hit.sid}-${hit.index ?? i}`}
                  hit={hit}
                  active={hit.sid === sessionId}
                  onClick={() => { void switchTo(hit.sid); }}
                />
              ))}
            </>
          ) : (
            <>
              {loading && entries.length === 0 && <div className="session-list-empty">loading…</div>}
              {!loading && entries.length === 0 && (
                <div className="session-list-empty">No sessions yet. Start chatting to create one.</div>
              )}
              {visible.map((e) => (
                <SessionRow
                  key={e.sid}
                  entry={e}
                  active={e.sid === sessionId}
                  onClick={() => switchTo(e.sid)}
                  onDelete={() => onDelete(e.sid)}
                />
              ))}
              {!showAll && entries.length > VISIBLE_LIMIT && (
                <button
                  className="session-list-more"
                  onClick={() => setShowAll(true)}
                >Show all ({entries.length})</button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SessionRow({
  entry,
  active,
  onClick,
  onDelete,
}: {
  entry: SessionEntry;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const subtitle = entry.last_user_msg_preview || '(no messages yet)';
  const modelLabel = entry.model_name || entry.model || entry.provider || '';
  return (
    <div
      className={`session-row${active ? ' active' : ''}`}
      onClick={onClick}
      title={`${entry.sid}\nstarted ${entry.started_at}\n${entry.provider}/${entry.model_name}`}
    >
      <div className="session-row-meta">
        <span className="session-when">{shortStarted(entry.started_at)}</span>
        {modelLabel && <span className="session-model">{modelLabel}</span>}
      </div>
      <div className="session-row-preview">{subtitle}</div>
      <button
        className="session-row-delete"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete session"
        aria-label={`Delete session ${entry.sid}`}
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

function SearchResultRow({
  hit,
  active,
  onClick,
}: {
  hit: SearchHit;
  active: boolean;
  onClick: () => void;
}) {
  const subtitle = (hit.preview || '').trim() || '(match)';
  return (
    <div
      className={`session-row${active ? ' active' : ''}`}
      onClick={onClick}
      title={hit.sid}
    >
      <div className="session-row-meta">
        <span className="session-when">
          {hit.started_at ? shortStarted(hit.started_at) : hit.sid.slice(0, 8)}
        </span>
        {typeof hit.index === 'number' && (
          <span className="session-model">turn {hit.index}</span>
        )}
      </div>
      <div className="session-row-preview">{subtitle}</div>
    </div>
  );
}

function shortStarted(iso: string): string {
  if (!iso) return '?';
  // Daemon writes `2026-05-04T12:34:56` — render as `05-04 12:34`.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, , mo, d, hh, mm] = m;
  return `${mo}-${d} ${hh}:${mm}`;
}
