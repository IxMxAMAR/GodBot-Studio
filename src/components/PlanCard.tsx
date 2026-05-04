import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ChatMessage, PlanPayload, PlanTask } from '../state/types';

/**
 * Plan-mode renderer — replaces an assistant bubble whose JSON parsed
 * into a `{plan: {goal, tasks}}` shape. "Run plan" sequentially sends
 * "Now do task #N: <title>" for each pending task and advances when the
 * subsequent assistant message finalizes (pending → false).
 */
export function PlanCard({ message }: { message: ChatMessage }) {
  const updateMessage = useStore((s) => s.updateMessage);
  const planRunning = useStore((s) => s.planRunning);
  const setPlanRunning = useStore((s) => s.setPlanRunning);
  const sendChatMessage = useStore((s) => s.sendChatMessage);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  // When we're driving the run loop, this is the task id we just dispatched
  // and are waiting on. The effect below watches the messages array and
  // advances when the next assistant turn finalizes.
  const awaitingTaskRef = useRef<number | null>(null);
  const abortRef = useRef(false);

  const plan = message.plan;
  if (!plan) return null;

  function patchPlan(next: PlanPayload) {
    updateMessage(message.id, { plan: next });
  }

  function setTaskStatus(id: number, status: PlanTask['status']) {
    if (!plan) return;
    const tasks = plan.tasks.map((t) => (t.id === id ? { ...t, status } : t));
    patchPlan({ ...plan, tasks });
  }

  function nextPendingFrom(p: PlanPayload, afterId?: number): PlanTask | null {
    const idx = afterId !== undefined ? p.tasks.findIndex((t) => t.id === afterId) : -1;
    for (let i = idx + 1; i < p.tasks.length; i++) {
      if (p.tasks[i].status === 'pending') return p.tasks[i];
    }
    return null;
  }

  async function dispatchTask(task: PlanTask) {
    if (!sendChatMessage) return;
    awaitingTaskRef.current = task.id;
    setTaskStatus(task.id, 'in_progress');
    sendChatMessage(`Now do task #${task.id}: ${task.title}`);
  }

  async function runPlan() {
    if (!plan || !sendChatMessage || planRunning) return;
    abortRef.current = false;
    setPlanRunning(true);
    const first = plan.tasks.find((t) => t.status === 'pending');
    if (!first) {
      setPlanRunning(false);
      return;
    }
    void dispatchTask(first);
  }

  function abortPlan() {
    abortRef.current = true;
    setPlanRunning(false);
    awaitingTaskRef.current = null;
  }

  function skipTask(task: PlanTask) {
    setTaskStatus(task.id, 'skipped');
    // If we're skipping the running task, advance.
    if (planRunning && awaitingTaskRef.current === task.id) {
      const after = nextPendingFrom(plan!, task.id);
      awaitingTaskRef.current = null;
      if (after && !abortRef.current) {
        void dispatchTask(after);
      } else {
        setPlanRunning(false);
      }
    }
  }

  function startEdit(task: PlanTask) {
    setEditingId(task.id);
    setEditingTitle(task.title);
  }

  function commitEdit(task: PlanTask) {
    if (!plan) return;
    const tasks = plan.tasks.map((t) => (t.id === task.id ? { ...t, title: editingTitle } : t));
    patchPlan({ ...plan, tasks });
    setEditingId(null);
    setEditingTitle('');
  }

  // Advance the run loop when the assistant turn we dispatched finalizes.
  // We watch the global messages array — once we observe a new assistant
  // message past the user "Now do task…" we marked, mark our task done
  // and dispatch the next pending one.
  const messages = useStore((s) => s.messages);
  useEffect(() => {
    if (!planRunning) return;
    const awaitingId = awaitingTaskRef.current;
    if (awaitingId == null) return;
    // Find the LAST user message that begins with "Now do task #<id>:".
    // The assistant turn that follows it (and is no longer pending) is
    // the signal we're done.
    const marker = `Now do task #${awaitingId}:`;
    let userIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user' && m.text.includes(marker)) { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    // Look for a finalized assistant message after the user marker.
    let done = false;
    for (let i = userIdx + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === 'assistant' && m.text && !m.pending) { done = true; break; }
      if (m.role === 'error') { done = true; break; }
    }
    if (!done) return;
    if (abortRef.current) return;
    setTaskStatus(awaitingId, 'done');
    awaitingTaskRef.current = null;
    const next = plan ? nextPendingFrom(plan, awaitingId) : null;
    if (next) {
      void dispatchTask(next);
    } else {
      setPlanRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, planRunning]);

  const anyPending = plan.tasks.some((t) => t.status === 'pending');
  const anyInProgress = plan.tasks.some((t) => t.status === 'in_progress');

  return (
    <div className="plan-card">
      <div className="plan-card-head">
        <strong className="plan-goal">{plan.goal}</strong>
      </div>
      <ol className="plan-task-list">
        {plan.tasks.map((task) => (
          <li key={task.id} className={`plan-task plan-task-${task.status}`}>
            <span className="plan-task-indicator">{indicatorFor(task.status)}</span>
            {editingId === task.id ? (
              <>
                <input
                  className="plan-task-edit"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(task);
                    if (e.key === 'Escape') { setEditingId(null); setEditingTitle(''); }
                  }}
                  autoFocus
                />
                <button className="plan-task-btn" onClick={() => commitEdit(task)}>Save</button>
                <button className="plan-task-btn"
                  onClick={() => { setEditingId(null); setEditingTitle(''); }}
                >Cancel</button>
              </>
            ) : (
              <>
                <span className="plan-task-title">{task.title}</span>
                {task.status === 'pending' && !planRunning && (
                  <>
                    <button className="plan-task-btn" onClick={() => startEdit(task)}>Edit</button>
                    <button className="plan-task-btn" onClick={() => skipTask(task)}>Skip</button>
                  </>
                )}
                {task.status === 'pending' && planRunning && (
                  <button className="plan-task-btn" onClick={() => skipTask(task)}>Skip</button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="plan-card-actions">
        {!planRunning && !anyInProgress && anyPending && (
          <button className="plan-run-btn" onClick={runPlan} disabled={!sendChatMessage}>
            Run plan
          </button>
        )}
        {planRunning && (
          <button className="plan-abort-btn" onClick={abortPlan}>Abort</button>
        )}
      </div>
    </div>
  );
}

function indicatorFor(status: PlanTask['status']): string {
  switch (status) {
    case 'done': return '✓';
    case 'skipped': return '⊘';
    case 'in_progress': return '…';
    default: return '▸';
  }
}
