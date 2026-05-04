import { create } from 'zustand';
import type { ChatMessage, FileEntry, OpenFile, ActivityKind } from './types';

interface State {
  // Workspace
  workspace: string | null;
  fileTree: FileEntry[];
  setWorkspace: (path: string | null) => void;
  setFileTree: (tree: FileEntry[]) => void;

  // Editor
  openFiles: OpenFile[];
  activePath: string | null;
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActivePath: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  markClean: (path: string) => void;

  // UI
  activity: ActivityKind;
  setActivity: (a: ActivityKind) => void;

  // Chat
  sessionId: string | null;
  setSessionId: (sid: string | null) => void;
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;

  // Daemon
  daemonHealthy: boolean;
  modelName: string;
  setDaemonHealth: (ok: boolean) => void;
  setModel: (name: string) => void;
}

export const useStore = create<State>((set) => ({
  workspace: null,
  fileTree: [],
  setWorkspace: (path) => set({ workspace: path }),
  setFileTree: (tree) => set({ fileTree: tree }),

  openFiles: [],
  activePath: null,
  openFile: (file) => set((s) => {
    if (s.openFiles.find((f) => f.path === file.path)) {
      return { activePath: file.path };
    }
    return { openFiles: [...s.openFiles, file], activePath: file.path };
  }),
  closeFile: (path) => set((s) => {
    const remaining = s.openFiles.filter((f) => f.path !== path);
    return {
      openFiles: remaining,
      activePath: s.activePath === path
        ? (remaining.length ? remaining[remaining.length - 1].path : null)
        : s.activePath,
    };
  }),
  setActivePath: (path) => set({ activePath: path }),
  updateContent: (path, content) => set((s) => ({
    openFiles: s.openFiles.map((f) =>
      f.path === path ? { ...f, content, dirty: true } : f
    ),
  })),
  markClean: (path) => set((s) => ({
    openFiles: s.openFiles.map((f) =>
      f.path === path ? { ...f, dirty: false } : f
    ),
  })),

  activity: 'files',
  setActivity: (a) => set({ activity: a }),

  sessionId: null,
  setSessionId: (sid) => set({ sessionId: sid }),
  messages: [],
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, patch) => set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  })),
  clearChat: () => set({ messages: [] }),

  daemonHealthy: false,
  modelName: '',
  setDaemonHealth: (ok) => set({ daemonHealthy: ok }),
  setModel: (name) => set({ modelName: name }),
}));
