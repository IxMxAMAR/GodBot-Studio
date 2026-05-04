import { useEffect, useRef } from 'react';

export function Splitter({
  side, onResize, min = 160, max = 600,
}: { side: 'left' | 'right'; onResize: (px: number) => void; min?: number; max?: number }) {
  const startX = useRef(0);
  const startSize = useRef(0);
  const dragging = useRef(false);

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

  return (
    <div
      className={`splitter ${side}`}
      onMouseDown={(e) => {
        startX.current = e.clientX;
        startSize.current = side === 'left'
          ? (e.currentTarget.previousElementSibling as HTMLElement).getBoundingClientRect().width
          : (e.currentTarget.nextElementSibling as HTMLElement).getBoundingClientRect().width;
        dragging.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }}
    />
  );
}
