import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  listSessions,
  deleteSession,
  type SessionEntry,
} from '../api/tauri';
import { GodbotClient, type SearchHit, type GodbotEvent } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { CloseIcon, RefreshIcon, StarIcon } from './Icons';

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

  // Sid of the session currently being replayed in a modal, or null when
  // no replay is open. Driven by the ⏵ button on each session row.
  const [replaySid, setReplaySid] = useState<string | null>(null);

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

  /**
   * Flip the daemon-side `pinned` flag for `sid`. Optimistically reorders
   * the local list (pinned rows float to the top) then refetches once
   * the daemon write returns so the row re-renders from the canonical
   * meta.json view.
   */
  async function onTogglePin(sid: string, currentlyPinned: boolean) {
    if (!daemonHealthy) {
      setError('Daemon offline — start it from the status bar first.');
      return;
    }
    // Optimistic re-render: flip pinned in `entries` and resort.
    setEntries((prev) => sortEntries(
      prev.map((e) => (e.sid === sid ? { ...e, pinned: !currentlyPinned } : e)),
    ));
    try {
      await client.pinSession(sid, !currentlyPinned);
      void refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
      // Roll back the optimistic flip.
      setEntries((prev) => sortEntries(
        prev.map((e) => (e.sid === sid ? { ...e, pinned: currentlyPinned } : e)),
      ));
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
                  onTogglePin={() => onTogglePin(e.sid, !!e.pinned)}
                  onReplay={() => setReplaySid(e.sid)}
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
      {replaySid && (
        <ReplayModal
          client={client}
          sid={replaySid}
          onClose={() => setReplaySid(null)}
        />
      )}
    </div>
  );
}

/**
 * Pinned rows float to the top of the list, otherwise newest started_at
 * wins. Mirrors the Rust-side sort in `list_sessions` so optimistic
 * reorders match the post-refresh order.
 */
function sortEntries(list: SessionEntry[]): SessionEntry[] {
  return [...list].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.started_at || '').localeCompare(a.started_at || '');
  });
}

