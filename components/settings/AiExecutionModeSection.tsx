import { detectWebGpuSupport } from '@domain/ai-core';
import type { FC } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { useAnnounce } from '../../contexts/LiveRegionContext';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import type { AiMode } from '../../types';
import { Card, CardContent, CardHeader } from '../ui/Card';

const RADIO_GROUP_NAME = 'ai-execution-mode';

interface ModeCardProps {
  mode: AiMode;
  active: boolean;
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
  onSelect: (mode: AiMode) => void;
}

// QNBS-v3: A native radio input (visually hidden, shared `name`) backs each card — this gives free
// roving-tabindex + arrow-key navigation + correct AT semantics, with the card as its styled label.
const ModeCard: FC<ModeCardProps> = ({ mode, active, icon, titleKey, descKey, onSelect }) => {
  const { t } = useTranslation();
  return (
    <label
      className={`relative block w-full cursor-pointer rounded-xl border-2 p-4 text-start transition-all duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--sc-border-focus)] ${
        active
          ? 'border-[var(--sc-accent)] bg-[var(--sc-accent)]/10 shadow-md'
          : 'border-[var(--sc-border-subtle)] bg-[var(--sc-surface-elevated)] hover:border-[var(--sc-accent)]/50 hover:bg-[var(--sc-surface-overlay)]'
      }`}
    >
      <input
        type="radio"
        name={RADIO_GROUP_NAME}
        value={mode}
        checked={active}
        onChange={() => onSelect(mode)}
        className="sr-only"
      />
      {active && (
        <span
          className="absolute end-3 top-3 h-2.5 w-2.5 rounded-full bg-[var(--sc-accent)]"
          aria-hidden="true"
        />
      )}
      <div className="mb-2 flex justify-center text-[var(--sc-accent)]">{icon}</div>
      <p
        className={`mb-1 text-center text-sm font-semibold ${active ? 'text-[var(--sc-accent)]' : 'text-[var(--sc-text-primary)]'}`}
      >
        {t(titleKey)}
      </p>
      <p className="text-center text-xs leading-relaxed text-[var(--sc-text-secondary)]">
        {t(descKey)}
      </p>
    </label>
  );
};
ModeCard.displayName = 'ModeCard';

const MODES: {
  mode: AiMode;
  titleKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    mode: 'cloud',
    titleKey: 'settings.aiMode.cloud',
    descKey: 'settings.aiMode.cloudDesc',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
        />
      </svg>
    ),
  },
  {
    mode: 'local',
    titleKey: 'settings.aiMode.local',
    descKey: 'settings.aiMode.localDesc',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
        />
      </svg>
    ),
  },
  {
    mode: 'hybrid',
    titleKey: 'settings.aiMode.hybrid',
    descKey: 'settings.aiMode.hybridDesc',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
        />
      </svg>
    ),
  },
  {
    mode: 'eco',
    titleKey: 'settings.aiMode.eco',
    descKey: 'settings.aiMode.ecoDesc',
    icon: (
      <svg
        className="h-8 w-8"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
        />
      </svg>
    ),
  },
];

export const AiExecutionModeSection: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const announce = useAnnounce();
  const aiMode = (useAppSelector((s) => s.settings.aiMode) ?? 'hybrid') as AiMode;

  // QNBS-v3: WebGPU presence is a synchronous capability check (`'gpu' in navigator`); read once.
  const [hasWebGpu] = useState<boolean>(() => {
    try {
      return detectWebGpuSupport();
    } catch {
      return false;
    }
  });

  // QNBS-v3: Track connectivity via online/offline events (not a one-shot navigator.onLine read) so
  // the per-mode hint stays accurate without a stale value — same pattern as OpenRouterSection.
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const update = () =>
      setIsOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const selectMode = useCallback(
    (mode: AiMode) => {
      if (mode === aiMode) return;
      dispatch(settingsActions.setAiMode(mode));
      // QNBS-v3: Announce the new mode to screen readers (reuses settings.aiMode.activeLabel).
      announce(
        t('settings.aiMode.activeLabel', {
          mode: t(`settings.aiMode.${mode}` as Parameters<typeof t>[0]),
        }),
        'polite',
      );
    },
    [aiMode, dispatch, announce, t],
  );

  // QNBS-v3: Contextual capability hint for the active mode — surfaces real runtime constraints
  // (WebGPU absent for on-device modes, offline for cloud/hybrid) instead of silently mis-routing.
  const hint = useMemo<{ tone: 'warning' | 'info'; text: string } | null>(() => {
    if ((aiMode === 'local' || aiMode === 'eco') && !hasWebGpu) {
      return { tone: 'warning', text: t('settings.aiMode.hint.webgpuMissing') };
    }
    if (aiMode === 'cloud' && isOffline) {
      return { tone: 'warning', text: t('settings.aiMode.hint.cloudOffline') };
    }
    if (aiMode === 'hybrid' && isOffline) {
      return { tone: 'info', text: t('settings.aiMode.hint.hybridOffline') };
    }
    return null;
  }, [aiMode, hasWebGpu, isOffline, t]);

  return (
    <Card>
      <CardHeader>
        <h2 id="ai-mode-heading" className="text-base font-semibold text-[var(--sc-text-primary)]">
          {t('settings.aiMode.title')}
        </h2>
        <p className="mt-1 text-sm text-[var(--sc-text-secondary)]">
          {t('settings.aiMode.description')}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div
          role="radiogroup"
          aria-labelledby="ai-mode-heading"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {MODES.map(({ mode, titleKey, descKey, icon }) => (
            <ModeCard
              key={mode}
              mode={mode}
              active={aiMode === mode}
              icon={icon}
              titleKey={titleKey}
              descKey={descKey}
              onSelect={selectMode}
            />
          ))}
        </div>

        {hint && (
          <p
            role="status"
            aria-live="polite"
            className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
              hint.tone === 'warning'
                ? 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]'
                : 'bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]'
            }`}
          >
            {hint.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
