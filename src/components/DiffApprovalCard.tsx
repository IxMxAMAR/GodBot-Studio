import { DiffEditor } from '@monaco-editor/react';
import { useState } from 'react';
import { GodbotClient } from '../api/godbot';
import { WarnIcon } from './Icons';

/**
 * Inline diff approval card for write_file / edit_file gates.
 *
 * Renders Monaco's DiffEditor showing before -> after for the path the agent
 * wants to write. Buttons:
 *   - Apply  : POST /api/gate/{id} { decision: 'allow' [, args_override] }
 *   - Edit   : toggles the right pane writable; on next Apply, the user-edited
 *              content is sent as args_override.content
 *   - Always : decision = 'always' (auto-approves this tool for the session)
 *   - Reject : decision = 'deny'
 *
 * SideBySide is OFF by default — the chat sidebar is ~320px wide, an inline
 * unified diff is the only thing that fits. Renders edit_file diffs the same
 * way (the daemon simulates the find/replace and sends after pre-applied).
 */
export function DiffApprovalCard({
  callId, name, fsDiff, sessionId, client, resolved, onResolved,
}: {
  callId: string;
  name: string;
  fsDiff: { path: string; before: string | null; after: string };
  sessionId: string;
  client: GodbotClient;
  resolved?: 'allow' | 'always' | 'deny';
  onResolved: (decision: 'allow' | 'always' | 'deny') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedAfter, setEditedAfter] = useState(fsDiff.after);
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'allow' | 'always' | 'deny') {
    if (resolved || busy) return;
    setBusy(true);
    try {
      // Override only applies on apply/always for write_file when content was
      // edited. edit_file's args don't have a 'content' field — for edit_file
      // we'd need a different override shape, which this card doesn't support
      // yet (the daemon would need an 'after' override path). Punt: for
      // edit_file we always send the agent's original args.
      const contentChanged = editedAfter !== fsDiff.after;
      const override =
        decision !== 'deny' && contentChanged && name === 'write_file'
          ? { content: editedAfter }
          : undefined;
      await client.resolveGate(sessionId, callId, decision, override);
      onResolved(decision);
    } catch (e) {
      console.error('gate resolve failed', e);
    } finally {
      setBusy(false);
    }
  }

  const language = languageForPath(fsDiff.path);

  return (
    <div className="diff-approval-card">
      <div className="head">
        <WarnIcon /> Approve <strong>{name}</strong>: <code>{fsDiff.path || '(no path)'}</code>
      </div>
      <div className="diff-host">
        <DiffEditor
          original={fsDiff.before ?? ''}
          modified={editing ? editedAfter : fsDiff.after}
          language={language}
          theme="godbot-dark"
          options={{
            readOnly: !editing,
            renderSideBySide: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            automaticLayout: true,
            // The original (before) pane is never editable — only the agent's
            // proposed content can be tweaked by the user.
            originalEditable: false,
          }}
          onMount={(editor) => {
            const modifiedEditor = editor.getModifiedEditor();
            modifiedEditor.onDidChangeModelContent(() => {
              setEditedAfter(modifiedEditor.getValue());
            });
          }}
        />
      </div>
      {resolved ? (
        <div className="resolved">Decision: <strong>{resolved}</strong></div>
      ) : (
        <div className="actions">
          <button
            className="allow"
            onClick={() => decide('allow')}
            disabled={busy}
            title={
              editing && editedAfter !== fsDiff.after && name === 'write_file'
                ? 'Apply with your edits (overrides agent content)'
                : 'Apply the agent\'s proposed change'
            }
          >Apply</button>
          <button
            className="edit"
            onClick={() => setEditing(!editing)}
            disabled={busy || name !== 'write_file'}
            title={
              name !== 'write_file'
                ? 'Editing is only supported for write_file (edit_file uses old/new strings)'
                : editing
                  ? 'Stop editing the proposed content'
                  : 'Edit the proposed content before applying'
            }
          >{editing ? 'Stop editing' : 'Edit'}</button>
          <button
            className="always"
            onClick={() => decide('always')}
            disabled={busy}
            title="Auto-approve this tool for the rest of the session"
          >Always</button>
          <button
            className="deny"
            onClick={() => decide('deny')}
            disabled={busy}
          >Reject</button>
        </div>
      )}
    </div>
  );
}

function languageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: 'python',
    js: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json', md: 'markdown',
    html: 'html', css: 'css',
    rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', c: 'c', h: 'cpp',
    sh: 'shell', toml: 'plaintext', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext ?? ''] ?? 'plaintext';
}
