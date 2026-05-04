import Editor from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { writeFileText } from '../api/tauri';
import { GodbotClient } from '../api/godbot';
import { DAEMON_URL } from '../api/config';
import { CloseIcon } from './Icons';

const MONACO_DARK = 'godbot-dark';
const MONACO_LIGHT = 'vs';  // Monaco's built-in light theme

// Match the daemon-side caps in /api/complete so we don't waste bytes the
// server will trim anyway.
const MAX_PREFIX_CHARS = 4000;
const MAX_SUFFIX_CHARS = 2000;
// Debounce the IDE→daemon round-trip; tuned to feel responsive without
// flooding the provider while the user is mid-keystroke.
const INLINE_DEBOUNCE_MS = 250;

const DARK_THEME_DEF = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#c9d1d9',
    'editorLineNumber.foreground': '#484f58',
    'editorLineNumber.activeForeground': '#8b949e',
    'editorCursor.foreground': '#79c0ff',
    'editor.selectionBackground': '#264f78',
    'editor.lineHighlightBackground': '#161b22',
  },
};

function languageFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: 'python',
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json', md: 'markdown',
    html: 'html', css: 'css',
    rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', c: 'c', h: 'cpp',
    sh: 'shell', toml: 'plaintext', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext ?? ''] ?? 'plaintext';
}

export function EditorPane() {
  const openFiles = useStore((s) => s.openFiles);
  const activePath = useStore((s) => s.activePath);
  const setActivePath = useStore((s) => s.setActivePath);
  const closeFile = useStore((s) => s.closeFile);
  const updateContent = useStore((s) => s.updateContent);
  const markClean = useStore((s) => s.markClean);
  const theme = useStore((s) => s.theme);

  // Banner shown once per session if the daemon answers 501 (provider
  // doesn't support inline completions). Auto-dismisses after 4s.
  const [unsupportedBanner, setUnsupportedBanner] = useState<string | null>(null);
  // Banner-already-shown flag prevents re-popping for every subsequent
  // unsupported response in the same session.
  const bannerShownRef = useRef(false);
  useEffect(() => {
    if (!unsupportedBanner) return;
    const t = window.setTimeout(() => setUnsupportedBanner(null), 4000);
    return () => window.clearTimeout(t);
  }, [unsupportedBanner]);
  // The active file path captured via ref so the onMount closure (which only
  // runs once) still reads fresh values when the user invokes a context-menu
  // action after switching tabs.
  const activeRef = useRef<{ path: string; name: string } | null>(null);
  // Track Monaco so we can flip its theme when the app theme changes
  // without remounting the editor (which would lose undo history).
  const monacoRef = useRef<any>(null);
  const monacoTheme = theme === 'light' ? MONACO_LIGHT : MONACO_DARK;

  // Apply Monaco theme on every theme change (idempotent).
  useEffect(() => {
    monacoRef.current?.editor.setTheme(monacoTheme);
  }, [monacoTheme]);

  function closeFileWithConfirm(path: string) {
    const file = openFiles.find((f) => f.path === path);
    if (file?.dirty && !window.confirm(`Discard unsaved changes in ${file.name}?`)) return;
    closeFile(path);
  }

  // Ctrl+S save, Ctrl+W close, Ctrl+Tab cycle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const active = openFiles.find((f) => f.path === activePath);
        if (active) {
          writeFileText(active.path, active.content)
            .then(() => {
              markClean(active.path);
              void useStore.getState().refreshTree();
            })
            .catch((err) => useStore.getState().appendMessage({
              id: crypto.randomUUID(), role: 'error',
              text: `Save failed (${active.name}): ${err?.message ?? err}`,
            }));
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activePath) closeFileWithConfirm(activePath);
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        if (openFiles.length > 1 && activePath) {
          const idx = openFiles.findIndex((f) => f.path === activePath);
          const next = openFiles[(idx + 1) % openFiles.length];
          useStore.getState().setActivePath(next.path);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFiles, activePath, markClean, closeFile]);

  if (openFiles.length === 0) {
    return (
      <div className="editor-empty">
        <h2>GodBot Studio</h2>
        <p style={{ color: 'var(--text-muted)' }}>Click a file in the sidebar, or ask the agent to scaffold one.</p>
        <ul style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.7, padding: 0, listStyle: 'none' }}>
          <li><kbd>Ctrl</kbd>+<kbd>S</kbd> save the active file</li>
          <li><kbd>Ctrl</kbd>+<kbd>W</kbd> close the active tab</li>
          <li><kbd>Ctrl</kbd>+<kbd>Tab</kbd> cycle tabs</li>
        </ul>
      </div>
    );
  }

  const active = openFiles.find((f) => f.path === activePath) ?? openFiles[0];
  // Keep the ref in sync so context-menu actions read the current tab.
  activeRef.current = { path: active.path, name: active.name };

  return (
    <>
      {unsupportedBanner && (
        <div className="inline-complete-banner" role="status">{unsupportedBanner}</div>
      )}
      <div className="editor-tabs">
        {openFiles.map((f) => (
          <div
            key={f.path}
            className={`editor-tab ${f.path === activePath ? 'active' : ''}`}
            onClick={() => setActivePath(f.path)}
          >
            <span className="dirty">{f.dirty ? <span className="dirty-dot" /> : null}</span>
            <span>{f.name}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeFileWithConfirm(f.path);
              }}
            >
              <CloseIcon size={12} />
            </span>
          </div>
        ))}
      </div>
      <div className="editor-host">
        <Editor
          path={active.path}
          defaultLanguage={languageFor(active.name)}
          value={active.content}
          theme={monacoTheme}
          onChange={(v) => updateContent(active.path, v ?? '')}
          beforeMount={(monacoApi) => {
            // Define our dark theme BEFORE the editor mounts so the first
            // paint already uses it (avoids the visible vs-dark flash).
            // The light path uses Monaco's built-in `vs` theme — no
            // definition needed.
            monacoApi.editor.defineTheme(MONACO_DARK, DARK_THEME_DEF);
          }}
          onMount={(editor, monacoApi) => {
            monacoRef.current = monacoApi;
            monacoApi.editor.setTheme(monacoTheme);
            registerContextMenuActions(editor, monacoApi, activeRef);
            registerInlineCompletions(monacoApi, () => {
              if (bannerShownRef.current) return;
              bannerShownRef.current = true;
              setUnsupportedBanner(
                'Inline completions disabled for this provider (Anthropic/Gemini not yet supported).',
              );
            });
          }}
          options={{
            fontSize: 13,
            fontFamily: 'JetBrains Mono, Cascadia Code, Consolas, monospace',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </>
  );
}

