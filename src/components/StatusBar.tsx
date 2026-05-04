import { useStore } from '../state/store';
import { spawnDaemon } from './WorkspacePicker';

export function StatusBar() {
  const workspace = useStore((s) => s.workspace);
  const modelName = useStore((s) => s.modelName);
  const daemonStatus = useStore((s) => s.daemonStatus);
  const daemonError = useStore((s) => s.daemonError);
  const daemonHealthy = useStore((s) => s.daemonHealthy);

  const onRetry = () => { if (workspace) void spawnDaemon(workspace); };

  let label = 'daemon';
  let dotClass = 'bad';
  if (daemonStatus === 'spawning') { label = 'spawning…'; dotClass = 'spinning'; }
  else if (daemonHealthy) { label = 'daemon'; dotClass = 'ok'; }
  else if (daemonStatus === 'error') { label = 'daemon error'; dotClass = 'bad'; }

  return (
    <div className="status-bar">
      <button
        className="item daemon-btn"
        onClick={onRetry}
        title={daemonError ? `Click to retry. Last error: ${daemonError}` : 'Daemon status'}
      >
        <span className={`health-dot ${dotClass}`} />
        {label}
      </button>
      <span className="item">model: {modelName || '—'}</span>
      <span className="item" style={{ marginLeft: 'auto' }}>
        {workspace ?? 'no workspace'}
      </span>
    </div>
  );
}
