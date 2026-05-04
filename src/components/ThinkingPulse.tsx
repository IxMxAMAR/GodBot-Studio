/**
 * Three pulsing dots + the agent's current thought as muted small text.
 *
 * Shown while the JSON envelope's `thought` field is streaming and neither
 * `final_answer` nor `action` has appeared yet. The text grows token by
 * token; the dots animate continuously.
 */
export function ThinkingPulse({ text }: { text: string }) {
  return (
    <div className="thinking-pulse" role="status" aria-live="polite">
      <div className="dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="thought-preview">{text || 'Thinking…'}</div>
    </div>
  );
}
