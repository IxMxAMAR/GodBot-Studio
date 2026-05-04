import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { FileEntry } from '../state/types';

export interface WalkEntry {
  /** POSIX-style relative path (forward slashes, no leading slash). */
  rel: string;
  /** Absolute filesystem path. */
  abs: string;
}

export async function pickWorkspace(): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false });
  return typeof result === 'string' ? result : null;
}

export async function listDir(path: string): Promise<FileEntry[]> {
  return await invoke<FileEntry[]>('list_dir', { path });
}

export async function readFileText(path: string): Promise<string> {
  return await invoke<string>('read_file', { path });
}

export async function writeFileText(path: string, content: string): Promise<void> {
  await invoke('write_file', { path, content });
}

/**
 * Recursively walk the workspace, returning every file (capped server-side
 * at 5000) as `{rel, abs}`. Used by the @-mention picker in the chat
 * composer for fuzzy file search. Skips `node_modules`, `.git`, `.venv`,
 * `target`, `dist`, `build`, etc. (same skip set as list_dir).
 */
export async function walkWorkspace(path: string): Promise<WalkEntry[]> {
  return await invoke<WalkEntry[]>('walk_workspace', { path });
}
