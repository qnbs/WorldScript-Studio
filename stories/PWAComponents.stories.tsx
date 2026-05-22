import type { Meta, StoryObj } from '@storybook/react';

// QNBS-v3: @storybook/test not installed; fn() in story defaults is a presentational noop.
const fn = (): (() => void) => () => {};

import { I18nMockProvider } from './storybookProviders';

/**
 * PWAComponents cannot use the real usePWA hook (requires ServiceWorker + navigator.onLine).
 * These stories render extracted presentational versions to verify theming and layout.
 */

// ── OfflineIndicator (presentational) ────────────────────────────────────────
const OfflineBadge = () => (
  <div
    role="status"
    aria-live="polite"
    className="flex flex-col gap-1 px-4 py-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 text-xs font-medium shadow-lg backdrop-blur-sm max-w-xs"
  >
    <div className="flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
      </span>
      Offline — changes saved locally
    </div>
  </div>
);

// ── InstallBanner (presentational) ───────────────────────────────────────────
const InstallBanner = ({
  onInstall = fn(),
  onDismiss = fn(),
}: {
  onInstall?: () => void;
  onDismiss?: () => void;
}) => (
  <aside
    aria-label="Install app"
    className="fixed bottom-20 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm z-50 rounded-xl bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] p-4 shadow-2xl"
  >
    <p className="text-sm font-medium text-[var(--sc-text-primary)] mb-3">
      Install StoryCraft Studio
    </p>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onInstall}
        className="flex-1 text-xs py-1.5 rounded-sc-md bg-[var(--sc-accent)] text-white hover:bg-[var(--sc-accent-hover)]"
      >
        Install
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs py-1.5 px-3 rounded-sc-md border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)]"
      >
        Not now
      </button>
    </div>
  </aside>
);

const meta: Meta = {
  title: 'UI/PWAComponents',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <I18nMockProvider>
        <Story />
      </I18nMockProvider>
    ),
  ],
};
export default meta;

export const Offline: StoryObj = {
  render: () => (
    <div className="p-8">
      <OfflineBadge />
    </div>
  ),
  name: 'OfflineIndicator',
};

export const Install: StoryObj = {
  render: () => (
    <div className="relative h-48">
      <InstallBanner />
    </div>
  ),
  name: 'InstallBanner',
};
