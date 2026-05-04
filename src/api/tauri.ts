import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { FileEntry } from '../state/types';

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
