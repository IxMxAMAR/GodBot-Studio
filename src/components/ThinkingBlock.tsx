import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from './Icons';

/**
 * Collapsible "Thinking" block shown above an assistant answer or tool call.
 *
 * Closed by default — preserves vertical space in the chat. Click the head
 * to expand and read the full chain-of-thought. Returns null for empty
 * thoughts so we don't render a useless 0-char chevron.
 */
export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;
  return (
    <div className={`thinking-block ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="thinking-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDownIcon size={10} /> : <ChevronRightIcon size={10} />}
        <span className="thinking-label">Thinking</span>
        {!open && <span className="thinking-preview">{preview}</span>}
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}
