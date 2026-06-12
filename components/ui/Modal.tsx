import type React from 'react';
import { useEffect, useId, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTranslation } from '../../hooks/useTranslation';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'default' | 'lg' | 'xl' | undefined;
  /**
   * When false the backdrop and close button are hidden from keyboard and AT.
   * Use for modals that require explicit user action before they can be dismissed
   * (e.g. the IDB unlock modal that must be unlocked before proceeding).
   * Defaults to true.
   */
  isDismissible?: boolean;
  /**
   * ARIA role for the dialog container. Use 'alertdialog' for destructive-action
   * confirmations so screen readers immediately announce the modal as an alert.
   * Defaults to 'dialog'.
   */
  variant?: 'dialog' | 'alertdialog';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'default',
  isDismissible = true,
  variant = 'dialog',
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  // QNBS-v3: useId produces a unique-per-instance id; avoids duplicate aria-labelledby
  // when two modals are mounted simultaneously (e.g. PassphraseModal + IdbUnlockModal).
  const titleId = useId();

  useFocusTrap(modalRef, { isActive: isOpen });

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEsc = (event: KeyboardEvent) => {
      // QNBS-v3: non-dismissible modals ignore Escape — the no-op onClose already handles
      // this, but skipping the call avoids spurious UI flicker on some browsers.
      if (event.key === 'Escape' && isDismissible) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose, isDismissible]);

  if (!isOpen) return null;

  const sizeClasses = {
    default: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  // QNBS-v3: Dialog-Rolle nur auf dem Panel; Backdrop bleibt presentation-only (klarere SR-Hierarchie).
  return (
    <div className="fixed inset-0 z-50 flex items-center sm:items-center justify-center p-0 sm:p-4 pointer-events-none animate-modal-backdrop">
      {/* QNBS-v3: non-dismissible modals hide backdrop from keyboard and AT — it announces
          as "Close" but does nothing, which is misleading for screen reader users. */}
      <button
        type="button"
        className="fixed inset-0 bg-[var(--sc-backdrop-strong)] backdrop-blur-sm pointer-events-auto cursor-default border-0 p-0 m-0"
        aria-label={isDismissible ? t('common.close') : undefined}
        aria-hidden={!isDismissible}
        tabIndex={isDismissible ? 0 : -1}
        onClick={isDismissible ? onClose : undefined}
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role resolves to dialog | alertdialog at runtime; both support aria-modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        role={variant}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative z-10 pointer-events-auto bg-[var(--sc-surface-base)] sm:rounded-sc-lg shadow-[var(--sc-shadow-xl)] border-0 sm:border border-[var(--sc-border-subtle)] w-full ${sizeClasses[size]} h-full sm:h-auto sm:max-h-[90vh] flex flex-col animate-modal-panel`}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--sc-border-subtle)] flex-shrink-0">
          <h2 id={titleId} className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {title}
          </h2>
          {/* QNBS-v3: omit close button for non-dismissible modals — showing a non-functional
              close button is misleading for keyboard and AT users. */}
          {isDismissible && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 -me-2 text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] transition-colors rounded-sc-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              aria-label={t('common.close')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-grow">{children}</div>
      </div>
    </div>
  );
};
Modal.displayName = 'Modal';
