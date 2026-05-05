import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { spawnDaemon } from '../api/daemon';
import {
  GodbotClient,
  type SessionCost,
  type ContextUsage,
  type DaemonStats,
  type AuditEntry,
} from '../api/godbot';
import { DAEMON_URL } from '../api/config';

const COST_POLL_MS = 10_000;
const CONTEXT_POLL_MS = 8_000;

export function StatusBar() {
  const workspace = useStore((s) => s.workspace);
  const modelName = useStore((s) => s.modelName);
  const daemonStatus = useStore((s) => s.daemonStatus);
  const daemonError = useStore((s) => s.daemonError);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const sessionId = useStore((s) => s.sessionId);

  const client = useMemo(() => new GodbotClient(DAEMON_URL), []);
  const [cost, setCost] = useState<SessionCost | null>(null);
  const [ctx, setCtx] = useState<ContextUsage | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  const onRetry = () => { if (workspace) void spawnDaemon(workspace); };

  // Poll session cost every COST_POLL_MS while a session is bound + the
  // daemon is healthy. The endpoint is cheap (a single in-memory lookup
  // on the daemon), so we don't bother coalescing with chat events.
  const lastSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !daemonHealthy) {
      setCost(null);
      return;
    }
    if (lastSidRef.current !== sessionId) {
      lastSidRef.current = sessionId;
      setCost(null);
    }
    let cancel = false;
    async function tick() {
      if (!sessionId) return;
      try {
        const c = await client.getSessionCost(sessionId);
        if (!cancel) setCost(c);
      } catch {
        // 404s while the session is mid-creation are expected — ignore.
      }
    }
    void tick();
    const id = setInterval(tick, COST_POLL_MS);
    return () => { cancel = true; clearInterval(id); };
  }, [sessionId, daemonHealthy, client]);

  // Poll context-window usage (sub-project 111). Same lifetime rules
  // as cost — only runs while a session is bound + daemon is healthy.
  // Drives the green/yellow/red bar in the status bar so the user can
  // see when they're approaching the ~80% trim threshold.
  const lastCtxSidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !daemonHealthy) {
      setCtx(null);
      return;
    }
    if (lastCtxSidRef.current !== sessionId) {
      lastCtxSidRef.current = sessionId;
      setCtx(null);
    }
    let cancel = false;
    async function tick() {
      if (!sessionId) return;
      try {
        const u = await client.getContextUsage(sessionId);
        if (!cancel) setCtx(u);
      } catch {
        // 404 during session creation is expected — keep the last known
        // value so the bar doesn't flicker.
      }
    }
    void tick();
    const id = setInterval(tick, CONTEXT_POLL_MS);
    return () => { cancel = true; clearInterval(id); };
  }, [sessionId, daemonHealthy, client]);

  let label = 'daemon';
  let dotClass = 'bad';
  if (daemonStatus === 'spawning') { label = 'spawning…'; dotClass = 'spinning'; }
  else if (daemonHealthy) { label = 'daemon'; dotClass = 'ok'; }
  else if (daemonStatus === 'error') { label = 'daemon error'; dotClass = 'bad'; }

  // Hide the cost label entirely when the session has zero usage so we
  // don't show a noisy "$0.00" on a fresh session.
  const showCost = cost && cost.usage.total_tokens > 0;
  const costStr = cost ? formatUsd(cost.usd) : '';
  const turnsStr = cost ? `${cost.usage.turns} turn${cost.usage.turns === 1 ? '' : 's'}` : '';

  // Context bar shows only when a session is bound. Color-grade matches
  // the daemon's trim threshold of ~80%: green < 60, yellow 60-85, red > 85.
  const showCtx = !!sessionId && !!ctx;
  const ctxLevel = ctx
    ? (ctx.percent > 85 ? 'hot' : ctx.percent >= 60 ? 'warm' : 'cool')
    : 'cool';
  const ctxPctStr = ctx ? `${Math.round(ctx.percent)}%` : '';
  const ctxTokStr = ctx
    ? `${formatTokens(ctx.used_tokens)}/${formatTokens(ctx.max_context)} tokens`
    : '';

  return (
    <div className="status-bar">
      <button
        className="item daemon-btn"
        onClick={onRetry}
        disabled={daemonStatus === 'spawning'}
        title={daemonError ? `Click to retry. Last error: ${daemonError}` : 'Daemon status'}
      >
        <span className={`health-dot ${dotClass}`} />
        {label}
      </button>
      <span className="item">model: {modelName || '—'}</span>
      {showCtx && ctx && (
        <span
          className={`item status-context status-context-${ctxLevel}`}
          title={
            `Context window: ${ctx.used_tokens.toLocaleString()} / ` +
            `${ctx.max_context.toLocaleString()} tokens (${ctx.percent}% used). ` +
            `${ctx.turns} turn${ctx.turns === 1 ? '' : 's'}, ` +
            `~${ctx.avg_turn_tokens.toLocaleString()} tok/turn avg. ` +
            `Auto-trim engages near 80%.`
          }
        >
          <span className="status-context-bar">
            <span
              className="status-context-fill"
              style={{ width: `${Math.min(100, Math.max(0, ctx.percent))}%` }}
            />
          </span>
          <span className="status-context-label">
            {ctxPctStr} · {ctxTokStr}
          </span>
        </span>
      )}
      {showCost && (
        <span
          className="item status-cost"
          title={cost
            ? `${cost.usage.input_tokens} in / ${cost.usage.output_tokens} out tokens · ${cost.provider}/${cost.model}${cost.matched ? '' : ' (rate unknown)'}`
            : ''}
        >
          {costStr} · {turnsStr}{cost && !cost.matched ? ' (rate unknown)' : ''}
        </span>
      )}
      <button
        className="item daemon-btn status-stats-btn"
        onClick={() => setStatsOpen(true)}
        disabled={!daemonHealthy}
        title="Daemon stats"
      >
        stats
      </button>
      <button
        className="item daemon-btn status-stats-btn"
        onClick={() => setAuditOpen(true)}
        disabled={!daemonHealthy}
        title="Recent dangerous tool calls"
      >
        audit
      </button>
      <span className="item" style={{ marginLeft: 'auto' }}>
        {workspace ?? 'no workspace'}
      </span>
      {statsOpen && (
        <StatsModal client={client} onClose={() => setStatsOpen(false)} />
      )}
      {auditOpen && (
        <AuditModal client={client} onClose={() => setAuditOpen(false)} />
      )}
    </div>
  );
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/** "12345" → "12k", "999" → "999", "1234567" → "1.2M". */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function StatsModal({ client, onClose }: { client: GodbotClient; onClose: () => void }) {
  const [stats, setStats] = useState<DaemonStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const s = await client.getStats();
        if (!cancel) setStats(s);
      } catch (e: any) {
        if (!cancel) setError(String(e?.message ?? e));
      }
    })();
    return () => { cancel = true; };
  }, [client]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="stats-modal-backdrop" onClick={onClose}>
      <div className="stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stats-modal-head">
          <span>Daemon stats</span>
          <button onClick={onClose} title="Close (Esc)">×</button>
        </div>
        {error && <div className="stats-modal-err">{error}</div>}
        {!stats && !error && <div className="stats-modal-loading">loading…</div>}
        {stats && (
          <div className="stats-modal-body">
            <table>
              <tbody>
                <tr><td>Sessions</td><td>{stats.sessions}</td></tr>
                <tr><td>Turns</td><td>{stats.turns}</td></tr>
                <tr><td>Tool calls</td><td>{stats.tool_calls_total}</td></tr>
                <tr>
                  <td>Total tokens</td>
                  <td>{Number(stats.usage?.total_tokens ?? 0).toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Estimated cost</td>
                  <td>{formatUsd(stats.estimated_cost_usd)}</td>
                </tr>
              </tbody>
            </table>
            {stats.top_tools?.length > 0 && (
              <div className="stats-modal-section">
                <div className="stats-modal-h">Top tools</div>
                <ol>
                  {stats.top_tools.slice(0, 5).map((t) => (
                    <li key={t.name}><code>{t.name}</code> · {t.count}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Recent dangerous tool calls fetched from /api/audit. Mirrors the
 * StatsModal styling/keybinding patterns — no new CSS, ESC + backdrop
 * click both close.
 */
function AuditModal({ client, onClose }: { client: GodbotClient; onClose: () => void }) {
  const [calls, setCalls] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await client.getAudit(100);
        if (!cancel) setCalls(r.calls ?? []);
      } catch (e: any) {
        if (!cancel) setError(String(e?.message ?? e));
      }
    })();
    return () => { cancel = true; };
  }, [client]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="stats-modal-backdrop" onClick={onClose}>
      <div
        className="stats-modal"
        style={{ minWidth: 420, maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stats-modal-head">
          <span>Audit log {calls && calls.length > 0 ? `(${calls.length})` : ''}</span>
          <button onClick={onClose} title="Close (Esc)">×</button>
        </div>
        {error && <div className="stats-modal-err">{error}</div>}
        {!calls && !error && <div className="stats-modal-loading">loading…</div>}
        {calls && calls.length === 0 && (
          <div className="stats-modal-loading">No dangerous tool calls recorded.</div>
        )}
        {calls && calls.length > 0 && (
          <div className="stats-modal-body" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={c.id ?? `${c.timestamp ?? ''}-${i}`}>
                    <td style={{ verticalAlign: 'top' }}>
                      <code>{c.tool ?? '?'}</code>
                      {c.decision && (
                        <span style={{ marginLeft: 6, opacity: 0.6 }}>
                          {String(c.decision)}
                        </span>
                      )}
                      {c.timestamp && (
                        <div style={{ fontSize: 10, opacity: 0.6 }}>{c.timestamp}</div>
                      )}
                    </td>
                    <td
                      style={{
                        textAlign: 'left',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        opacity: 0.85,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                      title={c.session_id ?? ''}
                    >
                      {summariseAuditArgs(c.args)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** Trim audit args to one line for the table cell. */
function summariseAuditArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  try {
    const s = JSON.stringify(args);
    return s.length > 160 ? s.slice(0, 157) + '…' : s;
  } catch {
    return '';
  }
}
