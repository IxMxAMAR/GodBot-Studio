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
