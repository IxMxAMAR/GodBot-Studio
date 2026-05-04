import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';

export function Splitter({
  side, onResize, min = 160, max = 600,
}: { side: 'left' | 'right'; onResize: (px: number) => void; min?: number; max?: number }) {
  const startX = useRef(0);
  const startSize = useRef(0);
  const dragging = useRef(false);
  const currentSize = side === 'left'
    ? useStore((s) => s.leftWidth)
    : useStore((s) => s.rightWidth);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = side === 'left' ? startSize.current + delta : startSize.current - delta;
      onResize(Math.max(min, Math.min(max, next)));
    }
    function onUp() {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [side, onResize, min, max]);

  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onResize(Math.max(min, Math.min(max, currentSize + (side === 'left' ? -step : step))));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      onResize(Math.max(min, Math.min(max, currentSize + (side === 'left' ? step : -step))));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onResize(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onResize(max);
    }
  }

  return (
    <div
      className={`splitter ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={currentSize}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        startX.current = e.clientX;
        const sibling = side === 'left'
          ? (e.currentTarget.previousElementSibling as HTMLElement)
          : (e.currentTarget.nextElementSibling as HTMLElement);
        startSize.current = sibling.getBoundingClientRect().width;
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
    />
  );
}
