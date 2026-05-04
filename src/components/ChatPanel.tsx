import { useEffect, useMemo, useRef, useState } from 'react';
import { GodbotClient, GodbotEvent } from '../api/godbot';
import { useStore } from '../state/store';
import { ToolCallCard } from './ToolCallCard';
import { GateCard } from './GateCard';
import { DAEMON_URL } from '../api/config';

function tryExtractFinalAnswer(raw: string): string {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && typeof p.final_answer === 'string') {
      return p.final_answer;
    }
  } catch { /* fall through */ }
  return raw;
}

export function ChatPanel() {
  const client = useMemo(() => new GodbotClient(DAEMON_URL), []);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const setDaemonHealth = useStore((s) => s.setDaemonHealth);
  const workspace = useStore((s) => s.workspace);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const daemonStatus = useStore((s) => s.daemonStatus);
  const conversationRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const activeAssistantIdRef = useRef<string | null>(null);
  const tokenBufferRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // Health probe loop.
  useEffect(() => {
    let cancel = false;
    async function probe() {
      const ok = await client.health();
      if (!cancel) setDaemonHealth(ok);
    }
    const id = setInterval(probe, 5000);
    probe();
    return () => { cancel = true; clearInterval(id); };
  }, [client, setDaemonHealth]);

  // Create a session when workspace is set AND daemon is healthy. Retry on either change.
  useEffect(() => {
    if (sessionId || !workspace || !daemonHealthy) return;
    let cancel = false;
    (async () => {
      try {
        const sid = await client.newSession(workspace, true);
        if (cancel) return;
        setSessionId(sid);
        const info = await client.getSession(sid);
        if (info?.model && !cancel) useStore.getState().setModel(info.model);
      } catch (e: any) {
        // Surface to chat as an error message; the user has no other recovery path.
        useStore.getState().appendMessage({
          id: crypto.randomUUID(),
          role: 'error',
          text: `Couldn't start session: ${e?.message ?? e}`,
        });
      }
    })();
    return () => { cancel = true; };
  }, [client, workspace, sessionId, daemonHealthy, setSessionId]);

  // Auto-scroll on new message.
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Ctrl+L global shortcut: focus chat composer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const ta = document.querySelector('.chat-composer textarea') as HTMLTextAreaElement | null;
        ta?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || !sessionId || streaming) return;
    setInput('');
    appendMessage({ id: crypto.randomUUID(), role: 'user', text });
    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', text: '', pending: true });
    activeAssistantIdRef.current = assistantId;
    tokenBufferRef.current = '';
    setStreaming(true);
    abortRef.current = new AbortController();
    try {
      await client.send(sessionId, text);
      for await (const ev of client.stream(sessionId, abortRef.current.signal)) {
        handleEvent(ev);
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        appendMessage({ id: crypto.randomUUID(), role: 'error', text: String(e?.message ?? e) });
      }
    } finally {
      setStreaming(false);
      activeAssistantIdRef.current = null;
      abortRef.current = null;
    }
  }

  function handleEvent(ev: GodbotEvent) {
    if (ev.type === 'token') {
      tokenBufferRef.current += ev.text;
      if (activeAssistantIdRef.current) {
        updateMessage(activeAssistantIdRef.current, { text: tokenBufferRef.current });
      }
    } else if (ev.type === 'tool_call') {
      if (activeAssistantIdRef.current) {
        updateMessage(activeAssistantIdRef.current, { text: tokenBufferRef.current || '' });
      }
      appendMessage({
        id: ev.id, role: 'tool_call', text: '',
        toolName: ev.name, toolArgs: ev.args,
      });
      // Reset buffer for next assistant chunk.
      tokenBufferRef.current = '';
      const newAssistantId = crypto.randomUUID();
      appendMessage({ id: newAssistantId, role: 'assistant', text: '' });
      activeAssistantIdRef.current = newAssistantId;
    } else if (ev.type === 'tool_result') {
      updateMessage(ev.id, {
        toolResult: ev.preview,
        duration: ev.duration_ms,
        blob: ev.blob,
      });
    } else if (ev.type === 'gate') {
      appendMessage({
        id: ev.id, role: 'gate', text: '',
        toolName: ev.name, toolArgs: ev.args,
      });
    } else if (ev.type === 'agent_error') {
      appendMessage({ id: crypto.randomUUID(), role: 'error', text: ev.message });
    } else if (ev.type === 'done') {
      // Try to parse the buffered text as JSON ReAct and unwrap final_answer.
      const finalText = tryExtractFinalAnswer(tokenBufferRef.current);
      if (activeAssistantIdRef.current) {
        updateMessage(activeAssistantIdRef.current, { text: finalText || '(empty reply)' });
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const placeholder = !workspace
    ? "Open a folder first."
    : daemonStatus === 'spawning'
      ? "Starting daemon…"
      : !daemonHealthy
        ? "Daemon offline — check the status bar."
        : !sessionId
          ? "Starting session…"
          : streaming
            ? "Streaming… (use Stop to cancel)"
            : "type a message...";
  const disabled = !sessionId || streaming;

  return (
    <div className="chat-panel">
      <div className="chat-conversation" ref={conversationRef}>
        {messages.map((m) => {
          if (m.role === 'user') {
            return <div key={m.id} className="chat-bubble-user">{m.text}</div>;
          }
          if (m.role === 'assistant') {
            if (!m.text && !streaming) return null;
            return <div key={m.id} className="chat-bubble-assistant">{m.text || '⏳'}</div>;
          }
          if (m.role === 'tool_call') {
            return (
              <ToolCallCard key={m.id} name={m.toolName!} args={m.toolArgs!}
                result={m.toolResult} durationMs={m.duration} blob={m.blob} />
            );
          }
          if (m.role === 'gate') {
            return (
              <GateCard
                key={m.id} callId={m.id} name={m.toolName!} args={m.toolArgs!}
                sessionId={sessionId!} client={client}
                resolved={m.resolved}
                onResolved={(decision) => updateMessage(m.id, { resolved: decision })}
              />
            );
          }
          if (m.role === 'error') {
            return <div key={m.id} className="chat-error">{m.text}</div>;
          }
          return null;
        })}
      </div>
      <div className="chat-composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          onClick={() => {
            if (streaming) {
              abortRef.current?.abort();
              if (sessionId) client.stop(sessionId).catch(console.error);
            } else {
              send();
            }
          }}
          disabled={!sessionId && !streaming}
          title={streaming ? 'Stop streaming' : 'Send'}
        >
          {streaming ? '⏹' : 'Send'}
        </button>
      </div>
    </div>
  );
}
