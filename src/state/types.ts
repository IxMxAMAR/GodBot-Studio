export interface FileEntry {
  name: string;
  path: string;        // absolute
  isDir: boolean;
  children?: FileEntry[];  // populated lazily
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'gate' | 'error';
  text: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  duration?: number;
  blob?: string | null;
}

export type ActivityKind = 'files' | 'chat' | 'settings';
