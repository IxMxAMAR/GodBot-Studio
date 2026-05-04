import { useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import './styles/globals.css';
import './styles/app.css';

type ActivityKind = 'files' | 'chat' | 'settings';

export default function App() {
  const [active, setActive] = useState<ActivityKind>('files');
  const [workspace] = useState<string | null>(null);

  return (
    <div className="app-root">
      <TitleBar workspace={workspace} />
      <div className="main-area">
        <ActivityBar active={active} onPick={setActive} />
        <div className="left-sidebar">
          <div className="header">Files</div>
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>
            (file tree — Task 4)
          </div>
        </div>
        <div className="center-area">
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>
            (editor — Task 5)
          </div>
        </div>
        <div className="right-sidebar">
          <div className="header">Chat</div>
          <div style={{ padding: 12, color: 'var(--text-muted)' }}>
            (chat panel — Task 6)
          </div>
        </div>
      </div>
      <StatusBar workspace={workspace} model="—" daemonHealthy={false} />
    </div>
  );
}
