import { invoke } from '@tauri-apps/api/core';
import { pickWorkspace, listDir } from '../api/tauri';
import { useStore } from '../state/store';

export function WorkspacePicker() {
  const setWorkspace = useStore((s) => s.setWorkspace);
  const setFileTree = useStore((s) => s.setFileTree);

  async function onPick() {
    const path = await pickWorkspace();
    if (!path) return;
    setWorkspace(path);
    const tree = await listDir(path);
    setFileTree(tree);
    // Spawn the daemon (best-effort; chat panel will probe and recover).
    try {
      await invoke('spawn_daemon', {
        pythonPath: 'C:/GodBot/.venv/Scripts/python.exe',
        sessionsRoot: `${path}/.godbot-sessions`,
        port: 7879,
      });
    } catch (e) {
      console.error('daemon spawn failed:', e);
    }
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
