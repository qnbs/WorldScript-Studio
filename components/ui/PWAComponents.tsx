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
import { Icon } from './Icon';

// ────────────────────────────────────────────────────────────
// OfflineIndicator
// ────────────────────────────────────────────────────────────
// QNBS-v3: Badge title + banner ARIA via i18n — screen reader/locale parity with the rest of the app.
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
        bg-[var(--sc-warning-bg)] border border-[var(--sc-warning-border)]
        text-[var(--sc-warning-fg)] text-xs font-medium
        shadow-lg backdrop-blur-sm
        animate-fade-in-up
        max-w-xs
      "
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--sc-warning-fg)] opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--sc-warning-fg)]" />
        </span>
        <span className="font-semibold">{t('pwa.offlineBadgeTitle')}</span>
      </div>
      <p className="text-[var(--sc-warning-fg)]/80 leading-tight">
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
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: <header role="banner"> conflicts with noInteractiveElementToNoninteractiveRole; the div with explicit banner role is the correct pattern for a floating install prompt that must be a landmark without being nested in the page's top-level header. */}
      <div
        role="banner"
        aria-label={t('pwa.installBannerAriaLabel')}
        className="
        fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998]
        w-[calc(100%-2rem)] max-w-md
        flex items-center gap-3
        p-3 pl-4
        rounded-2xl
        bg-[var(--sc-surface-raised)]/90 border border-[var(--sc-border-subtle)]
        shadow-2xl backdrop-blur-md
        animate-fade-in-up
      "
      >
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--sc-accent)] flex items-center justify-center shadow-md">
          <Icon name="download" size="md" className="text-[var(--sc-text-on-accent)]" aria-hidden />
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--sc-text-primary)] leading-tight">
            {t('pwa.installApp')}
          </p>
          <p className="text-xs text-[var(--sc-text-muted)] leading-tight mt-0.5 truncate">
            {t('pwa.installDescription')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={dismissInstall}
            aria-label={t('pwa.closeBanner')}
            className="
            p-1.5 rounded-lg
            text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)]
            hover:bg-[var(--sc-surface-overlay)]
            transition-colors
          "
          >
            <Icon name="close" size="sm" aria-hidden />
          </button>
          <button
            type="button"
            onClick={installApp}
            className="
            px-3 py-1.5
            rounded-xl
            bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)]
            text-[var(--sc-text-on-accent)] text-xs font-semibold
            shadow-[0_4px_14px_0_var(--sc-accent-subtle)]
            hover:shadow-[0_6px_20px_var(--sc-accent-subtle)]
            border border-[var(--sc-accent)]/20
            transition-all active:scale-95
          "
          >
            {t('pwa.install')}
          </button>
        </div>
      </div>
    </>
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
        bg-[var(--sc-surface-raised)]/95 border border-[var(--sc-accent)]/30
        shadow-2xl shadow-[var(--sc-accent)]/10 backdrop-blur-md
        animate-fade-in-up
      "
    >
      {/* Update icon */}
      <div className="shrink-0 w-9 h-9 rounded-xl bg-[var(--sc-accent)]/20 border border-[var(--sc-accent)]/30 flex items-center justify-center mt-0.5">
        <Icon name="refresh" size="sm" className="text-[var(--sc-accent)]" aria-hidden />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--sc-text-primary)] leading-snug">
          {t('pwa.updateAvailable')}
        </p>
        <p className="text-xs text-[var(--sc-text-muted)] mt-0.5 leading-snug">
          {t('pwa.updateDescription')}
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={applyUpdate}
            className="
              px-3 py-1.5
              rounded-lg
              bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)]
              text-[var(--sc-text-on-accent)] text-xs font-semibold
              transition-all active:scale-95
            "
          >
            {t('pwa.updateNow')}
          </button>
          <button
            type="button"
            onClick={dismissUpdate}
            className="
              px-3 py-1.5
              rounded-lg
              text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)]
              hover:bg-[var(--sc-surface-overlay)]
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
        type="button"
        onClick={dismissUpdate}
        aria-label={t('pwa.closeNotification')}
        className="
          shrink-0 p-1 rounded-lg
          text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)]
          hover:bg-[var(--sc-surface-overlay)]
          transition-colors
        "
      >
        <Icon name="close" size="sm" aria-hidden />
      </button>
    </div>
  );
};
OfflineIndicator.displayName = 'OfflineIndicator';
PWAInstallBanner.displayName = 'PWAInstallBanner';
PWAUpdateToast.displayName = 'PWAUpdateToast';
