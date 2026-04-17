/**
 * PWA UI Components
 *
 * <PWAInstallBanner>   — slide-in banner; triggers install prompt
 * <PWAUpdateToast>     — floating toast; applies SW update
 * <OfflineIndicator>   — subtle pill badge shown when offline
 */

import type { FC } from 'react';
import { usePWA } from '../../hooks/usePWA';
import { useTranslation } from '../../hooks/useTranslation';

// ────────────────────────────────────────────────────────────
// OfflineIndicator
// ────────────────────────────────────────────────────────────
export const OfflineIndicator: FC = () => {
  const { isOffline } = usePWA();
  const { t } = useTranslation();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="
        fixed bottom-4 right-4 z-[9999]
        flex flex-col gap-1
        px-4 py-3
        rounded-xl
        bg-amber-500/20 border border-amber-500/40
        text-amber-400 text-xs font-medium
        shadow-lg backdrop-blur-sm
        animate-fade-in-up
        max-w-xs
      "
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="font-semibold">Offline</span>
      </div>
      <p className="text-amber-300/80 leading-tight">
        {t('pwa.offlineAiUnavailable')}
        <br />
        {t('pwa.offlineWorksContinue')}
      </p>
    </div>
  );
};

// ────────────────────────────────────────────────────────────
// PWAInstallBanner
// ────────────────────────────────────────────────────────────
export const PWAInstallBanner: FC = () => {
  const { isInstallable, installApp, dismissInstall } = usePWA();
  const { t } = useTranslation();

  if (!isInstallable) return null;

  return (
    <div
      role="banner"
      aria-label="Install StoryCraft Studio"
      className="
        fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998]
        w-[calc(100%-2rem)] max-w-md
        flex items-center gap-3
        p-3 pl-4
        rounded-2xl
        bg-[var(--background-secondary)]/90 border border-[var(--border-primary)]
        shadow-2xl backdrop-blur-md
        animate-fade-in-up
      "
    >
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--foreground-primary)] leading-tight">
          {t('pwa.installApp')}
        </p>
        <p className="text-xs text-[var(--foreground-muted)] leading-tight mt-0.5 truncate">
          {t('pwa.installDescription')}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={dismissInstall}
          aria-label={t('pwa.closeBanner')}
          className="
            p-1.5 rounded-lg
            text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)]
            hover:bg-[var(--background-tertiary)]
            transition-colors
          "
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <button
          onClick={installApp}
          className="
            px-3 py-1.5
            rounded-xl
            bg-[var(--background-interactive)] hover:bg-[var(--background-interactive-hover)]
            text-white text-xs font-semibold
            shadow-[0_4px_14px_0_rgba(99,102,241,0.35)]
            hover:shadow-[0_6px_20px_rgba(99,102,241,0.25)]
            border border-indigo-500/20
            transition-all active:scale-95
          "
        >
          {t('pwa.install')}
        </button>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────
// PWAUpdateToast
// ────────────────────────────────────────────────────────────
export const PWAUpdateToast: FC = () => {
  const { isUpdateAvailable, applyUpdate, dismissUpdate } = usePWA();
  const { t } = useTranslation();

  if (!isUpdateAvailable) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="
        fixed top-4 right-4 z-[9999]
        w-80
        flex items-start gap-3
        p-4
        rounded-2xl
        bg-[var(--background-secondary)]/95 border border-indigo-500/30
        shadow-2xl shadow-indigo-500/10 backdrop-blur-md
        animate-fade-in-up
      "
    >
      {/* Update icon */}
      <div className="shrink-0 w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mt-0.5">
        <svg
          className="w-4 h-4 text-indigo-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
          />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--foreground-primary)] leading-snug">
          {t('pwa.updateAvailable')}
        </p>
        <p className="text-xs text-[var(--foreground-muted)] mt-0.5 leading-snug">
          {t('pwa.updateDescription')}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={applyUpdate}
            className="
              px-3 py-1.5
              rounded-lg
              bg-indigo-600 hover:bg-indigo-500
              text-white text-xs font-semibold
              transition-all active:scale-95
            "
          >
            {t('pwa.updateNow')}
          </button>
          <button
            onClick={dismissUpdate}
            className="
              px-3 py-1.5
              rounded-lg
              text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)]
              hover:bg-[var(--background-tertiary)]
              text-xs font-medium
              transition-colors
            "
          >
            {t('pwa.later')}
          </button>
        </div>
      </div>

      {/* Close */}
      <button
        onClick={dismissUpdate}
        aria-label={t('pwa.closeNotification')}
        className="
          shrink-0 p-1 rounded-lg
          text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)]
          hover:bg-[var(--background-tertiary)]
          transition-colors
        "
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
