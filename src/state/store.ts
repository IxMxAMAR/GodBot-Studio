import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, FileEntry, OpenFile, ActivityKind } from './types';

interface State {
  // Workspace
  workspace: string | null;
  fileTree: FileEntry[];
  setWorkspace: (path: string | null) => void;
  setFileTree: (tree: FileEntry[]) => void;
  refreshTree: () => Promise<void>;

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
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (n: number) => void;
  setRightWidth: (n: number) => void;
  showChat: boolean;
  toggleChat: () => void;

  // Chat
  sessionId: string | null;
  setSessionId: (sid: string | null) => void;
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;
  /** Replace the entire message log — used when switching to an existing session. */
  setMessages: (msgs: ChatMessage[]) => void;

  // Daemon
  daemonHealthy: boolean;
  modelName: string;
  daemonStatus: 'idle' | 'spawning' | 'ready' | 'error';
  daemonError: string | null;
  setDaemonHealth: (ok: boolean) => void;
  setModel: (name: string) => void;
  setDaemonStatus: (s: State['daemonStatus'], err?: string | null) => void;

  // Settings (persisted)
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
  /** User-overridden Python interpreter path. Empty = use compile-time default. */
  pythonPath: string;
  setPythonPath: (p: string) => void;
  /** Default provider to use when starting a new session. Empty = daemon's default. */
  defaultProvider: string;
  setDefaultProvider: (p: string) => void;
  /** Default model id within `defaultProvider`. Empty = provider's default. */
  defaultModel: string;
  setDefaultModel: (m: string) => void;
  /** Whether new sessions start with auto_approve_in_sandbox=true. */
  autoApprove: boolean;
  setAutoApprove: (a: boolean) => void;
  /** Cursor-style ghost-text completions in Monaco. Persisted. */
  inlineCompletionsEnabled: boolean;
  setInlineCompletionsEnabled: (b: boolean) => void;
  /**
   * Per-session flag: set to true once the daemon answers 501 for a
   * /api/complete request, so we stop firing further requests until the
   * user restarts (e.g. switches provider). NOT persisted.
   */
  inlineCompletionsUnsupported: boolean;
  setInlineCompletionsUnsupported: (b: boolean) => void;

  // Chat actions exposed from outside the chat panel.
  // Set by ChatPanel on mount; called by EditorPane's context-menu actions.
  sendChatMessage: ((text: string) => void) | null;
  setSendChatMessage: (fn: ((text: string) => void) | null) => void;

  // Project understanding (sub-project 10.1) — cached summary keyed by absolute workspace path.
  projectSummary: Record<string, string>;
  setProjectSummary: (workspace: string, summary: string) => void;

  // Plan mode (sub-project 10.3) — true while a /plan run is sequentially advancing.
  planRunning: boolean;
  setPlanRunning: (b: boolean) => void;

  // Budget caps applied to newly-created sessions (sub-projects 18-19).
  // null = no cap; number = applied as max_total_tokens / max_usd via
  // POST /api/sessions/{sid}/budget right after session creation.
  defaultMaxTokens: number | null;
  defaultMaxUsd: number | null;
  setDefaultMaxTokens: (n: number | null) => void;
  setDefaultMaxUsd: (n: number | null) => void;

  // Per-turn feedback ratings (sub-project 20). Keyed by `${sid}:${target_index}`.
  // Seeded by ChatPanel from getFeedback() once per session load and updated
  // optimistically when the user clicks a thumb.
  feedbackByKey: Record<string, 'up' | 'down'>;
  setFeedbackRating: (key: string, rating: 'up' | 'down') => void;
  clearFeedbackForSession: (sid: string) => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
  workspace: null,
  fileTree: [],
  setWorkspace: (path) => set({ workspace: path }),
  setFileTree: (tree) => set({ fileTree: tree }),
  refreshTree: async () => {
    const { workspace } = get();
    if (!workspace) return;
    const { listDir } = await import('../api/tauri');
    try {
      const tree = await listDir(workspace);
      set({ fileTree: tree });
    } catch (e) {
      console.error('refreshTree failed', e);
    }
  },

