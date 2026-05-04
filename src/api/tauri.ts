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

export interface SessionEntry {
  sid: string;
  started_at: string;
  model: string;
  provider: string;
  model_name: string;
  last_user_msg_preview: string;
  /**
   * Sticky-pin flag read from the session's `meta.json`. Pinned rows
   * are sorted to the top of the SessionList. Toggled via
   * `GodbotClient.pinSession(sid, pinned)` which rewrites the meta file.
   */
  pinned: boolean;
}

/** Read all session metadata from `<workspace>/.godbot-sessions/`. */
export async function listSessions(sessionsRoot: string): Promise<SessionEntry[]> {
  return await invoke<SessionEntry[]>('list_sessions', { sessionsRoot });
}

/** Permanently delete a session directory. Caller must confirm. */
export async function deleteSession(sessionsRoot: string, sid: string): Promise<void> {
  await invoke('delete_session', { sessionsRoot, sid });
}

export interface PythonValidation {
  ok: boolean;
  version: string;
  error: string | null;
}

/** Run `<path> --version` and report the result. Used by Settings. */
export async function validatePython(path: string): Promise<PythonValidation> {
  return await invoke<PythonValidation>('validate_python', { path });
}
