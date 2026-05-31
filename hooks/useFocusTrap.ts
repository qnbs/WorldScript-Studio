import { type RefObject, useEffect, useRef } from 'react';

export interface UseFocusTrapOptions {
  isActive: boolean;
  /** Restore focus to the previously focused element when the trap deactivates. */
  restoreFocus?: boolean;
}

/**
 * Keeps Tab cycling inside `containerRef` while active (dialog / palette pattern).
 * QNBS-v3: Shared focus trap for modal + command palette (APG).
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { isActive, restoreFocus = true }: UseFocusTrapOptions,
): void {
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return undefined;

    const container = containerRef.current;
    previouslyFocusedElement.current = document.activeElement as HTMLElement;

    let handleTabKey: ((e: KeyboardEvent) => void) | undefined;

    if (container) {
      const focusableElements = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'));
      const firstElement = focusableElements[0];

      if (firstElement) {
        firstElement.focus();
      } else {
        container.focus();
      }

      // QNBS-v3: Re-query focusable elements on each Tab press — modals can add/remove nodes dynamically (e.g. expanding settings sections).
      handleTabKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const live = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (live.length === 0) {
          e.preventDefault();
          return;
        }
        const first = live[0]!;
        const last = live[live.length - 1]!;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            last.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
            e.preventDefault();
          }
        }
      };

      container.addEventListener('keydown', handleTabKey);
    }

    return () => {
      if (container && handleTabKey) {
        container.removeEventListener('keydown', handleTabKey);
      }
      if (restoreFocus) {
        previouslyFocusedElement.current?.focus();
      }
    };
  }, [isActive, containerRef, restoreFocus]);
}
