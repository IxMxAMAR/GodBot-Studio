import { useEffect, useMemo, useRef, useState } from 'react';
import { GodbotClient, GodbotEvent } from '../api/godbot';
import { useStore } from '../state/store';
import { ToolCallCard } from './ToolCallCard';
import { GateCard } from './GateCard';

const DAEMON_PORT = 7879;

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
  const client = useMemo(() => new GodbotClient(`http://127.0.0.1:${DAEMON_PORT}`), []);
  const sessionId = useStore((s) => s.sessionId);
  const setSessionId = useStore((s) => s.setSessionId);
  const messages = useStore((s) => s.messages);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const setDaemonHealth = useStore((s) => s.setDaemonHealth);
  const workspace = useStore((s) => s.workspace);
  const conversationRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [, setPendingAssistantId] = useState<string | null>(null);
  const tokenBufferRef = useRef<string>('');

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

  // Create a session when workspace is set.
  useEffect(() => {
    if (sessionId || !workspace) return;
    let cancel = false;
    (async () => {
      try {
        if (await client.health()) {
          const sid = await client.newSession(workspace, true);
          if (!cancel) setSessionId(sid);
        }
      } catch (e) {
        console.error('newSession failed', e);
      }
    })();
    return () => { cancel = true; };
  }, [client, workspace, sessionId, setSessionId]);

  // Auto-scroll on new message.
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || !sessionId || streaming) return;
    setInput('');
    appendMessage({ id: crypto.randomUUID(), role: 'user', text });
    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', text: '⏳ thinking…' });
    setPendingAssistantId(assistantId);
    tokenBufferRef.current = '';
    setStreaming(true);
    try {
      await client.send(sessionId, text);
      for await (const ev of client.stream(sessionId)) {
        handleEvent(ev, assistantId);
      }
    } catch (e: any) {
      appendMessage({ id: crypto.randomUUID(), role: 'error', text: String(e?.message ?? e) });
    } finally {
      setStreaming(false);
      setPendingAssistantId(null);
    }
  }

  function handleEvent(ev: GodbotEvent, assistantId: string) {
    if (ev.type === 'token') {
      tokenBufferRef.current += ev.text;
      updateMessage(assistantId, { text: tokenBufferRef.current });
    } else if (ev.type === 'tool_call') {
      updateMessage(assistantId, { text: tokenBufferRef.current || '' });
      appendMessage({
        id: ev.id, role: 'tool_call', text: '',
        toolName: ev.name, toolArgs: ev.args,
      });
      // Reset buffer for next assistant chunk.
      tokenBufferRef.current = '';
      const newAssistantId = crypto.randomUUID();
      appendMessage({ id: newAssistantId, role: 'assistant', text: '' });
      setPendingAssistantId(newAssistantId);
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
      const lastAssistantId = useStore.getState().messages
        .filter((m) => m.role === 'assistant').slice(-1)[0]?.id;
      if (lastAssistantId) {
        updateMessage(lastAssistantId, { text: finalText || '(empty reply)' });
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-conversation" ref={conversationRef}>
        {messages.map((m) => {
          if (m.role === 'user') {
            return <div key={m.id} className="chat-bubble-user">{m.text}</div>;
          }
          if (m.role === 'assistant') {
            return <div key={m.id} className="chat-bubble-assistant">{m.text}</div>;
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
                onResolved={() => updateMessage(m.id, { text: '(resolved)' })}
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
          placeholder={sessionId ? "type a message..." : "Open a folder first."}
          disabled={!sessionId || streaming}
        />
        <button onClick={send} disabled={!sessionId || streaming}>
          {streaming ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
