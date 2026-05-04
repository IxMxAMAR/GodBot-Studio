import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyRank } from '../api/fuzzy';
import type { WalkEntry } from '../api/tauri';

interface MentionPopupProps {
  /** Files in the current workspace (already walked + cached by ChatPanel). */
  files: WalkEntry[];
  /** The query the user has typed AFTER the `@` (excluding the `@`). */
  query: string;
  /** Pixel position to anchor the popup, in viewport coords. */
  anchor: { left: number; top: number };
  /** Called with the chosen entry's relative path; ChatPanel inserts it. */
  onPick: (rel: string) => void;
  /** Called when the user presses Esc or clicks away. */
  onCancel: () => void;
}

/**
 * Floating popup shown when the user types `@` in the chat composer.
 *
 * Keyboard navigation is driven from ChatPanel's textarea keydown handler
 * via a custom `mention-popup-key` window event; that keeps the focus on
 * the textarea (so typing keeps narrowing the query) while still letting
 * arrow keys / Enter / Esc target this popup.
 */
export function MentionPopup({ files, query, anchor, onPick, onCancel }: MentionPopupProps) {
  const ranked = useMemo(
    () => fuzzyRank(query, files, (f) => f.rel, 50),
    [files, query],
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const activeIdxRef = useRef(0);
  activeIdxRef.current = activeIdx;
  const listRef = useRef<HTMLDivElement>(null);

  // Reset selection whenever the ranked list changes (new query, new files).
  useEffect(() => { setActiveIdx(0); }, [query, files]);

  // Scroll the active row into view when it changes.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>(
      `[data-mention-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Listen for keyboard commands from ChatPanel.
  useEffect(() => {
    function onKey(e: Event) {
      const which = (e as CustomEvent<'up' | 'down' | 'enter' | 'esc'>).detail;
      if (!ranked.length && which !== 'esc') return;
      if (which === 'up') {
        setActiveIdx((i) => (i - 1 + ranked.length) % ranked.length);
      } else if (which === 'down') {
        setActiveIdx((i) => (i + 1) % ranked.length);
      } else if (which === 'enter') {
        const hit = ranked[activeIdxRef.current];
        if (hit) onPick(hit.rel);
      } else if (which === 'esc') {
        onCancel();
      }
    }
    window.addEventListener('mention-popup-key', onKey);
    return () => window.removeEventListener('mention-popup-key', onKey);
  }, [ranked, onPick, onCancel]);

  if (!ranked.length) {
    return (
      <div className="mention-popup empty" style={{ left: anchor.left, top: anchor.top }}>
        <div className="mention-empty">No files match "{query}"</div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="mention-popup"
      style={{ left: anchor.left, top: anchor.top }}
      onMouseDown={(e) => e.preventDefault()}  // keep textarea focus
    >
      {ranked.map((entry, i) => (
        <div
          key={entry.rel}
          data-mention-idx={i}
          className={`mention-row${i === activeIdx ? ' active' : ''}`}
          onMouseEnter={() => setActiveIdx(i)}
          onClick={() => onPick(entry.rel)}
          title={entry.abs}
        >
          <span className="mention-name">{basename(entry.rel)}</span>
          <span className="mention-dir">{dirname(entry.rel)}</span>
        </div>
      ))}
    </div>
  );
}

function basename(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx >= 0 ? rel.slice(idx + 1) : rel;
}

function dirname(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx >= 0 ? rel.slice(0, idx) : '';
}
