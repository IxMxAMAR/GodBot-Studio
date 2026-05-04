import { getCurrentWindow } from '@tauri-apps/api/window';
import { MinimizeIcon, MaximizeIcon, CloseIcon } from './Icons';

const win = getCurrentWindow();

export function TitleBar({ workspace }: { workspace: string | null }) {
  return (
    <div className="title-bar" data-tauri-drag-region>
      <img src="/icon.png" alt="" className="brand-icon" data-tauri-drag-region />
      <span className="brand" data-tauri-drag-region>GodBot</span>
      <span className="workspace-label" data-tauri-drag-region>
        {workspace ? `· ${workspace}` : '· no workspace'}
      </span>
      <div className="window-controls">
        <button aria-label="Minimize" onClick={() => win.minimize().catch(console.error)}><MinimizeIcon /></button>
        <button aria-label="Maximize" onClick={() => win.toggleMaximize().catch(console.error)}><MaximizeIcon /></button>
        <button aria-label="Close" className="close" onClick={() => win.close().catch(console.error)}><CloseIcon /></button>
      </div>
    </div>
  );
}
