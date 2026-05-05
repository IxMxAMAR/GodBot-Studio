import { useEffect, useState } from 'react';
import { checkForUpdate } from './api/updater';
import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { FileTree } from './components/FileTree';
import { WorkspacePicker } from './components/WorkspacePicker';
import { EditorPane } from './components/EditorPane';
import { ChatPanel } from './components/ChatPanel';
import { Splitter } from './components/Splitter';
import { SettingsPanel } from './components/SettingsPanel';
import { SessionList } from './components/SessionList';
import { ProjectSection } from './components/ProjectSection';
import { MemoryPanel } from './components/MemoryPanel';
import { RefreshIcon, CloseIcon } from './components/Icons';
import { useStore } from './state/store';
import './styles/globals.css';
import './styles/app.css';

export default function App() {
  const workspace = useStore((s) => s.workspace);
  const activity = useStore((s) => s.activity);
  const setActivity = useStore((s) => s.setActivity);
  const leftWidth = useStore((s) => s.leftWidth);
  const rightWidth = useStore((s) => s.rightWidth);
  const setLeftWidth = useStore((s) => s.setLeftWidth);
  const setRightWidth = useStore((s) => s.setRightWidth);
  const showChat = useStore((s) => s.showChat);
  const theme = useStore((s) => s.theme);

  // Mirror the theme onto <html data-theme=…> so globals.css can swap
  // CSS variable values without re-renders. Driven by the persisted
  // store value; first paint reads from localStorage (Zustand persist).
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Auto-update probe — runs once at boot. Failures (no pubkey, offline,
  // not running under Tauri) are swallowed by `checkForUpdate`, so a
  // dev-server load won't show the banner. The banner is purely
  // informational; install happens via plugin-updater on next launch
  // (or when the user wires `update.downloadAndInstall()` later).
  const [updateInfo, setUpdateInfo] = useState<{ version: string; notes?: string | null } | null>(null);
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  useEffect(() => {
    let cancel = false;
    (async () => {
      const r = await checkForUpdate();
      if (cancel) return;
      if (r.available && r.version) {
        setUpdateInfo({ version: r.version, notes: r.notes });
      }
    })();
    return () => { cancel = true; };
  }, []);

  const showFiles = activity === 'files';
  const showMemory = activity === 'memory';
  const showLeft = showFiles || showMemory;
  const showSettings = activity === 'settings';

  // Grid columns: activity-bar | (left-sidebar splitter)? | center | (splitter right-sidebar)?
  const left = showLeft ? `${leftWidth}px 4px ` : '';
  const right = showChat ? ` 4px ${rightWidth}px` : '';
  const gridTemplateColumns = `44px ${left}1fr${right}`;

  return (
    <div className="app-root">
      {updateInfo && !updateBannerDismissed && (
        <div className="update-banner" role="status">
          <span>
            Update available: v{updateInfo.version} — restart Studio to install.
          </span>
          <button
            type="button"
            onClick={() => setUpdateBannerDismissed(true)}
            title="Dismiss"
            aria-label="Dismiss update banner"
          >Dismiss</button>
        </div>
      )}
      <TitleBar workspace={workspace} />
      <div className="main-area" style={{ gridTemplateColumns }}>
        <ActivityBar active={activity} onPick={setActivity} />
        {showFiles && (
          <div className="left-sidebar">
            <div className="header header-row">
              <span>Files</span>
              {workspace && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    aria-label="Refresh"
                    title="Refresh"
                    className="icon-btn"
                    onClick={() => useStore.getState().refreshTree()}
                  ><RefreshIcon /></button>
                  <button
                    aria-label="Close folder"
                    title="Close folder"
                    className="icon-btn"
                    onClick={() => {
                      const dirtyCount = useStore.getState().openFiles.filter((f) => f.dirty).length;
                      if (dirtyCount && !window.confirm(`Discard ${dirtyCount} unsaved file(s)?`)) return;
                      useStore.getState().setWorkspace(null);
                      useStore.getState().setFileTree([]);
                      useStore.getState().setSessionId(null);
                      useStore.getState().clearChat();
                      useStore.getState().setDaemonStatus('idle');
                      useStore.setState({ openFiles: [], activePath: null });
                    }}
                  ><CloseIcon /></button>
                </div>
              )}
            </div>
            {workspace ? (
              <div className="left-sidebar-scroll">
                <ProjectSection />
                <SessionList />
                <FileTree />
              </div>
            ) : <WorkspacePicker />}
          </div>
        )}
        {showMemory && (
          <div className="left-sidebar">
            <div className="header">Memory</div>
            <div className="left-sidebar-scroll">
              <MemoryPanel />
            </div>
          </div>
        )}
        {showLeft && <Splitter side="left" onResize={setLeftWidth} />}
        <div className="center-area">
          {showSettings ? <SettingsPanel /> : <EditorPane />}
        </div>
        {showChat && <Splitter side="right" onResize={setRightWidth} />}
        {showChat && (
          <div className="right-sidebar">
            <div className="header">Chat</div>
            <ChatPanel />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
