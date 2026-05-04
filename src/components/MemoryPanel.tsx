import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { GodbotClient, type MemoryNote } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { CloseIcon, RefreshIcon, StarIcon } from './Icons';

/**
 * Workspace-scoped memory notes panel — pin/unpin/delete + substring search.
 * Pinned notes float to the top; otherwise newest-first.
 */
export function MemoryPanel() {
  const workspace = useStore((s) => s.workspace);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const client = useRef(new GodbotClient(DAEMON_URL)).current;

  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expandedTs, setExpandedTs] = useState<string | null>(null);

  // 200ms debounce so each keypress doesn't refetch.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  async function refresh() {
    if (!workspace || !daemonHealthy) return;
    setLoading(true);
    setError(null);
    try {
      const list = await client.listMemory(workspace, debouncedQuery || undefined);
      setNotes(list);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, debouncedQuery, daemonHealthy]);

  const sorted = useMemo(() => {
    const isPinned = (n: MemoryNote) => n.tags.includes('pinned');
    const cmp = (a: MemoryNote, b: MemoryNote) => {
      const ap = isPinned(a) ? 1 : 0;
      const bp = isPinned(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      // Newest first by timestamp string compare (ISO-like).
      return b.timestamp.localeCompare(a.timestamp);
    };
    return [...notes].sort(cmp);
  }, [notes]);

  async function togglePin(note: MemoryNote) {
    const pinned = note.tags.includes('pinned');
    try {
      await client.pinNote(note.timestamp, !pinned);
      void refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function deleteNote(note: MemoryNote) {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      await client.deleteNote(note.timestamp);
      if (expandedTs === note.timestamp) setExpandedTs(null);
      void refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  if (!workspace) {
    return (
      <div className="memory-panel">
        <div className="memory-panel-empty">Open a workspace to see its notes.</div>
      </div>
    );
  }

  return (
    <div className="memory-panel">
      <div className="memory-panel-head">
        <span className="memory-panel-title">Memory</span>
        <button
          className="icon-btn"
          title="Refresh"
          onClick={refresh}
          disabled={loading || !daemonHealthy}
        ><RefreshIcon /></button>
      </div>
      <div className="memory-panel-search">
        <input
          type="text"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <div className="memory-panel-error">{error}</div>}
      <div className="memory-panel-list">
        {loading && sorted.length === 0 && (
          <div className="memory-panel-empty">loading…</div>
        )}
        {!loading && sorted.length === 0 && !error && (
          <div className="memory-panel-empty">No notes for this workspace yet.</div>
        )}
        {sorted.map((n) => (
          <MemoryRow
            key={n.timestamp}
            note={n}
            expanded={expandedTs === n.timestamp}
            onToggle={() => setExpandedTs(expandedTs === n.timestamp ? null : n.timestamp)}
            onPinToggle={() => togglePin(n)}
            onDelete={() => deleteNote(n)}
          />
        ))}
      </div>
    </div>
  );
}

function MemoryRow({
  note, expanded, onToggle, onPinToggle, onDelete,
}: {
  note: MemoryNote;
  expanded: boolean;
  onToggle: () => void;
  onPinToggle: () => void;
  onDelete: () => void;
}) {
  const pinned = note.tags.includes('pinned');
  const preview = note.content.slice(0, 80) + (note.content.length > 80 ? '…' : '');
  return (
    <div className={`memory-row${pinned ? ' pinned' : ''}`}>
      <div className="memory-row-head">
        <span className="memory-row-when">{shortTs(note.timestamp)}</span>
        <button
          className="memory-row-preview"
          onClick={onToggle}
          title={expanded ? 'Collapse' : 'Expand'}
        >{preview || '(empty note)'}</button>
        <button
          className="memory-row-pin"
          onClick={(e) => { e.stopPropagation(); onPinToggle(); }}
          title={pinned ? 'Unpin' : 'Pin'}
          aria-label={pinned ? 'Unpin' : 'Pin'}
        ><StarIcon size={12} filled={pinned} /></button>
        <button
          className="memory-row-delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          aria-label="Delete"
        ><CloseIcon size={11} /></button>
      </div>
      {expanded && <pre className="memory-row-body">{note.content}</pre>}
    </div>
  );
}

function shortTs(iso: string): string {
  if (!iso) return '?';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, , mo, d, hh, mm] = m;
  return `${mo}-${d} ${hh}:${mm}`;
}
