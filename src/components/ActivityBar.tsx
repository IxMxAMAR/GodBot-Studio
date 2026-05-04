type ActivityKind = 'files' | 'chat' | 'settings';

export function ActivityBar({
  active, onPick,
}: { active: ActivityKind; onPick: (k: ActivityKind) => void }) {
  return (
    <div className="activity-bar">
      <button
        className={active === 'files' ? 'active' : ''}
        onClick={() => onPick('files')}
        title="Files"
      >
        ☰
      </button>
      <button
        className={active === 'chat' ? 'active' : ''}
        onClick={() => onPick('chat')}
        title="Chat"
      >
        ◇
      </button>
      <button
        className={active === 'settings' ? 'active' : ''}
        onClick={() => onPick('settings')}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
