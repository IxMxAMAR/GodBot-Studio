export interface TokenEvent { type: 'token'; text: string; }
export interface ToolCallEvent { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; }
export interface ToolResultEvent { type: 'tool_result'; id: string; preview: string; blob: string | null; duration_ms: number; }
export interface GateEvent {
  type: 'gate';
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Populated for write_file/edit_file gates so UIs can render a diff. */
  fs_diff?: { path: string; before: string | null; after: string } | null;
}
export interface AgentErrorEvent { type: 'agent_error'; message: string; recoverable: boolean; }
export interface DoneEvent { type: 'done'; step_count: number; }
export type GodbotEvent = TokenEvent | ToolCallEvent | ToolResultEvent | GateEvent | AgentErrorEvent | DoneEvent;

/** Response shape from GET /api/sessions/{sid}. */
export interface SessionInfo {
  id: string;
  model: string;
  provider?: string;
  model_name?: string;
  protocol?: string | null;
  /** LLM-format message log: `[{role: 'user'|'assistant', content: string}, ...]` */
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  yolo?: boolean;
  workspace_root?: string | null;
  auto_approve_in_sandbox?: boolean;
}

/** GET /api/providers — added in sub-project 7. */
export interface ProviderInfo {
  name: string;
  configured: boolean;
  registered: boolean;
  default_model: string;
  base_url: string;
  has_api_key: boolean;
}
export interface ProvidersResponse {
  default: string;
  providers: ProviderInfo[];
}

/** GET /api/providers/{name}/models. */
export interface ModelEntry {
  id: string;
  context_length?: number;
  supports_native_tools?: boolean;
}
export interface ModelsResponse {
  models: ModelEntry[];
  error?: string;
}

/** Item shape returned by GET /api/memory. */
export interface MemoryNote {
  timestamp: string;
  content: string;
  tags: string[];
  workspace: string | null;
}

/** GET /api/sessions/{sid}/usage. */
export interface SessionUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  turns: number;
}

/** GET /api/sessions/{sid}/cost. */
export interface SessionCost {
  usd: number;
  input_usd: number;
  output_usd: number;
  /** Per-million pricing record. */
  rate: { input?: number; output?: number } | null;
  /** false when no pricing entry matched the provider+model. */
  matched: boolean;
  provider: string;
  model: string;
  usage: SessionUsage;
}

/** GET/POST /api/sessions/{sid}/budget. */
export interface Budget {
  max_total_tokens: number | null;
  max_usd: number | null;
}

/** Per-turn rating record returned by GET /api/sessions/{sid}/feedback. */
export interface FeedbackEntry {
  target_index: number;
  rating: 'up' | 'down';
  comment?: string | null;
  timestamp?: string;
}

/** GET /api/sessions/{sid}/feedback shape. */
export interface FeedbackSummary {
  up: number;
  down: number;
  /** Map from target_index → most recent rating record. */
  latest_by_index: Record<string, FeedbackEntry>;
}

/** Single hit returned by GET /api/sessions/search. */
export interface SearchHit {
  sid: string;
  workspace?: string | null;
  started_at?: string;
  /** Snippet of the matching message, when available. */
  preview?: string;
  /** 0-based index of the matching message in the session log. */
  index?: number;
  /** Free-form score, when the daemon supplies one. */
  score?: number;
}

/** GET /api/stats — top-level daemon counters. */
export interface DaemonStats {
  sessions: number;
  turns: number;
  tool_calls_total: number;
  top_tools: Array<{ name: string; count: number }>;
  tasks: Record<string, unknown>;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [k: string]: unknown;
  };
  estimated_cost_usd: number;
}

/** GET /api/commands. */
export interface CommandInfo {
  name: string;
  description: string;
  tool_overrides?: string[] | null;
  source_path?: string | null;
}

/** Background-task record from GET /api/tasks{,/{tid}}. */
export interface TaskRecord {
  id: string;
  goal: string;
  status: string;
  workspace?: string | null;
  provider?: string | null;
  model?: string | null;
  step?: number;
  max_steps?: number;
  started_at?: string;
  finished_at?: string | null;
  result?: unknown;
  error?: string | null;
  [k: string]: unknown;
}

