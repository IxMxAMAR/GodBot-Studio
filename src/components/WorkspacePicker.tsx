import { pickWorkspace, listDir } from '../api/tauri';
import { useStore } from '../state/store';
import { spawnDaemon } from '../api/daemon';

export function WorkspacePicker() {
  const setWorkspace = useStore((s) => s.setWorkspace);
  const setFileTree = useStore((s) => s.setFileTree);

  async function onPick() {
    const path = await pickWorkspace();
    if (!path) return;
    setWorkspace(path);
    const tree = await listDir(path);
    setFileTree(tree);
    await spawnDaemon(path);
  }

  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
      <p>No folder open.</p>
      <button
        onClick={onPick}
        style={{
          background: 'var(--accent)',
          color: 'var(--bg)',
          padding: '6px 16px',
          borderRadius: 4,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Open Folder...
      </button>
    </div>
  );
}
