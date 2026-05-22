import type { FC, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useTranslation';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  height?: 'half' | 'full';
}

// QNBS-v3: querySelectorAll is simpler and more reliable than TreeWalker for focus-trap;
//          TreeWalker's FILTER_REJECT prunes entire subtrees which breaks on containers with tabIndex=-1.
function getFocusable(root: Element): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export const BottomSheet: FC<BottomSheetProps> = ({
  open,
  onClose,
  title,
  children,
  height = 'half',
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // QNBS-v3: Persist scroll position across open/close so the "More" menu returns to where the user was.
  const savedScrollRef = useRef(0);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  // Drag-to-dismiss state
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef<number | null>(null);
  const sheetHeightRef = useRef(0);

  // Restore focus and handle Escape on close
  useEffect(() => {
    if (!open) {
      savedScrollRef.current = scrollRef.current?.scrollTop ?? 0;
      setDragY(0);
      lastFocusRef.current?.focus();
      return;
    }
    // Save the element that was focused before we opened
    lastFocusRef.current = document.activeElement as HTMLElement;
    // Move focus into the sheet
    const first = sheetRef.current && getFocusable(sheetRef.current)[0];
    (first ?? sheetRef.current)?.focus();
    if (scrollRef.current) scrollRef.current.scrollTop = savedScrollRef.current;

    function onKeyDown(e: KeyboardEvent) {
      if (!sheetRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      // Tab focus trap
      if (e.key === 'Tab') {
        const focusable = getFocusable(sheetRef.current);
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const heightClass = height === 'full' ? 'h-[92dvh]' : 'h-[50dvh]';
  const translateY = Math.max(0, dragY);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    startYRef.current = e.clientY;
    sheetHeightRef.current = sheetRef.current?.offsetHeight ?? 300;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (startYRef.current === null) return;
    const dy = e.clientY - startYRef.current;
    if (dy > 0) setDragY(dy);
  }

  function onPointerUp() {
    if (startYRef.current === null) return;
    // QNBS-v3: Dismiss when dragged more than 30% of sheet height (per plan spec).
    if (dragY > sheetHeightRef.current * 0.3) {
      onClose();
    } else {
      setDragY(0);
    }
    startYRef.current = null;
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={onClose} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          transform: `translateY(${translateY}px)`,
          transition: translateY === 0 ? 'transform 300ms ease-out' : 'none',
        }}
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-[var(--sc-surface-raised)] shadow-2xl flex flex-col ${heightClass} focus-visible:outline-none`}
      >
        {/* Drag handle */}
        <div
          className="flex-shrink-0 flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: 'none' }}
          aria-hidden="true"
        >
          <div className="w-10 h-1 rounded-full bg-[var(--sc-border-strong)]" />
        </div>

        {/* QNBS-v3: SR-only dismiss button — screen reader users cannot drag; this provides a keyboard-accessible close action. */}
        <button
          type="button"
          onClick={onClose}
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:right-3 focus:z-10 focus:rounded focus:px-2 focus:py-1 focus:text-xs focus:bg-[var(--sc-surface-overlay)] focus:text-[var(--sc-text-primary)] focus:ring-2 focus:ring-[var(--sc-ring-focus)]"
        >
          {t('common.close')}
        </button>

        {/* Title */}
        <h2
          id={titleId}
          className="flex-shrink-0 px-5 pb-3 text-base font-semibold text-[var(--sc-text-primary)]"
        >
          {title}
        </h2>

        {/* Content — scrollable */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-6">
          {children}
        </div>
      </div>
    </>
  );
};