/** SSE chunks emitted by GET /api/tasks/{tid}/stream. */
export type TaskStreamEvent =
  | { type: 'status'; status: string; step?: number; max_steps?: number }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; preview: string; duration_ms?: number }
  | { type: 'agent_error'; message: string; recoverable?: boolean }
  | { type: 'done'; result?: unknown };

/** SSE chunks emitted by POST /api/complete/stream. */
export type CompletionStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; model: string }
  | { type: 'error'; message: string };

/** Body shape for POST /api/tasks. */
export interface TaskStartBody {
  goal: string;
  workspace?: string;
  provider?: string;
  model?: string;
  max_steps?: number;
  tool_overrides?: string[];
  safe_only?: boolean;
}

/** Body shape for POST /api/complete/stream. */
export interface CompletionStreamBody {
  prefix: string;
  suffix?: string;
  language?: string;
  provider?: string;
  model?: string;
}

export class GodbotClient {
  constructor(public baseUrl = 'http://127.0.0.1:7879') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/health`);
      return r.ok;
    } catch {
      return false;
    }
  }

  async getSession(sid: string): Promise<SessionInfo | null> {
    try {
      const r = await fetch(`${this.baseUrl}/api/sessions/${sid}`);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async listProviders(): Promise<ProvidersResponse> {
    const r = await fetch(`${this.baseUrl}/api/providers`);
    if (!r.ok) throw new Error(`listProviders ${r.status}`);
    return await r.json();
  }

  async listModels(provider: string): Promise<ModelsResponse> {
    const r = await fetch(`${this.baseUrl}/api/providers/${encodeURIComponent(provider)}/models`);
    if (!r.ok) throw new Error(`listModels ${r.status}`);
    return await r.json();
  }

  async newSession(
    workspace?: string,
    autoApprove = true,
    opts: { provider?: string; model?: string } = {},
  ): Promise<string> {
    const body: Record<string, unknown> = { model: opts.model || 'auto' };
    if (workspace) body.workspace = workspace;
    if (autoApprove) body.auto_approve_in_sandbox = true;
    if (opts.provider) body.provider = opts.provider;
    if (opts.model) body.model_name = opts.model;
    const r = await fetch(`${this.baseUrl}/api/sessions/new`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`new_session ${r.status}: ${await r.text()}`);
    return (await r.json()).session_id;
  }

  async send(sid: string, message: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sid, message }),
    });
    if (!r.ok) throw new Error(`send ${r.status}: ${await r.text()}`);
  }

  async resolveGate(
    sid: string,
    callId: string,
    decision: 'allow' | 'deny' | 'always',
    argsOverride?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { session_id: sid, decision };
    if (argsOverride) body.args_override = argsOverride;
    const r = await fetch(`${this.baseUrl}/api/gate/${callId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`gate ${r.status}: ${await r.text()}`);
  }

  async stop(sid: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/stop`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sid }),
    });
  }

  async listTools(): Promise<Array<{ name: string; description: string; dangerous: boolean }>> {
    const r = await fetch(`${this.baseUrl}/api/tools`);
    if (!r.ok) return [];
    return r.json();
  }

  async listMemory(workspace?: string, q?: string): Promise<MemoryNote[]> {
    const params = new URLSearchParams();
    if (workspace) params.set('workspace', workspace);
    if (q) params.set('q', q);
    const qs = params.toString();
    const r = await fetch(`${this.baseUrl}/api/memory${qs ? `?${qs}` : ''}`);
    if (!r.ok) throw new Error(`listMemory ${r.status}: ${await r.text()}`);
    const body = await r.json();
    return (body.notes ?? []) as MemoryNote[];
  }

  async pinNote(timestamp: string, pin: boolean): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/memory/pin`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timestamp, pin }),
    });
    if (!r.ok) throw new Error(`pinNote ${r.status}: ${await r.text()}`);
  }

  async deleteNote(timestamp: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/memory/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timestamp }),
    });
    if (!r.ok) throw new Error(`deleteNote ${r.status}: ${await r.text()}`);
  }

  /**
   * Cursor-style inline completion. Returns `supported: false` when the daemon
   * answers HTTP 501 (provider doesn't implement /api/complete — Anthropic
   * and Gemini at the moment) so callers can stop firing requests for the
   * rest of the session. HTTP 502 (transient upstream error) returns
   * `supported: true` with an empty completion so callers can back off
   * without disabling the feature outright.
   */
  async inlineComplete(opts: {
    prefix: string;
    suffix?: string;
    language?: string;
    signal?: AbortSignal;
  }): Promise<{ completion: string; model: string; elapsedMs: number; supported: boolean }> {
    const body: Record<string, unknown> = { prefix: opts.prefix };
    if (opts.suffix !== undefined) body.suffix = opts.suffix;
    if (opts.language) body.language = opts.language;
    const r = await fetch(`${this.baseUrl}/api/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (r.status === 501) {
      return { completion: '', model: '', elapsedMs: 0, supported: false };
    }
    if (r.status === 502) {
      // Transient upstream failure — keep the feature on but skip this turn.
      return { completion: '', model: '', elapsedMs: 0, supported: true };
    }
    if (!r.ok) throw new Error(`inlineComplete ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return {
      completion: String(j.completion ?? ''),
      model: String(j.model ?? ''),
      elapsedMs: Number(j.elapsed_ms ?? 0),
      supported: true,
    };
  }

  async autoSummarize(workspace: string, force = false): Promise<{ summary: string; cached: boolean }> {
    const r = await fetch(`${this.baseUrl}/api/memory/auto_summarize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace, force }),
    });
    if (!r.ok) throw new Error(`autoSummarize ${r.status}: ${await r.text()}`);
    const body = await r.json();
    return { summary: String(body.summary ?? ''), cached: !!body.cached };
  }

  // ---------------------------------------------------------------------
  // Usage / cost / budget (sub-projects 18-19)
  // ---------------------------------------------------------------------

  async getSessionUsage(sid: string): Promise<SessionUsage> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/usage`);
    if (!r.ok) throw new Error(`getSessionUsage ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async getSessionCost(sid: string): Promise<SessionCost> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/cost`);
    if (!r.ok) throw new Error(`getSessionCost ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async getBudget(sid: string): Promise<Budget> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/budget`);
    if (!r.ok) throw new Error(`getBudget ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async setBudget(
    sid: string,
    body: { max_total_tokens?: number | null; max_usd?: number | null },
  ): Promise<Budget> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/budget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`setBudget ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  // ---------------------------------------------------------------------
  // Feedback (sub-project 20)
  // ---------------------------------------------------------------------

  async getFeedback(sid: string): Promise<FeedbackSummary> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/feedback`);
    if (!r.ok) throw new Error(`getFeedback ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async postFeedback(
    sid: string,
    target_index: number,
    rating: 'up' | 'down',
    comment?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = { target_index, rating };
    if (comment) body.comment = comment;
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`postFeedback ${r.status}: ${await r.text()}`);
  }

  // ---------------------------------------------------------------------
  // Blobs / export / search / cleanup / delete / fork (sub-projects 21-26)
  // ---------------------------------------------------------------------

  async getBlob(
    sid: string,
    callId: string,
  ): Promise<{ call_id: string; length: number; content: string }> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/blobs/${encodeURIComponent(callId)}`);
    if (!r.ok) throw new Error(`getBlob ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  /**
   * Export a session log. JSON returns the parsed object; markdown returns a
   * raw string the caller can write to disk or render as text.
   */
  async exportSession(sid: string, format: 'json'): Promise<unknown>;
  async exportSession(sid: string, format: 'markdown'): Promise<string>;
  async exportSession(sid: string, format: 'json' | 'markdown'): Promise<unknown> {
    const r = await fetch(
      `${this.baseUrl}/api/sessions/${sid}/export?format=${encodeURIComponent(format)}`,
    );
    if (!r.ok) throw new Error(`exportSession ${r.status}: ${await r.text()}`);
    if (format === 'markdown') return await r.text();
    return await r.json();
  }

  async searchSessions(
    q: string,
    workspace?: string,
    limit: number = 20,
  ): Promise<{ matches: SearchHit[] }> {
    const params = new URLSearchParams();
    params.set('q', q);
    if (workspace) params.set('workspace', workspace);
    if (limit) params.set('limit', String(limit));
    const r = await fetch(`${this.baseUrl}/api/sessions/search?${params.toString()}`);
    if (!r.ok) throw new Error(`searchSessions ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async cleanupSessions(
    olderThanDays: number = 30,
    dryRun: boolean = false,
  ): Promise<{ deleted: string[]; kept?: number; dry_run: boolean }> {
    const r = await fetch(`${this.baseUrl}/api/sessions/cleanup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ older_than_days: olderThanDays, dry_run: dryRun }),
    });
    if (!r.ok) throw new Error(`cleanupSessions ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async deleteSessionRemote(sid: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`deleteSession ${r.status}: ${await r.text()}`);
  }

  async forkSession(
    sid: string,
    upToIndex?: number,
  ): Promise<{ session_id: string; forked_from: string; events_copied: number }> {
    const body: Record<string, unknown> = {};
    if (typeof upToIndex === 'number') body.up_to_index = upToIndex;
    const r = await fetch(`${this.baseUrl}/api/sessions/${sid}/fork`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`forkSession ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  // ---------------------------------------------------------------------
  // Stats / cost estimate (sub-projects 27-28)
  // ---------------------------------------------------------------------

  async getStats(): Promise<DaemonStats> {
    const r = await fetch(`${this.baseUrl}/api/stats`);
    if (!r.ok) throw new Error(`getStats ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async estimateCost(
    provider: string,
    model: string,
    input_tokens: number,
    output_tokens: number,
  ): Promise<SessionCost> {
    const r = await fetch(`${this.baseUrl}/api/cost/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model, input_tokens, output_tokens }),
    });
    if (!r.ok) throw new Error(`estimateCost ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  // ---------------------------------------------------------------------
  // Commands / tools reload (sub-projects 29-30)
  // ---------------------------------------------------------------------

  async listCommands(): Promise<{ commands: CommandInfo[] }> {
    const r = await fetch(`${this.baseUrl}/api/commands`);
    if (!r.ok) throw new Error(`listCommands ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async reloadTools(): Promise<{ ok: boolean; modules_reloaded: number; tools_registered: number }> {
    const r = await fetch(`${this.baseUrl}/api/tools/reload`, { method: 'POST' });
    if (!r.ok) throw new Error(`reloadTools ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  // ---------------------------------------------------------------------
  // Tasks (sub-projects 31-34)
  // ---------------------------------------------------------------------

  async listTasks(): Promise<{ tasks: TaskRecord[] }> {
    const r = await fetch(`${this.baseUrl}/api/tasks`);
    if (!r.ok) throw new Error(`listTasks ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async getTask(tid: string): Promise<TaskRecord> {
    const r = await fetch(`${this.baseUrl}/api/tasks/${encodeURIComponent(tid)}`);
    if (!r.ok) throw new Error(`getTask ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async startTask(body: TaskStartBody): Promise<TaskRecord> {
    const r = await fetch(`${this.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`startTask ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  async cancelTask(tid: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/tasks/${encodeURIComponent(tid)}/cancel`, {
      method: 'POST',
    });
    if (!r.ok) throw new Error(`cancelTask ${r.status}: ${await r.text()}`);
  }

  /**
   * SSE consumer for GET /api/tasks/{tid}/stream. Mirrors the
   * `stream()` parser (named events + JSON data lines + blank-line
   * terminator). Yields TaskStreamEvent and returns when a `done` or
   * `agent_error` is observed.
   */
  async *streamTask(
    tid: string,
    lastEventId?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<TaskStreamEvent> {
    const params = new URLSearchParams();
    if (lastEventId) params.set('last_event_id', lastEventId);
    const qs = params.toString();
    const url = `${this.baseUrl}/api/tasks/${encodeURIComponent(tid)}/stream${qs ? `?${qs}` : ''}`;
    const resp = await fetch(url, { signal });
    if (!resp.ok || !resp.body) throw new Error(`streamTask ${resp.status}`);
    yield* parseSseStream<TaskStreamEvent>(resp);
  }

  /**
   * SSE consumer for POST /api/complete/stream. Yields {type: 'chunk', text}
   * events as the model streams; ends on `done` or `error`.
   */
  async *streamCompletion(
    opts: CompletionStreamBody,
    signal?: AbortSignal,
  ): AsyncGenerator<CompletionStreamEvent> {
    const resp = await fetch(`${this.baseUrl}/api/complete/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
      signal,
    });
    if (!resp.ok || !resp.body) throw new Error(`streamCompletion ${resp.status}`);
    yield* parseSseStream<CompletionStreamEvent>(resp);
  }

  // ---------------------------------------------------------------------
  // RAG / memory (sub-projects 35-37)
  // ---------------------------------------------------------------------

  async indexWorkspace(
    workspace: string,
    force: boolean = false,
  ): Promise<{ collection: string; indexed_chunks: number; cached: boolean }> {
    const r = await fetch(`${this.baseUrl}/api/rag/index_workspace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace, force }),
    });
    if (!r.ok) throw new Error(`indexWorkspace ${r.status}: ${await r.text()}`);
    return await r.json();
  }

  /**
   * Force a workspace summarisation. Distinct from `autoSummarize` which
   * accepts the `force` flag through the same endpoint — kept for
   * symmetry with the dispatch's required surface.
   */
  async autoSummarizeWorkspace(
    workspace: string,
    force: boolean = false,
  ): Promise<{ summary: string; cached: boolean }> {
    return this.autoSummarize(workspace, force);
  }

  async *stream(sid: string, signal?: AbortSignal): AsyncGenerator<GodbotEvent> {
    const url = `${this.baseUrl}/api/chat/stream?session_id=${encodeURIComponent(sid)}`;
    const resp = await fetch(url, { signal });
    if (!resp.ok || !resp.body) {
      throw new Error(`stream ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    let eventName: string | null = null;
    let dataBuf: string[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl).replace(/\r$/, '');
          pending = pending.slice(nl + 1);
          if (line === '') {
            if (eventName && dataBuf.length) {
              const dataStr = dataBuf.join('\n');
              try {
                const payload = JSON.parse(dataStr);
                if (eventName !== 'ping') {
                  yield payload as GodbotEvent;
                  if ((payload as GodbotEvent).type === 'done') return;
                }
              } catch { /* drop */ }
            }
            eventName = null;
            dataBuf = [];
          } else if (line.startsWith(':')) {
            // SSE comment
          } else if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataBuf.push(line.slice(5).replace(/^ /, ''));
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
      try { await resp.body!.cancel(); } catch {}
    }
  }
}

/**
 * Shared SSE parser used by `streamTask` / `streamCompletion`. Mirrors
 * the inline parser in `GodbotClient.stream()` (named events, JSON data
 * lines, blank-line frame terminator) but stops as soon as a payload
 * with `type: 'done'` or `type: 'error'` is observed. Skips frames whose
 * event name is `ping` and silently drops malformed JSON.
 */
async function* parseSseStream<T extends { type: string }>(
  resp: Response,
): AsyncGenerator<T> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder('utf-8');
  let pending = '';
  let eventName: string | null = null;
  let dataBuf: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        if (line === '') {
          if (eventName && dataBuf.length) {
            const dataStr = dataBuf.join('\n');
            try {
              const payload = JSON.parse(dataStr) as T;
              if (eventName !== 'ping') {
                yield payload;
                if (payload.type === 'done' || payload.type === 'error') return;
              }
            } catch { /* drop malformed frame */ }
          }
          eventName = null;
          dataBuf = [];
        } else if (line.startsWith(':')) {
          // SSE comment
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataBuf.push(line.slice(5).replace(/^ /, ''));
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    try { await resp.body!.cancel(); } catch {}
  }
}
