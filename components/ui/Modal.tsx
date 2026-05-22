import type React from 'react';
import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useTranslation } from '../../hooks/useTranslation';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'default' | 'lg' | 'xl' | undefined;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'default',
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(modalRef, { isActive: isOpen });

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClasses = {
    default: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  // QNBS-v3: Dialog-Rolle nur auf dem Panel; Backdrop bleibt presentation-only (klarere SR-Hierarchie).
  return (
    <div
      className="fixed inset-0 z-50 flex items-center sm:items-center justify-center p-0 sm:p-4 pointer-events-none"
      style={{ animation: 'fade-in 0.2s ease-out' }}
    >
      <button
        type="button"
        className="fixed inset-0 bg-[var(--sc-backdrop-strong)] backdrop-blur-sm pointer-events-auto cursor-default border-0 p-0 m-0"
        aria-label={t('common.close')}
        onClick={onClose}
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative z-10 pointer-events-auto bg-[var(--sc-surface-base)] sm:rounded-sc-lg shadow-[var(--sc-shadow-xl)] border-0 sm:border border-[var(--sc-border-subtle)] w-full ${sizeClasses[size]} h-full sm:h-auto sm:max-h-[90vh] flex flex-col`}
        style={{ animation: 'scale-in 0.2s ease-out' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--sc-border-subtle)] flex-shrink-0">
          <h2 id="modal-title" className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] transition-colors rounded-sc-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
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
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-grow">{children}</div>
      </div>
    </div>
  );
};
Modal.displayName = 'Modal';
