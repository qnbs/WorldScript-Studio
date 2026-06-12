import type React from 'react';
import type { FC } from 'react';
import { createContext, useContext, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useCommandExecutor } from '../../contexts/CommandExecutorContext';
import type { Notification, NotificationType } from '../../features/status/statusSlice';
import { statusActions } from '../../features/status/statusSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from './Icon';

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

  const ICON_NAME: Record<NotificationType, 'success' | 'error' | 'info'> = {
    success: 'success',
    error: 'error',
    info: 'info',
  };

  return (
    <div
      className={`relative w-full max-w-sm rounded-sc-md shadow-2xl bg-[var(--sc-surface-raised)]/80 backdrop-blur-md border animate-toast-slide-up overflow-hidden ${typeClasses[message.type]}`}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <Icon name={ICON_NAME[message.type]} size="lg" aria-hidden />
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
              <Icon name="close" size="md" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div
        className={`absolute bottom-0 start-0 h-1 animate-toast-progress ${progressClasses[message.type]}`}
      />
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
