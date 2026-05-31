// QNBS-v3: GPU metrics panel — device class badge, WorkerBus telemetry, eco-mode toggle.
//          Gated by `enableAppHealthPanel` feature flag.

import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '../../app/hooks';
import { selectEnableAppHealthPanel } from '../../features/featureFlags/featureFlagsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import {
  type DeviceClass,
  getDeviceClass,
  getHealthReport,
} from '../../services/ai/deviceHealthService';
import { ecoModeService } from '../../services/ai/ecoModeService';
import { gpuResourceManager } from '../../services/ai/gpuResourceManager';
import { getLastAiFallbackReason } from '../../services/aiProviderService';

interface GpuState {
  deviceClass: DeviceClass;
  queueState: ReturnType<typeof gpuResourceManager.getQueueState>;
  isEco: boolean;
  fallbackReason: string;
}

function deviceClassColor(cls: DeviceClass): string {
  switch (cls) {
    case 'high-end':
      return 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]';
    case 'mid-range':
      return 'bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]';
    case 'low-end':
      return 'bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)]';
    default:
      return 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]';
  }
}

export const GpuMetricsPanel: FC = () => {
  const { t } = useTranslation();
  const enabled = useAppSelector(selectEnableAppHealthPanel);

  const [state, setState] = useState<GpuState>({
    deviceClass: 'unknown',
    queueState: gpuResourceManager.getQueueState(),
    isEco: ecoModeService.isEcoMode(),
    fallbackReason: '',
  });

  const refresh = useCallback(async () => {
    const report = await getHealthReport();
    const deviceClass = getDeviceClass(report);
    setState({
      deviceClass,
      queueState: gpuResourceManager.getQueueState(),
      isEco: ecoModeService.isEcoMode(),
      fallbackReason: getLastAiFallbackReason(),
    });
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!enabled) return null;

  function handleEcoToggle() {
    ecoModeService.setEcoModeExplicit(!state.isEco);
    setState((prev) => ({ ...prev, isEco: !prev.isEco }));
  }

  const { current, queue } = state.queueState;
  const deviceLabel =
    state.deviceClass === 'high-end'
      ? t<string>('settings.ai.gpu.deviceHighEnd')
      : state.deviceClass === 'mid-range'
        ? t<string>('settings.ai.gpu.deviceMidRange')
        : state.deviceClass === 'low-end'
          ? t<string>('settings.ai.gpu.deviceLowEnd')
          : t<string>('settings.ai.gpu.deviceUnknown');

  return (
    <section
      aria-label={t<string>('settings.ai.gpu.panelAriaLabel')}
      className="rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--sc-text-primary)]">
          {t<string>('settings.ai.gpu.panelTitle')}
        </h3>
        {/* Device class badge */}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${deviceClassColor(state.deviceClass)}`}
        >
          {deviceLabel}
        </span>
      </div>

      {/* GPU queue */}
      <div className="mb-3 space-y-1 text-xs text-[var(--sc-text-secondary)]">
        <div className="flex justify-between">
          <span>{t<string>('settings.ai.gpu.currentConsumer')}</span>
          <span className="font-mono">{current ?? '–'}</span>
        </div>
        <div className="flex justify-between">
          <span>{t<string>('settings.ai.gpu.waitingConsumers')}</span>
          <span className="font-mono">{queue.length > 0 ? queue.join(', ') : '–'}</span>
        </div>
      </div>

      {/* Fallback reason */}
      {state.fallbackReason && (
        <div
          role="alert"
          className="rounded-md border border-[var(--sc-warning-border)] bg-[var(--sc-warning-bg)] p-2 text-xs text-[var(--sc-warning-fg)]"
        >
          <strong>{t<string>('settings.ai.gpu.fallbackTitle')}</strong>
          <p className="mt-0.5">{state.fallbackReason}</p>
        </div>
      )}

      {/* Troubleshooting cards */}
      <div className="space-y-2">
        {state.deviceClass === 'low-end' && (
          <div className="rounded-md border border-[var(--sc-info-border)] bg-[var(--sc-info-bg)] p-2 text-xs text-[var(--sc-info-fg)]">
            {t<string>('settings.ai.gpu.troubleshootLowEnd')}
          </div>
        )}
        {state.queueState.current !== null && state.queueState.queue.length > 0 && (
          <div className="rounded-md border border-[var(--sc-warning-border)] bg-[var(--sc-warning-bg)] p-2 text-xs text-[var(--sc-warning-fg)]">
            {t<string>('settings.ai.gpu.troubleshootQueue')}
          </div>
        )}
        {state.isEco && (
          <div className="rounded-md border border-[var(--sc-info-border)] bg-[var(--sc-info-bg)] p-2 text-xs text-[var(--sc-info-fg)]">
            {t<string>('settings.ai.gpu.troubleshootEco')}
          </div>
        )}
      </div>

      {/* Eco mode toggle */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="eco-mode-toggle"
          className="text-xs font-medium text-[var(--sc-text-secondary)]"
        >
          {t<string>('settings.ai.gpu.ecoModeLabel')}
        </label>
        <button
          id="eco-mode-toggle"
          type="button"
          role="switch"
          aria-checked={state.isEco}
          onClick={handleEcoToggle}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none ${
            state.isEco ? 'bg-[var(--sc-accent)]' : 'bg-[var(--sc-border-strong)]'
          }`}
        >
          <span className="sr-only">
            {state.isEco
              ? t<string>('settings.ai.gpu.ecoModeOn')
              : t<string>('settings.ai.gpu.ecoModeOff')}
          </span>
          <span
            aria-hidden="true"
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--sc-surface-base)] shadow transition-transform ${
              state.isEco ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </section>
  );
};
