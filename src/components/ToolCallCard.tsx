import { useMemo, useRef, useState } from 'react';
import { ChevronRightIcon } from './Icons';
import { GodbotClient } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { useStore } from '../state/store';

const TOOL_GROUPS: Record<string, string> = {
  read_file: 'fs', write_file: 'fs', edit_file: 'fs',
  glob: 'fs', grep: 'fs', list_dir: 'fs', read_blob: 'fs',
  run_powershell: 'shell', run_bash: 'shell',
  web_fetch: 'web', web_search: 'web',
  run_python: 'python',
  save_note: 'memory', recall_notes: 'memory',
  todo_set: 'task', todo_check: 'task',
  search_knowledge: 'rag',
};

/**
 * Hard cap on inline-rendered blob content. Beyond this we render a
 * truncation marker plus a Download link backed by an object URL.
 * Picked at 50 KB to match the dispatch's stated guidance — at typical
 * monospace dimensions that's roughly 700 lines, which is enough to
 * skim but well below what the React reconciler chokes on.
 */
const INLINE_BLOB_CAP = 50_000;

export function ToolCallCard({
  callId, sessionId,
  name, args, result, durationMs, blob,
}: {
  callId?: string;
  sessionId?: string | null;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  blob?: string | null;
}) {
  const group = TOOL_GROUPS[name] ?? 'default';
  const argsPreview = Object.entries(args).slice(0, 5)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');

  const client = useMemo(() => new GodbotClient(DAEMON_URL), []);
  // Fall back to the active session id from the store when the parent
  // didn't supply one — the legacy `<ToolCallCard />` callsite in older
  // code paths only passes the basic shape.
  const storeSid = useStore((s) => s.sessionId);
  const sid = sessionId ?? storeSid;

  const [fullBlob, setFullBlob] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const downloadUrlRef = useRef<string | null>(null);

  /** Fetch the full blob; chooses inline vs download based on size. */
  async function showFullBlob() {
    if (!blob || !sid) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await client.getBlob(sid, blob);
      const content = resp.content ?? '';
      // Always offer a download link so giant blobs are still reachable.
      const url = URL.createObjectURL(
        new Blob([content], { type: 'text/plain' }),
      );
      // Revoke any prior URL we minted on this card.
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch { /* noop */ }
      }
      downloadUrlRef.current = url;
      setDownloadUrl(url);
      // Cap the inline render. Anything past the cap is reachable via
      // the Download link; we render a sentinel notice in the body.
      if (content.length > INLINE_BLOB_CAP) {
        setFullBlob(
          content.slice(0, INLINE_BLOB_CAP) +
          `\n\n…[truncated ${content.length - INLINE_BLOB_CAP} bytes — use Download for full file]`,
        );
      } else {
        setFullBlob(content);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  // Whether to show the "Show full result" affordance: we need a blob
  // id, the active session id, and we mustn't have already fetched it.
  const canExpand = !!blob && !!sid && fullBlob === null;
  const bodyText = fullBlob ?? result;

  return (
    <div className="chat-tool-card" data-group={group}>
      <div className="head" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ChevronRightIcon size={12} />
        <span>{name}({argsPreview})</span>
        {durationMs !== undefined && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>[{durationMs}ms]</span>}
        {blob && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(blob: {blob})</span>}
      </div>
      {bodyText && <div className="body">{bodyText}</div>}
      {(canExpand || downloadUrl || error) && (
        <div className="chat-tool-card-actions">
          {canExpand && (
            <button
              type="button"
              className="chat-tool-card-btn"
              onClick={() => { void showFullBlob(); }}
              disabled={loading}
              title={`Fetch the full blob (${callId ?? blob}) from the daemon`}
            >
              {loading ? 'loading…' : 'Show full result'}
            </button>
          )}
          {downloadUrl && (
            <a
              className="chat-tool-card-btn"
              href={downloadUrl}
              download={`${blob ?? 'blob'}.txt`}
              title="Download full blob as text"
            >
              Download
            </a>
          )}
          {error && (
            <span className="chat-tool-card-err">{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