/**
 * Register four context-menu entries under group "godbot" — one for each
 * selection-driven action. Templates are injected into the chat composer
 * (Ask) or sent immediately (Refactor / Document / Tests) via the
 * `sendChatMessage` callback ChatPanel registered in the store.
 *
 * Bonus keybinding: Ctrl+Alt+G triggers Ask About Selection.
 */
function registerContextMenuActions(
  editor: any,
  monacoApi: any,
  activeRef: React.MutableRefObject<{ path: string; name: string } | null>,
) {
  function getSelectionContext(): { selection: string; relPath: string; range: string } | null {
    const sel = editor.getSelection();
    const model = editor.getModel();
    if (!sel || !model) return null;
    const text = model.getValueInRange(sel);
    if (!text.trim()) return null;
    const workspace = useStore.getState().workspace ?? '';
    const fullPath = activeRef.current?.path ?? '';
    let relPath = fullPath;
    if (workspace && fullPath.startsWith(workspace)) {
      relPath = fullPath.slice(workspace.length).replace(/^[\\/]/, '');
    }
    const range = sel.startLineNumber === sel.endLineNumber
      ? `L${sel.startLineNumber}`
      : `L${sel.startLineNumber}-L${sel.endLineNumber}`;
    return { selection: text, relPath, range };
  }

  function dispatch(template: string) {
    const ctx = getSelectionContext();
    if (!ctx) return;
    const fenced = '```\n' + ctx.selection + '\n```';
    const message = template
      .replace('{path}', ctx.relPath || '(unsaved)')
      .replace('{range}', ctx.range)
      .replace('{code}', fenced);
    const sender = useStore.getState().sendChatMessage;
    if (sender) sender(message);
  }

  editor.addAction({
    id: 'godbot.askAboutSelection',
    label: 'GodBot: Ask about this',
    contextMenuGroupId: 'godbot',
    contextMenuOrder: 1,
    keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyG],
    run: () => {
      const ctx = getSelectionContext();
      if (!ctx) return;
      const message = `In ${ctx.relPath || '(unsaved)'} ${ctx.range}\n\`\`\`\n${ctx.selection}\n\`\`\`\n\nQuestion: `;
      const sender = useStore.getState().sendChatMessage;
      if (sender) sender(message);
    },
  });

  editor.addAction({
    id: 'godbot.refactorSelection',
    label: 'GodBot: Refactor this',
    contextMenuGroupId: 'godbot',
    contextMenuOrder: 2,
    run: () => dispatch('Refactor this code from {path} {range} to be cleaner. Keep behaviour identical:\n{code}'),
  });

  editor.addAction({
    id: 'godbot.documentSelection',
    label: 'GodBot: Document this',
    contextMenuGroupId: 'godbot',
    contextMenuOrder: 3,
    run: () => dispatch('Add a doc comment to this code from {path} {range} in the appropriate style for the language:\n{code}'),
  });

  editor.addAction({
    id: 'godbot.testsForSelection',
    label: 'GodBot: Tests for this',
    contextMenuGroupId: 'godbot',
    contextMenuOrder: 4,
    run: () => dispatch('Write tests for this code from {path} {range}. Save them to an appropriate test file:\n{code}'),
  });
}

