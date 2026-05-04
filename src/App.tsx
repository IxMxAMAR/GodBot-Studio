import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { FileTree } from './components/FileTree';
import { WorkspacePicker } from './components/WorkspacePicker';
import { EditorPane } from './components/EditorPane';
import { useStore } from './state/store';
import './styles/globals.css';
import './styles/app.css';

export default function App() {
  const workspace = useStore((s) => s.workspace);
  const activity = useStore((s) => s.activity);
  const setActivity = useStore((s) => s.setActivity);
  const daemonHealthy = useStore((s) => s.daemonHealthy);
  const modelName = useStore((s) => s.modelName);

  return (
    <div className="app-root">
      <TitleBar workspace={workspace} />
      <div className="main-area">
        <ActivityBar active={activity} onPick={setActivity} />
        <div className="left-sidebar">
          <div className="header">Files</div>
          {workspace ? <FileTree /> : <WorkspacePicker />}
        </div>
        <div className="center-area">
          <EditorPane />
        </div>
        <div className="right-sidebar">
          <div className="header">Chat</div>
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>
            (chat panel — Task 6)
          </div>
        </div>
      </div>
      <StatusBar workspace={workspace} model={modelName} daemonHealthy={daemonHealthy} />
    </div>
  );
}
