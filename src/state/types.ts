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
  originalContent: string;   // snapshot at open time / after save
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
  resolved?: 'allow' | 'always' | 'deny';
  pending?: boolean;
  // Progressive ReAct parsing state for assistant messages.
  thought?: string;          // accumulated thought, shown via ThinkingBlock
  rawStream?: string;        // accumulated raw token stream for the active turn
  rawFallback?: boolean;     // true when JSON parse failed at done — render text as-is
  // FS-write gate extras (set on 'gate' role messages when fs_diff is present).
  fsDiff?: { path: string; before: string | null; after: string };
}

export type ActivityKind = 'files' | 'chat' | 'settings';