/**
 * Register a Monaco InlineCompletionsProvider that asks the GodBot daemon
 * for ghost-text suggestions. Cancels in-flight requests on each new
 * keystroke (250ms debounced) so we never display stale completions.
 *
 * `onUnsupported` is invoked the first time the daemon answers HTTP 501;
 * the store flag is also flipped so subsequent requests short-circuit.
 */
function registerInlineCompletions(monacoApi: any, onUnsupported: () => void) {
  // Module-level singletons keyed off the `monacoApi` namespace to survive
  // editor remounts (Monaco's registerInlineCompletionsProvider is
  // process-global; double-registering would fire two requests per keystroke).
  const reg = (monacoApi as any).__godbotInlineRegistered;
  if (reg) return;
  (monacoApi as any).__godbotInlineRegistered = true;

  const client = new GodbotClient(DAEMON_URL);
  let debounceTimer: number | null = null;
  let inflight: AbortController | null = null;

  monacoApi.languages.registerInlineCompletionsProvider('*', {
    async provideInlineCompletions(model: any, position: any, _ctx: any, token: any) {
      const state = useStore.getState();
      if (!state.inlineCompletionsEnabled) return { items: [] };
      if (state.inlineCompletionsUnsupported) return { items: [] };

      // Skip empty-line / column-1 starts so we don't ping the daemon
      // for obviously-unhelpful contexts.
      const lineContent = model.getLineContent(position.lineNumber);
      if (position.column === 1 && lineContent.trim() === '') return { items: [] };

      // Build prefix (start → cursor) and suffix (cursor → end) using
      // Monaco's Range API so we get proper line-ending normalization.
      const fullRange = model.getFullModelRange();
      const prefixRange = {
        startLineNumber: fullRange.startLineNumber,
        startColumn: fullRange.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      const suffixRange = {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: fullRange.endLineNumber,
        endColumn: fullRange.endColumn,
      };
      let prefix: string = model.getValueInRange(prefixRange);
      let suffix: string = model.getValueInRange(suffixRange);
      if (!prefix) return { items: [] };
      if (prefix.length > MAX_PREFIX_CHARS) prefix = prefix.slice(-MAX_PREFIX_CHARS);
      if (suffix.length > MAX_SUFFIX_CHARS) suffix = suffix.slice(0, MAX_SUFFIX_CHARS);
      const language: string = model.getLanguageId();

      // Cancel any prior in-flight request + pending debounce — Monaco
      // may call us many times per second.
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (inflight) {
        inflight.abort();
        inflight = null;
      }

      // Wire Monaco's CancellationToken into the same AbortController so
      // a tab-switch / esc-press kills the fetch immediately.
      const ctrl = new AbortController();
      inflight = ctrl;
      const tokenSub = token.onCancellationRequested?.(() => ctrl.abort());

      const debounced = new Promise<void>((resolve) => {
        debounceTimer = window.setTimeout(() => {
          debounceTimer = null;
          resolve();
        }, INLINE_DEBOUNCE_MS);
      });

      try {
        await debounced;
        if (ctrl.signal.aborted) return { items: [] };
        const r = await client.inlineComplete({ prefix, suffix, language, signal: ctrl.signal });
        if (!r.supported) {
          useStore.getState().setInlineCompletionsUnsupported(true);
          onUnsupported();
          return { items: [] };
        }
        if (!r.completion) return { items: [] };
        return {
          items: [{
            insertText: r.completion,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          }],
        };
      } catch (e: any) {
        if (e?.name === 'AbortError') return { items: [] };
        // Transient — log + skip; the toggle stays on so the next keystroke
        // can recover.
        console.warn('inlineComplete failed:', e?.message ?? e);
        return { items: [] };
      } finally {
        if (inflight === ctrl) inflight = null;
        try { tokenSub?.dispose?.(); } catch { /* ignore */ }
      }
    },
    freeInlineCompletions() {
      // No per-result resources to release; Monaco invokes this when
      // dismissing the suggestion overlay.
    },
  });
}
