import { useEffect, useMemo, useRef, useState } from 'react';
import { GodbotClient, GodbotEvent } from '../api/godbot';
import { useStore } from '../state/store';
import { ToolCallCard } from './ToolCallCard';
import { GateCard } from './GateCard';
import { DiffApprovalCard } from './DiffApprovalCard';
import { ThinkingPulse } from './ThinkingPulse';
import { ThinkingBlock } from './ThinkingBlock';
import { MentionPopup } from './MentionPopup';
import { DAEMON_URL } from '../api/config';
import { StopIcon } from './Icons';
import { parseStreaming } from '../api/react-stream';
import { walkWorkspace, type WalkEntry } from '../api/tauri';

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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const activeAssistantIdRef = useRef<string | null>(null);
  const tokenBufferRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);

  // @-mention picker state. `mentionStart` is the index of the `@` in
  // `input`; `mentionQuery` is everything between that `@` and the
  // caret (so the popup re-ranks as the user keeps typing). `null` =
  // popup closed. Files are walked once per workspace and cached.
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionAnchor, setMentionAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [workspaceFiles, setWorkspaceFiles] = useState<WalkEntry[]>([]);
  const lastWalkedWorkspace = useRef<string | null>(null);

  // Walk the workspace once per workspace, cache the result. Re-walks on
  // workspace change. The walk itself is a single Tauri call and is
  // capped at 5000 files server-side; for typical projects it's well
  // under 10ms and runs on a background thread inside Rust.
  useEffect(() => {
    if (!workspace) {
      setWorkspaceFiles([]);
      lastWalkedWorkspace.current = null;
      return;
    }
    if (lastWalkedWorkspace.current === workspace) return;
    let cancel = false;
    (async () => {
      try {
        const files = await walkWorkspace(workspace);
        if (!cancel) {
          setWorkspaceFiles(files);
          lastWalkedWorkspace.current = workspace;
        }
      } catch (e) {
        console.warn('walkWorkspace failed', e);
      }
    })();
    return () => { cancel = true; };
  }, [workspace]);

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

  async function sendText(text: string) {
    if (!text.trim() || !sessionId || streaming) return;
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

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMentionStart(null);
    setMentionQuery('');
    // Detect @-mentions and auto-prepend a read-first instruction. We
    // strip surrounding punctuation that a user might have typed after
    // the popup auto-inserted "@path " — the popup itself emits a
    // trailing space, so the captured token shouldn't contain spaces.
    const mentions = Array.from(text.matchAll(/(?:^|\s)@([^\s)\],]+)/g)).map((m) => m[1]);
    const finalText = mentions.length
      ? `(file context: read ${mentions.map((m) => m).join(', ')} first)\n\n${text}`
      : text;
    await sendText(finalText);
  }

  // Register a `sendChatMessage` callback in the store so the editor's
  // context-menu actions can route messages into chat. The callback either
  // sends immediately (templates that don't need user input — Refactor,
  // Document, Tests) or pre-fills the composer (Ask About — needs the user
  // to add their question).
  // We use a ref to capture the latest sessionId/streaming via closure of sendText.
  const sendTextRef = useRef(sendText);
  sendTextRef.current = sendText;
  useEffect(() => {
    const setFn = useStore.getState().setSendChatMessage;
    setFn((text: string) => {
      // If text ends with "Question: " (Ask About), pre-fill composer + focus.
      // Otherwise send immediately.
      if (/Question:\s*$/.test(text)) {
        setInput((prev) => (prev ? prev + '\n\n' + text : text));
        setTimeout(() => {
          const ta = document.querySelector('.chat-composer textarea') as HTMLTextAreaElement | null;
          ta?.focus();
          // Move caret to the end so the user types after "Question: ".
          if (ta) {
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
        }, 0);
      } else {
        void sendTextRef.current(text);
      }
    });
    return () => {
      useStore.getState().setSendChatMessage(null);
    };
  }, []);

  function handleEvent(ev: GodbotEvent) {
    if (ev.type === 'token') {
      tokenBufferRef.current += ev.text;
      if (activeAssistantIdRef.current) {
        const parsed = parseStreaming(tokenBufferRef.current);
        // While streaming: text = whatever's parseable as final_answer (often '').
        // The thought is shown via ThinkingPulse/ThinkingBlock in the renderer.
        updateMessage(activeAssistantIdRef.current, {
          text: parsed.finalAnswer,
          thought: parsed.thought,
          rawStream: tokenBufferRef.current,
        });
      }
    } else if (ev.type === 'tool_call') {
      // Snapshot the streamed thought onto the active assistant bubble before
      // we move on to the tool-call card. The bubble stays in the conversation
      // as a collapsible "Thinking" record above the tool call.
      if (activeAssistantIdRef.current) {
        const parsed = parseStreaming(tokenBufferRef.current);
        updateMessage(activeAssistantIdRef.current, {
          text: parsed.finalAnswer,
          thought: parsed.thought,
          rawStream: tokenBufferRef.current,
        });
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
      const fs_diff = (ev as GodbotEvent & { fs_diff?: { path: string; before: string | null; after: string } }).fs_diff;
      appendMessage({
        id: ev.id, role: 'gate', text: '',
        toolName: ev.name, toolArgs: ev.args,
        fsDiff: fs_diff ?? undefined,
      });
    } else if (ev.type === 'agent_error') {
      appendMessage({ id: crypto.randomUUID(), role: 'error', text: ev.message });
    } else if (ev.type === 'done') {
      if (activeAssistantIdRef.current) {
        const parsed = parseStreaming(tokenBufferRef.current);
        // If JSON.parse never succeeded (parsed.done === false) AND we have
        // no parseable final_answer, fall back to the raw stream so the user
        // at least sees what the model said.
        const text = parsed.finalAnswer || (parsed.done ? '' : tokenBufferRef.current);
        const rawFallback = !parsed.done && !parsed.finalAnswer && tokenBufferRef.current.length > 0;
        updateMessage(activeAssistantIdRef.current, {
          text: text || '(empty reply)',
          thought: parsed.thought,
          rawStream: tokenBufferRef.current,
          rawFallback,
          pending: false,
        });
      }
    }
  }

  // Sync mention state from the textarea after every input change. Looks
  // backward from the caret for an unbroken run of non-whitespace ending
  // at an `@`; that prefix becomes the new query. Closing the popup is
  // handled by Esc, by typing whitespace into the query, or by
  // backspacing past the `@`.
  function syncMentionFromCaret(value: string, caret: number) {
    if (!workspace) { setMentionStart(null); return; }
    // Walk backward from caret until we hit whitespace or `@`.
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(value[i]) && value[i] !== '@') i--;
    if (i >= 0 && value[i] === '@') {
      const afterAt = value.slice(i + 1, caret);
      // No spaces inside the mention query.
      if (!/\s/.test(afterAt)) {
        setMentionStart(i);
        setMentionQuery(afterAt);
        // Anchor the popup at the textarea's top-left (good enough — the
        // composer is small). Could be made smarter later.
        const ta = composerRef.current;
        if (ta) {
          const r = ta.getBoundingClientRect();
          setMentionAnchor({ left: r.left + 8, top: r.top - 4 });
        }
        return;
      }
    }
    setMentionStart(null);
    setMentionQuery('');
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setInput(value);
    syncMentionFromCaret(value, e.target.selectionStart);
  }

  function pickMention(rel: string) {
    if (mentionStart === null) return;
    const before = input.slice(0, mentionStart);
    const ta = composerRef.current;
    const caret = ta?.selectionStart ?? input.length;
    const after = input.slice(caret);
    // Insert the relative path verbatim where the @-fragment was, plus a
    // trailing space so the user can keep typing.
    const inserted = `@${rel} `;
    const next = before + inserted + after;
    setInput(next);
    setMentionStart(null);
    setMentionQuery('');
    // Restore focus + place caret after the inserted path.
    setTimeout(() => {
      const t = composerRef.current;
      if (t) {
        const pos = before.length + inserted.length;
        t.focus();
        t.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // While the mention popup is open, intercept navigation keys and
    // forward them as a custom event. Lets the popup own selection
    // logic without stealing focus from the textarea.
    if (mentionStart !== null) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mention-popup-key', { detail: 'down' }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mention-popup-key', { detail: 'up' }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('mention-popup-key', { detail: 'enter' }));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionStart(null);
        setMentionQuery('');
        return;
      }
    }
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
            const isActive = m.id === activeAssistantIdRef.current && streaming;
            const hasAnswer = !!m.text;
            // Still thinking: no final_answer yet, and either we're actively
            // streaming this bubble OR the agent is mid-turn (e.g. between tool
            // calls). Show pulse + collapsible thought.
            if (!hasAnswer && isActive) {
              return (
                <div key={m.id}>
                  {m.thought && <ThinkingBlock text={m.thought} />}
                  <ThinkingPulse text={m.thought ?? ''} />
                </div>
              );
            }
            // Finished and empty: this bubble was a between-tool-calls scratch
            // bubble that never got a final_answer. Drop it from the UI but keep
            // the thought block if any (preserves the chain-of-thought trace).
            if (!hasAnswer && !streaming && !m.thought) return null;
            return (
              <div key={m.id}>
                {m.thought && <ThinkingBlock text={m.thought} />}
                {hasAnswer && (
                  <div className={`chat-bubble-assistant${m.rawFallback ? ' raw-fallback' : ''}`}>
                    {m.text}
                  </div>
                )}
              </div>
            );
          }
          if (m.role === 'tool_call') {
            return (
              <ToolCallCard key={m.id} name={m.toolName!} args={m.toolArgs!}
                result={m.toolResult} durationMs={m.duration} blob={m.blob} />
            );
          }
          if (m.role === 'gate') {
            // FS-write gates with a fs_diff payload render the inline diff
            // card. Everything else (run_powershell, etc.) falls through to
            // the standard gate card.
            if (m.fsDiff) {
              return (
                <DiffApprovalCard
                  key={m.id} callId={m.id} name={m.toolName!}
                  fsDiff={m.fsDiff} sessionId={sessionId!} client={client}
                  resolved={m.resolved}
                  onResolved={(decision) => updateMessage(m.id, { resolved: decision })}
                />
              );
            }
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
          ref={composerRef}
          value={input}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => {
            // Close the popup on blur, but keep the lid open if focus is
            // moving INTO the popup itself (handled by its onMouseDown
            // preventing focus loss). 100ms delay so the click handler
            // can land before we tear it down.
            setTimeout(() => {
              if (document.activeElement !== composerRef.current) {
                setMentionStart(null);
                setMentionQuery('');
              }
            }, 100);
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        {mentionStart !== null && (
          <MentionPopup
            files={workspaceFiles}
            query={mentionQuery}
            anchor={mentionAnchor}
            onPick={pickMention}
            onCancel={() => { setMentionStart(null); setMentionQuery(''); }}
          />
        )}
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
          {streaming ? <StopIcon /> : 'Send'}
        </button>
      </div>
    </div>
  );
}
