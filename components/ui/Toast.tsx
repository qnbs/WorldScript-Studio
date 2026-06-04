import type React from 'react';
import type { FC } from 'react';
import { createContext, useContext, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useCommandExecutor } from '../../contexts/CommandExecutorContext';
import type { Notification, NotificationType } from '../../features/status/statusSlice';
import { statusActions } from '../../features/status/statusSlice';
import { useTranslation } from '../../hooks/useTranslation';

// Context remains to provide a convenient hook API for components
interface ToastContextType {
  addToast: (
    type: NotificationType,
    title: string,
    description?: string,
    options?: { actionLabel?: string; commandId?: string },
  ) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if used outside provider, though ideally shouldn't happen
    // We can also just use dispatch directly in components if we wanted to remove the Context entirely,
    // but keeping the hook API is cleaner for the existing codebase.
    throw new Error('useToast must be used within a ToastProvider');
  }

  return {
    success: (
      title: string,
      description?: string,
      options?: { actionLabel?: string; commandId?: string },
    ) => context.addToast('success', title, description, options),
    error: (
      title: string,
      description?: string,
      options?: { actionLabel?: string; commandId?: string },
    ) => context.addToast('error', title, description, options),
    info: (
      title: string,
      description?: string,
      options?: { actionLabel?: string; commandId?: string },
    ) => context.addToast('info', title, description, options),
  };
};

const ToastItem: FC<{
  message: Notification;
  onDismiss: (id: string) => void;
}> = ({ message, onDismiss }) => {
  const { t } = useTranslation();
  const runCommand = useCommandExecutor();
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(message.id);
    }, 5000); // Auto-dismiss after 5 seconds

    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  // QNBS-v3: Alpha-bg pattern replaces dark: prefixes — semantic colors visible on all appearance presets.
  const typeClasses = {
    success:
      'bg-[var(--sc-success-bg)] border-[var(--sc-success-fg)]/30 text-[var(--sc-success-fg)]',
    error: 'bg-[var(--sc-danger-bg)] border-[var(--sc-danger-fg)]/30 text-[var(--sc-danger-fg)]',
    info: 'bg-[var(--sc-info-bg)] border-[var(--sc-info-fg)]/30 text-[var(--sc-info-fg)]',
  };

  const progressClasses = {
    success: 'bg-[var(--sc-success-fg)]',
    error: 'bg-[var(--sc-danger-fg)]',
    info: 'bg-[var(--sc-info-fg)]',
  };

  const ICONS = {
    success: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    ),
    error: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    ),
    info: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    ),
  };

  return (
    <div
      className={`relative w-full max-w-sm rounded-sc-md shadow-2xl bg-[var(--sc-surface-raised)]/80 backdrop-blur-md border animate-toast-slide-up overflow-hidden ${typeClasses[message.type]}`}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              {ICONS[message.type]}
            </svg>
          </div>
          <div className="ms-3 w-0 flex-1 pt-0.5">
            <p className="text-sm font-bold text-[var(--sc-text-primary)]">{message.title}</p>
            {message.description && (
              <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">{message.description}</p>
            )}
            {message.actionLabel && message.commandId ? (
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-[var(--sc-accent)] hover:underline"
                onClick={() => {
                  runCommand(message.commandId as string);
                  onDismiss(message.id);
                }}
              >
                {message.actionLabel}
              </button>
            ) : null}
          </div>
          <div className="ms-4 flex-shrink-0 flex">
            <button
              type="button"
              onClick={() => onDismiss(message.id)}
              aria-label={t('common.close')}
              className="inline-flex rounded-sc-sm text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--sc-ring-focus)]"
            >
              <span className="sr-only">Close</span>
              <svg
                className="h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div
        className={`absolute bottom-0 start-0 h-1 ${progressClasses[message.type]}`}
        style={{ animation: 'shrink-width 5s linear forwards' }}
      ></div>
      <style>{`
        @keyframes toast-slide-up {
            from { opacity: 0; transform: translateY(12px) scale(0.97); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes shrink-width {
            from { width: 100%; }
            to { width: 0%; }
        }
        .animate-toast-slide-up {
            animation: toast-slide-up 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export const ToastProvider: FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const notifications = useAppSelector((state) => state.status.notifications);

  const addToast = (
    type: NotificationType,
    title: string,
    description?: string,
    options?: { actionLabel?: string; commandId?: string },
  ) => {
    dispatch(
      statusActions.addNotification({
        type,
        title,
        ...(description !== undefined ? { description } : {}),
        ...(options?.actionLabel ? { actionLabel: options.actionLabel } : {}),
        ...(options?.commandId ? { commandId: options.commandId } : {}),
      }),
    );
  };

  const removeToast = (id: string) => {
    dispatch(statusActions.removeNotification(id));
  };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        aria-label={t('common.notifications')}
        className="fixed inset-0 flex items-end px-4 py-6 pointer-events-none sm:p-6 sm:items-end z-50"
      >
        <div className="w-full flex flex-col items-center space-y-4 sm:items-end">
          {notifications.map((toast) => (
            <ToastItem key={toast.id} message={toast} onDismiss={removeToast} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
};
ToastProvider.displayName = 'ToastProvider';