function SessionRow({
  entry,
  active,
  onClick,
  onDelete,
  onTogglePin,
  onReplay,
}: {
  entry: SessionEntry;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onReplay: () => void;
}) {
  const subtitle = entry.last_user_msg_preview || '(no messages yet)';
  const modelLabel = entry.model_name || entry.model || entry.provider || '';
  const pinned = !!entry.pinned;
  return (
    <div
      className={`session-row${active ? ' active' : ''}${pinned ? ' pinned' : ''}`}
      onClick={onClick}
      title={`${entry.sid}\nstarted ${entry.started_at}\n${entry.provider}/${entry.model_name}${pinned ? '\n(pinned)' : ''}`}
    >
      <div className="session-row-meta">
        <span className="session-when">{shortStarted(entry.started_at)}</span>
        {modelLabel && <span className="session-model">{modelLabel}</span>}
      </div>
      <div className="session-row-preview">{subtitle}</div>
      <button
        className={`session-row-pin${pinned ? ' on' : ''}`}
        onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
        title={pinned ? 'Unpin session' : 'Pin session'}
        aria-label={pinned ? `Unpin session ${entry.sid}` : `Pin session ${entry.sid}`}
        aria-pressed={pinned}
      >
        <StarIcon size={11} filled={pinned} />
      </button>
      <button
        className="session-row-replay"
        onClick={(e) => { e.stopPropagation(); onReplay(); }}
        title="Replay session"
        aria-label={`Replay session ${entry.sid}`}
      >
        <ReplayGlyph />
      </button>
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

/** Minimal play-triangle glyph for the row-level "Replay" button. */
function ReplayGlyph() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" width={11} height={11} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden
    >
      <polygon points="6,4 20,12 6,20" />
    </svg>
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

/**
 * Past-session playback modal. Drives `streamReplay(sid, 200)` and renders
 * each event as a chat-bubble-style row in real time so you can scrub
 * through what happened. ESC / × close, which aborts the SSE stream via
 * `AbortController`. We reuse the same `chat-bubble-*` and `chat-tool-card`
 * classes the live ChatPanel uses; that gives us styled bubbles for free
 * with no new CSS.
 */
type ReplayRow =
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'tool_call'; name: string; argsPreview: string }
  | { id: string; kind: 'tool_result'; preview: string }
  | { id: string; kind: 'gate'; name: string }
  | { id: string; kind: 'error'; text: string };

function ReplayModal({
  client,
  sid,
  onClose,
}: {
  client: GodbotClient;
  sid: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<ReplayRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ESC closes — mirrors the StatsModal/AuditModal convention.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Drive the SSE replay stream. Aborts on close via the cleanup signal.
  useEffect(() => {
    const ctrl = new AbortController();
    let cancel = false;
    let bufferText = '';
    let activeAssistantId: string | null = null;
    (async () => {
      try {
        for await (const ev of client.streamReplay(sid, 200, ctrl.signal)) {
          if (cancel) return;
          appendFromEvent(ev);
        }
        if (!cancel) setDone(true);
      } catch (e: any) {
        if (cancel || e?.name === 'AbortError') return;
        setError(String(e?.message ?? e));
      }
    })();

    function appendFromEvent(ev: GodbotEvent) {
      if (ev.type === 'token') {
        bufferText += ev.text;
        if (activeAssistantId) {
          const id = activeAssistantId;
          setRows((prev) => prev.map((r) =>
            r.id === id && r.kind === 'assistant' ? { ...r, text: bufferText } : r,
          ));
        } else {
          activeAssistantId = `asst-${rowsLen()}`;
          const id = activeAssistantId;
          setRows((prev) => [...prev, { id, kind: 'assistant', text: bufferText }]);
        }
      } else if (ev.type === 'tool_call') {
        // Snapshot the assistant bubble (if any) and start a fresh one
        // after the tool result lands.
        bufferText = '';
        activeAssistantId = null;
        const argsPreview = Object.entries(ev.args ?? {}).slice(0, 3)
          .map(([k, v]) => `${k}=${truncate(JSON.stringify(v), 40)}`).join(', ');
        setRows((prev) => [...prev, { id: ev.id, kind: 'tool_call', name: ev.name, argsPreview }]);
      } else if (ev.type === 'tool_result') {
        setRows((prev) => [...prev, { id: `tr-${ev.id}`, kind: 'tool_result', preview: ev.preview }]);
      } else if (ev.type === 'gate') {
        setRows((prev) => [...prev, { id: ev.id, kind: 'gate', name: ev.name }]);
      } else if (ev.type === 'agent_error') {
        setRows((prev) => [...prev, { id: `err-${rowsLen()}`, kind: 'error', text: ev.message }]);
      } else if (ev.type === 'done') {
        setDone(true);
      }
    }

    function rowsLen(): number {
      // We can't read `rows` directly from inside the closure (it's
      // closed over the initial value) — but we only use this for unique
      // ids, and the SSE stream is sequential, so a counter via Date.now
      // is good enough as a fallback. Keep it monotonic by mixing in the
      // current high-res time.
      return Math.floor(performance.now() * 1000);
    }

    return () => {
      cancel = true;
      try { ctrl.abort(); } catch { /* ignore */ }
    };
  }, [client, sid]);

  // Auto-scroll the body as new rows append.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <div className="stats-modal-backdrop" onClick={onClose}>
      <div
        className="stats-modal"
        style={{ minWidth: 480, maxWidth: 720, width: '60vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stats-modal-head">
          <span>
            Replay <code style={{ fontSize: 10 }}>{sid.slice(0, 12)}</code>
            {done && <span style={{ marginLeft: 8, opacity: 0.6 }}>· done</span>}
          </span>
          <button onClick={onClose} title="Close (Esc)">×</button>
        </div>
        {error && <div className="stats-modal-err">{error}</div>}
        <div
          ref={scrollRef}
          className="stats-modal-body"
          style={{ maxHeight: '60vh', overflowY: 'auto' }}
        >
          {rows.length === 0 && !error && (
            <div className="stats-modal-loading">replaying…</div>
          )}
          {rows.map((r) => {
            if (r.kind === 'assistant') {
              return <div key={r.id} className="chat-bubble-assistant">{r.text || '…'}</div>;
            }
            if (r.kind === 'tool_call') {
              return (
                <div key={r.id} className="chat-tool-card">
                  <div className="head">
                    <span>{r.name}({r.argsPreview})</span>
                  </div>
                </div>
              );
            }
            if (r.kind === 'tool_result') {
              return (
                <div key={r.id} className="chat-tool-card">
                  <div className="body">{r.preview}</div>
                </div>
              );
            }
            if (r.kind === 'gate') {
              return (
                <div key={r.id} className="chat-tool-card" data-group="shell">
                  <div className="head">
                    <span>gate · {r.name}</span>
                  </div>
                </div>
              );
            }
            if (r.kind === 'error') {
              return <div key={r.id} className="chat-error">{r.text}</div>;
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
