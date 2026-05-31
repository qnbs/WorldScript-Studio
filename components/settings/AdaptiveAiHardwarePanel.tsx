// QNBS-v3: B3 — Adaptive AI hardware panel — device capabilities, backend selection, warmed models.
//          Gated by `enableAdaptiveAiEngine` feature flag.

import type { FC } from 'react';
import { useAdaptiveAi } from '../../hooks/useAdaptiveAi';
import { useTranslation } from '../../hooks/useTranslation';
import type { ComputeBackend } from '../../services/ai/localAiDeviceProfiler';

// ----------------------------------------------------------------------------
// Helper: backend badge colour
// ----------------------------------------------------------------------------

function backendBadgeClass(backend: ComputeBackend): string {
  if (backend.includes('webnn') || backend.includes('directml')) {
    return 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]';
  }
  if (backend.includes('webgpu')) {
    return 'bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]';
  }
  if (backend.includes('wasm') || backend === 'heuristic') {
    return 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]';
  }
  return 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]';
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export const AdaptiveAiHardwarePanel: FC = () => {
  const { t } = useTranslation();
  const { enabled, computeShadersEnabled, isEco, deviceProfile, warmedModels } = useAdaptiveAi();

  if (!enabled) return null;

  const profile = deviceProfile;

  return (
    <section
      aria-label={t('settings.ai.adaptive.title')}
      className="rounded-sc-xl border border-[var(--sc-border-muted)] bg-[var(--sc-surface-card)] p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sc-sm font-semibold text-[var(--sc-text-primary)]">
            {t('settings.ai.adaptive.title')}
          </h3>
          <p className="text-sc-xs text-[var(--sc-text-secondary)] mt-0.5">
            {t('settings.ai.adaptive.description')}
          </p>
        </div>
        {/* Eco-mode indicator */}
        {isEco && (
          <span
            role="status"
            className="text-xs px-2 py-1 rounded-sc-lg bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]"
          >
            {t('settings.ai.gpu.ecoModeLabel')}
          </span>
        )}
      </div>

      {/* Loading state */}
      {!profile && (
        <p className="text-sc-xs text-[var(--sc-text-secondary)] animate-pulse">
          {t('settings.ai.adaptive.notDetected')}
        </p>
      )}

      {/* Device capabilities */}
      {profile && (
        <div className="space-y-2">
          {/* Hardware summary row */}
          <div className="flex flex-wrap gap-2 text-sc-xs">
            {/* VRAM tier */}
            <span className="px-2 py-0.5 rounded-sc-lg bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]">
              {t('settings.ai.adaptive.vramTier')}: {profile.webgpu.vramTier ?? 'N/A'}
            </span>
            {/* Memory */}
            <span className="px-2 py-0.5 rounded-sc-lg bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]">
              {t('settings.ai.adaptive.memoryPressure')}: {profile.memoryTier}
            </span>
            {/* CPU */}
            <span className="px-2 py-0.5 rounded-sc-lg bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]">
              {t('settings.ai.adaptive.cpuCores')}: {profile.cpuCores}
            </span>
            {/* Battery */}
            {profile.battery.level !== null && (
              <span className="px-2 py-0.5 rounded-sc-lg bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]">
                {t('settings.ai.adaptive.batteryLevel')}: {Math.round(profile.battery.level * 100)}%
                {profile.battery.charging ? ' ⚡' : ''}
              </span>
            )}
          </div>

          {/* Recommended backend */}
          <div className="flex items-center gap-2">
            <span className="text-sc-xs text-[var(--sc-text-secondary)]">
              {t('settings.ai.adaptive.backends')}:
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-sc-lg font-mono ${backendBadgeClass(profile.recommendedBackend)}`}
            >
              {profile.recommendedBackend}
            </span>
            {computeShadersEnabled && (
              <span className="text-xs px-2 py-0.5 rounded-sc-lg bg-[var(--sc-info-bg)] text-[var(--sc-info-fg)]">
                WebGPU shaders ✓
              </span>
            )}
          </div>

          {/* Capability badges */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: 'WebGPU', ok: profile.webgpu.available },
              { label: 'WebNN', ok: profile.webnn.available },
              { label: 'DirectML', ok: profile.directml.available },
              { label: 'Compute Shaders', ok: profile.computeShaders.available },
            ].map(({ label, ok }) => (
              <span
                key={label}
                title={`${label}: ${ok ? 'available' : 'unavailable'}`}
                className={`text-xs px-1.5 py-0.5 rounded-sc-lg ${
                  ok
                    ? 'bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]'
                    : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-tertiary)] line-through'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Warmed models */}
      {warmedModels.length > 0 && (
        <div>
          <p className="text-sc-xs font-medium text-[var(--sc-text-secondary)] mb-1">
            {t('settings.ai.adaptive.warmedModels')}
          </p>
          <ul className="space-y-0.5">
            {warmedModels.map((m) => (
              <li
                key={`${m.backend}:${m.modelId}`}
                className="text-sc-xs text-[var(--sc-text-secondary)] font-mono truncate"
              >
                <span className="text-[var(--sc-text-tertiary)]">{m.backend}</span>
                {' → '}
                {m.modelId}
              </li>
            ))}
          </ul>
          <p className="text-sc-xs text-[var(--sc-text-tertiary)] mt-1">
            {t('settings.ai.adaptive.warmedModelsHint')}
          </p>
        </div>
      )}
    </section>
  );
};
