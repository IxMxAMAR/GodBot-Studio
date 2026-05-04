import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { FileTree } from './components/FileTree';
import { WorkspacePicker } from './components/WorkspacePicker';
import { EditorPane } from './components/EditorPane';
import { ChatPanel } from './components/ChatPanel';
import { useStore } from './state/store';
import './styles/globals.css';
import './styles/app.css';

export default function App() {
  const workspace = useStore((s) => s.workspace);
  const activity = useStore((s) => s.activity);
  const setActivity = useStore((s) => s.setActivity);

  const showLeft = activity === 'files';
  const showSettings = activity === 'settings';

  return (
    <div className="app-root">
      <TitleBar workspace={workspace} />
      <div className="main-area" data-show-left={showLeft}>
        <ActivityBar active={activity} onPick={setActivity} />
        {showLeft && (
          <div className="left-sidebar">
            <div className="header header-row">
              <span>Files</span>
              {workspace && (
                <button
                  aria-label="Close folder"
                  title="Close folder"
                  className="icon-btn"
                  onClick={() => {
                    useStore.getState().setWorkspace(null);
                    useStore.getState().setFileTree([]);
                    useStore.getState().setSessionId(null);
                    useStore.getState().clearChat();
                    useStore.getState().setDaemonStatus('idle');
                  }}
                >×</button>
              )}
            </div>
            {workspace ? <FileTree /> : <WorkspacePicker />}
          </div>
        )}
        <div className="center-area">
          {showSettings ? (
            <div style={{ padding: 32, color: 'var(--text-muted)' }}>
              <h2 style={{ marginTop: 0, color: 'var(--text)' }}>Settings</h2>
              <p>UI for Python path, daemon port, theme, and keybindings ships in Phase B.</p>
              <p>For now, edit <code>src/api/config.ts</code> to change the Python path used to spawn the daemon.</p>
            </div>
          ) : (
            <EditorPane />
          )}
        </div>
        <div className="right-sidebar">
          <div className="header">Chat</div>
          <ChatPanel />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
