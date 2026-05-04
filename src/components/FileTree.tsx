import { useState } from 'react';
import { listDir, readFileText } from '../api/tauri';
import { useStore } from '../state/store';
import type { FileEntry } from '../state/types';

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tif', 'tiff',
  'mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'flac',
  'zip', 'tar', 'gz', '7z', 'rar', 'exe', 'dll', 'so', 'dylib',
  'pdf', 'sqlite', 'db', 'bin', 'pyc',
]);

function isLikelyBinary(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTS.has(ext);
}

interface NodeProps {
  entry: FileEntry;
  depth: number;
}

function TreeNode({ entry, depth }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const openFile = useStore((s) => s.openFile);

  async function onClick() {
    if (entry.isDir) {
      if (!children && !expanded) {
        const c = await listDir(entry.path);
        setChildren(c);
      }
      setExpanded(!expanded);
    } else {
      if (isLikelyBinary(entry.name)) {
        // Surface as a chat-side hint instead of silent no-op.
        useStore.getState().appendMessage({
          id: crypto.randomUUID(),
          role: 'error',
          text: `Binary file ${entry.name} — not opening in editor. Ask the agent to inspect it via tools.`,
        });
        return;
      }
      try {
        const content = await readFileText(entry.path);
        openFile({
          path: entry.path,
          name: entry.name,
          content,
          originalContent: content,
          dirty: false,
        });
      } catch (e: any) {
        useStore.getState().appendMessage({
          id: crypto.randomUUID(),
          role: 'error',
          text: `Couldn't open ${entry.name}: ${e?.message ?? e}`,
        });
      }
    }
  }

  const icon = entry.isDir ? (expanded ? '▾' : '▸') : ' ';
  return (
    <div>
      <div
        onClick={onClick}
        style={{
          paddingLeft: `${depth * 12 + 6}px`,
          paddingRight: 8,
          paddingTop: 2,
          paddingBottom: 2,
          cursor: 'pointer',
          fontSize: 12,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          color: entry.isDir ? 'var(--text)' : 'var(--text-muted)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ width: 10, color: 'var(--text-muted)' }}>{icon}</span>
        <span>{entry.name}</span>
      </div>
      {expanded && children && (
        <div>
          {children.map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const fileTree = useStore((s) => s.fileTree);
  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      {fileTree.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} />
      ))}
    </div>
  );
}
