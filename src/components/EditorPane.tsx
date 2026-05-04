import Editor, { useMonaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { writeFileText } from '../api/tauri';
import { CloseIcon } from './Icons';

const MONACO_THEME = 'godbot-dark';

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
  const monaco = useMonaco();
  const openFiles = useStore((s) => s.openFiles);
  const activePath = useStore((s) => s.activePath);
  const setActivePath = useStore((s) => s.setActivePath);
  const closeFile = useStore((s) => s.closeFile);
  const updateContent = useStore((s) => s.updateContent);
  const markClean = useStore((s) => s.markClean);

  function closeFileWithConfirm(path: string) {
    const file = openFiles.find((f) => f.path === path);
    if (file?.dirty && !window.confirm(`Discard unsaved changes in ${file.name}?`)) return;
    closeFile(path);
  }

  // Define our custom theme on Monaco load
  useEffect(() => {
    if (!monaco) return;
    monaco.editor.defineTheme(MONACO_THEME, {
      base: 'vs-dark',
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
    });
    monaco.editor.setTheme(MONACO_THEME);
  }, [monaco]);

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

  return (
    <>
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
          theme={MONACO_THEME}
          onChange={(v) => updateContent(active.path, v ?? '')}
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
