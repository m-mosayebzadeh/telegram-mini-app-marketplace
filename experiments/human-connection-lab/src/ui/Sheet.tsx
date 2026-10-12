/**
 * A bottom sheet for a short, self-contained decision.
 *
 * Rises from the bottom (where the thumb is), dims what's behind, closes on
 * the backdrop or Escape, and returns focus to whatever opened it.
 */

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Sheet({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest onClose, so the effect below runs once per opening. Re-running
  // it on every render would pull focus back to the sheet each second, while
  // someone is typing in it.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={() => onCloseRef.current()} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheet__handle" aria-hidden="true" />
        <h2 className="sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
