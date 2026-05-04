import { invoke } from '@tauri-apps/api/core';
import { pickWorkspace, listDir } from '../api/tauri';
import { useStore } from '../state/store';
import { DAEMON_PORT, PYTHON_PATH } from '../api/config';

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

export async function spawnDaemon(path: string) {
  useStore.getState().setDaemonStatus('spawning');
  try {
    await invoke('spawn_daemon', {
      pythonPath: PYTHON_PATH,
      sessionsRoot: `${path}/.godbot-sessions`,
      port: DAEMON_PORT,
    });
    useStore.getState().setDaemonStatus('ready');
  } catch (e: any) {
    useStore.getState().setDaemonStatus('error', String(e?.message ?? e));
    useStore.getState().appendMessage({
      id: crypto.randomUUID(),
      role: 'error',
      text: `Daemon spawn failed: ${e?.message ?? e}`,
    });
  }
}
