import { GodbotClient } from '../api/godbot';

export function GateCard({
  callId, name, args, sessionId, client, resolved, onResolved,
}: {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  sessionId: string;
  client: GodbotClient;
  resolved?: 'allow' | 'always' | 'deny';
  onResolved: (decision: 'allow' | 'always' | 'deny') => void;
}) {
  async function decide(decision: 'allow' | 'always' | 'deny') {
    if (resolved) return;
    try {
      await client.resolveGate(sessionId, callId, decision);
      onResolved(decision);
    } catch (e) {
      console.error('gate resolve failed', e);
    }
  }
  return (
    <div className="chat-gate-card">
      <div className="head">⚠ Approve {name}?</div>
      <pre>{JSON.stringify(args, null, 2)}</pre>
      {resolved ? (
        <div className="resolved">Decision: <strong>{resolved}</strong></div>
      ) : (
        <div className="actions">
          <button className="allow" onClick={() => decide('allow')}>Allow</button>
          <button className="always" onClick={() => decide('always')}>Always</button>
          <button className="deny" onClick={() => decide('deny')}>Deny</button>
        </div>
      )}
    </div>
  );
}
