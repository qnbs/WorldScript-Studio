/**
 * AiModeIndicator — compact chip showing active AI execution mode in the Copilot panel header.
 * QNBS-v3: Surfaces the current aiMode so users don't need to navigate to Settings to verify
 * routing state (G9). Shows OpenRouter status when enabled, including circuit-breaker state.
 */

import type { FC } from 'react';
import { useAppSelector } from '../../app/hooks';
import { useTranslation } from '../../hooks/useTranslation';
import { getApproxRpm, isCircuitOpen, isOpenRouterFreeModel } from '../../services/ai';
import type { AiMode } from '../../types';

// QNBS-v3: Semantic color tokens per mode — no hardcoded colors, works across all themes.
const MODE_TOKEN: Record<AiMode, string> = {
  cloud: 'text-[var(--sc-accent)] bg-[var(--sc-accent)]/10',
  local: 'text-[var(--sc-success-fg)] bg-[var(--sc-success-bg)]',
  hybrid: 'text-[var(--sc-info-fg)] bg-[var(--sc-info-bg)]',
  eco: 'text-[var(--sc-warning-fg)] bg-[var(--sc-warning-bg)]',
};

const MODE_DOT_TOKEN: Record<AiMode, string> = {
  cloud: 'bg-[var(--sc-accent)]',
  local: 'bg-[var(--sc-success-fg)]',
  hybrid: 'bg-[var(--sc-info-fg)]',
  eco: 'bg-[var(--sc-warning-fg)]',
};

export const AiModeIndicator: FC = () => {
  const { t } = useTranslation();
  const aiMode = useAppSelector((s) => s.settings.aiMode ?? 'hybrid');
  const openRouter = useAppSelector((s) => s.settings.openRouter);

  const mode = aiMode as AiMode;
  const isOpenRouterActive = openRouter?.enabled && mode !== 'local';
  const circuitOpen = isOpenRouterActive ? isCircuitOpen() : false;
  const approxRpm = isOpenRouterActive ? getApproxRpm() : 0;
  const isFreeModel = openRouter?.preferredModel
    ? isOpenRouterFreeModel(openRouter.preferredModel)
    : false;

  // Build label: "Hybrid · OpenRouter Free" or just "Local"
  const modeLabel = t(`settings.aiMode.indicator.${mode}` as Parameters<typeof t>[0]);
  let label: string;
  if (isOpenRouterActive && circuitOpen) {
    // QNBS-v3: localized compact circuit-open suffix (was hardcoded "OR ⚠").
    label = `${modeLabel} · ${t('settings.aiMode.indicator.orShort' as Parameters<typeof t>[0])}`;
  } else if (isOpenRouterActive) {
    // QNBS-v3: localized OpenRouter label (was hardcoded "OpenRouter Free"/"OpenRouter").
    const orLabel = isFreeModel
      ? t('settings.aiMode.indicator.openRouterFree' as Parameters<typeof t>[0])
      : t('settings.aiMode.indicator.openRouter' as Parameters<typeof t>[0]);
    label = `${modeLabel} · ${orLabel}`;
  } else {
    label = modeLabel;
  }

  // Tooltip
  let tooltip: string;
  if (isOpenRouterActive && circuitOpen) {
    tooltip = t('settings.aiMode.indicator.orCircuitOpen' as Parameters<typeof t>[0]);
  } else if (isOpenRouterActive) {
    // QNBS-v3: localized RPM hint (was hardcoded "/20 RPM"); count is locale-formatted by t().
    const rpmText =
      approxRpm > 0
        ? ` (${t('settings.aiMode.indicator.rpm' as Parameters<typeof t>[0], { count: approxRpm })})`
        : '';
    tooltip = `${t(`settings.aiMode.indicator.tooltip.${mode}` as Parameters<typeof t>[0])}${rpmText}`;
  } else {
    tooltip = t(`settings.aiMode.indicator.tooltip.${mode}` as Parameters<typeof t>[0]);
  }

  return (
    <span
      role="status"
      aria-label={`${t('settings.aiMode.indicatorAriaLabel' as Parameters<typeof t>[0])}: ${label}`}
      title={tooltip}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none select-none ${MODE_TOKEN[mode]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${circuitOpen ? 'bg-[var(--sc-danger-fg)] animate-pulse' : MODE_DOT_TOKEN[mode]}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
};
