import { ChevronRightIcon } from './Icons';

const TOOL_GROUPS: Record<string, string> = {
  read_file: 'fs', write_file: 'fs', edit_file: 'fs',
  glob: 'fs', grep: 'fs', list_dir: 'fs', read_blob: 'fs',
  run_powershell: 'shell', run_bash: 'shell',
  web_fetch: 'web', web_search: 'web',
  run_python: 'python',
  save_note: 'memory', recall_notes: 'memory',
  todo_set: 'task', todo_check: 'task',
  search_knowledge: 'rag',
};

export function ToolCallCard({
  name, args, result, durationMs, blob,
}: {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  blob?: string | null;
}) {
  const group = TOOL_GROUPS[name] ?? 'default';
  const argsPreview = Object.entries(args).slice(0, 5)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  return (
    <div className="chat-tool-card" data-group={group}>
      <div className="head" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <ChevronRightIcon size={12} />
        <span>{name}({argsPreview})</span>
        {durationMs !== undefined && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>[{durationMs}ms]</span>}
        {blob && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(blob: {blob})</span>}
      </div>
      {result && <div className="body">{result}</div>}
    </div>
  );
}