  openFiles: [],
  activePath: null,
  openFile: (file) => set((s) => {
    if (s.openFiles.find((f) => f.path === file.path)) {
      return { activePath: file.path };
    }
    const enriched = { ...file, originalContent: file.originalContent ?? file.content };
    return { openFiles: [...s.openFiles, enriched], activePath: file.path };
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
      f.path === path ? { ...f, content, dirty: content !== f.originalContent } : f
    ),
  })),
  markClean: (path) => set((s) => ({
    openFiles: s.openFiles.map((f) =>
      f.path === path ? { ...f, dirty: false, originalContent: f.content } : f
    ),
  })),

  activity: 'files',
  setActivity: (a) => set({ activity: a }),
  leftWidth: 240,
  rightWidth: 320,
  setLeftWidth: (n) => set({ leftWidth: n }),
  setRightWidth: (n) => set({ rightWidth: n }),
  showChat: true,
  toggleChat: () => set((s) => ({ showChat: !s.showChat })),

  sessionId: null,
  setSessionId: (sid) => set({ sessionId: sid }),
  messages: [],
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, patch) => set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  })),
  clearChat: () => set({ messages: [] }),
  setMessages: (msgs) => set({ messages: msgs }),

  daemonHealthy: false,
  modelName: '',
  daemonStatus: 'idle',
  daemonError: null,
  setDaemonHealth: (ok) => set({ daemonHealthy: ok }),
  setModel: (name) => set({ modelName: name }),
  setDaemonStatus: (s, err = null) => set({ daemonStatus: s, daemonError: err }),

  // Default theme follows the OS — picked up at first paint when the
  // store hydrates an empty value. App.tsx owns reading prefers-color-scheme.
  theme: 'dark',
  setTheme: (t) => set({ theme: t }),
  pythonPath: '',
  setPythonPath: (p) => set({ pythonPath: p }),
  defaultProvider: '',
  setDefaultProvider: (p) => set({ defaultProvider: p }),
  defaultModel: '',
  setDefaultModel: (m) => set({ defaultModel: m }),
  autoApprove: true,
  setAutoApprove: (a) => set({ autoApprove: a }),
  inlineCompletionsEnabled: true,
  setInlineCompletionsEnabled: (b) => set({ inlineCompletionsEnabled: b }),
  inlineCompletionsUnsupported: false,
  setInlineCompletionsUnsupported: (b) => set({ inlineCompletionsUnsupported: b }),

  sendChatMessage: null,
  setSendChatMessage: (fn) => set({ sendChatMessage: fn }),

  projectSummary: {},
  setProjectSummary: (workspace, summary) => set((s) => ({
    projectSummary: { ...s.projectSummary, [workspace]: summary },
  })),

  planRunning: false,
  setPlanRunning: (b) => set({ planRunning: b }),

  defaultMaxTokens: null,
  defaultMaxUsd: null,
  setDefaultMaxTokens: (n) => set({ defaultMaxTokens: n }),
  setDefaultMaxUsd: (n) => set({ defaultMaxUsd: n }),

  feedbackByKey: {},
  setFeedbackRating: (key, rating) => set((s) => ({
    feedbackByKey: { ...s.feedbackByKey, [key]: rating },
  })),
  clearFeedbackForSession: (sid) => set((s) => {
    const prefix = `${sid}:`;
    const next: Record<string, 'up' | 'down'> = {};
    for (const [k, v] of Object.entries(s.feedbackByKey)) {
      if (!k.startsWith(prefix)) next[k] = v;
    }
    return { feedbackByKey: next };
  }),
    }),
    {
      name: 'godbot-studio-ui',
      partialize: (state) => ({
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth,
        showChat: state.showChat,
        theme: state.theme,
        pythonPath: state.pythonPath,
        defaultProvider: state.defaultProvider,
        defaultModel: state.defaultModel,
        autoApprove: state.autoApprove,
        inlineCompletionsEnabled: state.inlineCompletionsEnabled,
        projectSummary: state.projectSummary,
        defaultMaxTokens: state.defaultMaxTokens,
        defaultMaxUsd: state.defaultMaxUsd,
      }),
    }
  )
);
