export interface TokenEvent { type: 'token'; text: string; }
export interface ToolCallEvent { type: 'tool_call'; id: string; name: string; args: Record<string, unknown>; }
export interface ToolResultEvent { type: 'tool_result'; id: string; preview: string; blob: string | null; duration_ms: number; }
export interface GateEvent { type: 'gate'; id: string; name: string; args: Record<string, unknown>; }
export interface AgentErrorEvent { type: 'agent_error'; message: string; recoverable: boolean; }
export interface DoneEvent { type: 'done'; step_count: number; }
export type GodbotEvent = TokenEvent | ToolCallEvent | ToolResultEvent | GateEvent | AgentErrorEvent | DoneEvent;

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

  async getSession(sid: string): Promise<{ model?: string } | null> {
    try {
      const r = await fetch(`${this.baseUrl}/api/sessions/${sid}`);
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  }

  async newSession(workspace?: string, autoApprove = true): Promise<string> {
    const body: Record<string, unknown> = { model: 'auto' };
    if (workspace) body.workspace = workspace;
    if (autoApprove) body.auto_approve_in_sandbox = true;
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

  async resolveGate(sid: string, callId: string, decision: 'allow' | 'deny' | 'always'): Promise<void> {
    const r = await fetch(`${this.baseUrl}/api/gate/${callId}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sid, decision }),
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
