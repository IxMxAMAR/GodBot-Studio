export function StatusBar({
  workspace, model, daemonHealthy,
}: {
  workspace: string | null;
  model: string;
  daemonHealthy: boolean;
}) {
  return (
    <div className="status-bar">
      <span className="item">
        <span className={`health-dot ${daemonHealthy ? 'ok' : 'bad'}`} />
        daemon
      </span>
      <span className="item">model: {model || '—'}</span>
      <span className="item" style={{ marginLeft: 'auto' }}>
        {workspace ?? 'no workspace'}
      </span>
    </div>
  );
}
