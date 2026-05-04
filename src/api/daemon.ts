import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../state/store';
import { PYTHON_PATH, DAEMON_PORT } from './config';

export async function spawnDaemon(workspacePath: string): Promise<void> {
  useStore.getState().setDaemonStatus('spawning');
  try {
    await invoke('spawn_daemon', {
      pythonPath: PYTHON_PATH,
      sessionsRoot: `${workspacePath}/.godbot-sessions`,
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
