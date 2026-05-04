import { FilesIcon, ChatIcon, SettingsIcon, MemoryIcon } from './Icons';
import { useStore } from '../state/store';
import type { ActivityKind } from '../state/types';

export function ActivityBar({
  active, onPick,
}: { active: ActivityKind; onPick: (k: ActivityKind) => void }) {
  const showChat = useStore((s) => s.showChat);
  const toggleChat = useStore((s) => s.toggleChat);

  return (
    <div className="activity-bar">
      <button
        className={active === 'files' ? 'active' : ''}
        onClick={() => onPick('files')}
        title="Files (toggle sidebar)"
        aria-label="Files"
      >
        <FilesIcon />
      </button>
      <button
        className={active === 'memory' ? 'active' : ''}
        onClick={() => onPick('memory')}
        title="Memory"
        aria-label="Memory"
      >
        <MemoryIcon />
      </button>
      <button
        className={showChat ? 'active' : ''}
        onClick={toggleChat}
        title={showChat ? 'Hide chat panel' : 'Show chat panel'}
        aria-label={showChat ? 'Hide chat' : 'Show chat'}
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
