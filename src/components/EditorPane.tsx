import Editor, { useMonaco } from '@monaco-editor/react';
import { useEffect } from 'react';
import { useStore } from '../state/store';
import { writeFileText } from '../api/tauri';

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

  // Ctrl+S handler
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const active = openFiles.find((f) => f.path === activePath);
        if (active) {
          writeFileText(active.path, active.content)
            .then(() => markClean(active.path))
            .catch(console.error);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFiles, activePath, markClean]);

  if (openFiles.length === 0) {
    return <div className="editor-empty">Open a file from the sidebar to begin.</div>;
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
            <span className={f.dirty ? 'dirty' : ''}>{f.dirty ? '●' : ''}</span>
            <span>{f.name}</span>
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.path);
              }}
            >
              ×
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
