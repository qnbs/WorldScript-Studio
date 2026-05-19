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

interface GpuState {
  deviceClass: DeviceClass;
  queueState: ReturnType<typeof gpuResourceManager.getQueueState>;
  isEco: boolean;
}

function deviceClassColor(cls: DeviceClass): string {
  switch (cls) {
    case 'high-end':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'mid-range':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
    case 'low-end':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export const GpuMetricsPanel: FC = () => {
  const { t } = useTranslation();
  const enabled = useAppSelector(selectEnableAppHealthPanel);

  const [state, setState] = useState<GpuState>({
    deviceClass: 'unknown',
    queueState: gpuResourceManager.getQueueState(),
    isEco: ecoModeService.isEcoMode(),
  });

  const refresh = useCallback(async () => {
    const report = await getHealthReport();
    const deviceClass = getDeviceClass(report);
    setState({
      deviceClass,
      queueState: gpuResourceManager.getQueueState(),
      isEco: ecoModeService.isEcoMode(),
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
      className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
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
      <div className="mb-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        <div className="flex justify-between">
          <span>{t<string>('settings.ai.gpu.currentConsumer')}</span>
          <span className="font-mono">{current ?? '–'}</span>
        </div>
        <div className="flex justify-between">
          <span>{t<string>('settings.ai.gpu.waitingConsumers')}</span>
          <span className="font-mono">{queue.length > 0 ? queue.join(', ') : '–'}</span>
        </div>
      </div>

      {/* Eco mode toggle */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="eco-mode-toggle"
          className="text-xs font-medium text-slate-700 dark:text-slate-300"
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
            state.isEco ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span className="sr-only">
            {state.isEco
              ? t<string>('settings.ai.gpu.ecoModeOn')
              : t<string>('settings.ai.gpu.ecoModeOff')}
          </span>
          <span
            aria-hidden="true"
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              state.isEco ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </section>
  );
};
