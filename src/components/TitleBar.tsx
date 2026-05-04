import { Window } from '@tauri-apps/api/window';

const win = Window.getCurrent();

export function TitleBar({ workspace }: { workspace: string | null }) {
  return (
    <div className="title-bar">
      <span className="brand">GodBot</span>
      <span className="workspace-label">
        {workspace ? `· ${workspace}` : '· no workspace'}
      </span>
      <div className="window-controls">
        <button onClick={() => win.minimize()}>—</button>
        <button onClick={async () => (await win.isMaximized()) ? win.unmaximize() : win.maximize()}>□</button>
        <button className="close" onClick={() => win.close()}>×</button>
      </div>
    </div>
  );
}
