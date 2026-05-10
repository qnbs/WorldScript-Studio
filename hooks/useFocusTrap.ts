import { type RefObject, useEffect, useRef } from 'react';

export interface UseFocusTrapOptions {
  isActive: boolean;
  /** Restore focus to the previously focused element when the trap deactivates. */
  restoreFocus?: boolean;
}

/**
 * Keeps Tab cycling inside `containerRef` while active (dialog / palette pattern).
 * QNBS-v3: Gemeinsame Fokus-Falle für Modal + Command Palette (APG).
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
      const lastElement = focusableElements[focusableElements.length - 1];

      if (firstElement) {
        firstElement.focus();
      } else {
        container.focus();
      }

      handleTabKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        if (e.shiftKey) {
          if (document.activeElement === firstElement && lastElement) {
            lastElement.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastElement && firstElement) {
            firstElement.focus();
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
