import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { FileTree } from './components/FileTree';
import { WorkspacePicker } from './components/WorkspacePicker';
import { EditorPane } from './components/EditorPane';
import { ChatPanel } from './components/ChatPanel';
import { Splitter } from './components/Splitter';
import { SettingsPanel } from './components/SettingsPanel';
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

  const showLeft = activity === 'files';
  const showSettings = activity === 'settings';

  // Grid columns: activity-bar | (left-sidebar splitter)? | center | (splitter right-sidebar)?
  const left = showLeft ? `${leftWidth}px 4px ` : '';
  const right = showChat ? ` 4px ${rightWidth}px` : '';
  const gridTemplateColumns = `44px ${left}1fr${right}`;

  return (
    <div className="app-root">
      <TitleBar workspace={workspace} />
      <div className="main-area" style={{ gridTemplateColumns }}>
        <ActivityBar active={activity} onPick={setActivity} />
        {showLeft && (
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
            {workspace ? <FileTree /> : <WorkspacePicker />}
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
