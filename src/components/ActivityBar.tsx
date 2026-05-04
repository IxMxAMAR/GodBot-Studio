import { FilesIcon, ChatIcon, SettingsIcon } from './Icons';
import type { ActivityKind } from '../state/types';

export function ActivityBar({
  active, onPick,
}: { active: ActivityKind; onPick: (k: ActivityKind) => void }) {
  return (
    <div className="activity-bar">
      <button
        className={active === 'files' ? 'active' : ''}
        onClick={() => onPick('files')}
        title="Files"
        aria-label="Files"
      >
        <FilesIcon />
      </button>
      <button
        className={active === 'chat' ? 'active' : ''}
        onClick={() => onPick('chat')}
        title="Chat"
        aria-label="Chat"
      >
        <ChatIcon />
      </button>
      <button
        className={active === 'settings' ? 'active' : ''}
        onClick={() => onPick('settings')}
        title="Settings"
        aria-label="Settings"
      >
        <SettingsIcon />
      </button>
    </div>
  );
}
