import { FilesIcon, ChatIcon, SettingsIcon } from './Icons';
import type { ActivityKind } from '../state/types';

export function ActivityBar({
  active, onPick,
}: { active: ActivityKind; onPick: (k: ActivityKind) => void }) {
  function focusChat() {
    // Focus the chat textarea without changing activity (keeps file tree visible).
    const ta = document.querySelector('.chat-composer textarea') as HTMLTextAreaElement | null;
    ta?.focus();
  }
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
        onClick={focusChat}
        title="Focus chat (Ctrl+L)"
        aria-label="Focus chat"
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
