import type { FC, ReactNode } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { FEATURE_CATALOG } from '../../features/featureCatalog';
import type { FeatureFlagsState } from '../../features/featureFlags/featureFlagsSlice';
import { Badge, type BadgeVariant } from '../ui/Badge';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

// QNBS-v3: drive the maturity badge from FEATURE_CATALOG (single source of truth) rather than a
// hand-maintained list — stub/experimental → "Experimental", beta → "Beta", stable/unlisted → none.
const MATURITY_TO_BADGE: Record<string, BadgeVariant | undefined> = {
  experimental: 'experimental',
  stub: 'experimental',
  beta: 'beta',
  stable: undefined,
};

const FLAG_BADGE: Partial<Record<keyof FeatureFlagsState, BadgeVariant>> = Object.fromEntries(
  FEATURE_CATALOG.map((e) => [e.flagKey, MATURITY_TO_BADGE[e.maturity]]).filter(
    ([, variant]) => variant !== undefined,
  ),
) as Partial<Record<keyof FeatureFlagsState, BadgeVariant>>;

/** All experimental feature flags in one settings category. */
export const FeatureFlagsSection: FC = () => {
  const { t, featureFlags, handleSettingChange } = useSettingsViewContext();

  // QNBS-v3: translated badge text per variant; the visible pill is read inline by screen readers.
  const renderBadge = (key: keyof FeatureFlagsState): ReactNode => {
    const variant = FLAG_BADGE[key];
    if (!variant) return undefined;
    const label = variant === 'beta' ? t('common.badge.beta') : t('common.badge.experimental');
    return <Badge variant={variant}>{label}</Badge>;
  };

  // QNBS-v3: Flags retired from UI (not user-toggleable):
  //   enableCodexAutoTracking — promoted to permanent core (always on)
  //   enableCrossProjectSearch — promoted to permanent core (always on)
  //   enablePlotBoardV2 — deprecated (v1 board removed in v1.6; flag had no effect)
  //   enableCloudSync — retired (Cloud Sync UI not yet built; toggle was a no-op)
  const flags: { key: keyof typeof featureFlags; labelKey: string }[] = [
    { key: 'enableStoryBibleAdvanced', labelKey: 'settings.featureFlags.enableStoryBibleAdvanced' },
    { key: 'enableBinderResearch', labelKey: 'settings.featureFlags.enableBinderResearch' },
    { key: 'enableCompileWizard', labelKey: 'settings.featureFlags.enableCompileWizard' },
    { key: 'enableProjectHealthScore', labelKey: 'settings.featureFlags.enableProjectHealthScore' },
    { key: 'enableAppHealthPanel', labelKey: 'settings.featureFlags.enableAppHealthPanel' },
    { key: 'enableDuckDbAnalytics', labelKey: 'settings.featureFlags.enableDuckDbAnalytics' },
    { key: 'enableObjectsGroups', labelKey: 'settings.featureFlags.enableObjectsGroups' },
    { key: 'enableMindMaps', labelKey: 'settings.featureFlags.enableMindMaps' },
    {
      key: 'enableCharacterInterviews',
      labelKey: 'settings.featureFlags.enableCharacterInterviews',
    },
    { key: 'enableRtlLayout', labelKey: 'settings.featureFlags.enableRtlLayout' },
    { key: 'enableLoraAdapters', labelKey: 'settings.featureFlags.enableLoraAdapters' },
    { key: 'enablePluginSystem', labelKey: 'settings.featureFlags.enablePluginSystem' },
    // QNBS-v3: Voice + ProForge were in featureFlagsSlice but missing from the UI toggle list.
    { key: 'enableVoiceSupport', labelKey: 'settings.featureFlags.enableVoiceSupport' },
    { key: 'enableVoiceWasm', labelKey: 'settings.featureFlags.enableVoiceWasm' },
    { key: 'enableProForge', labelKey: 'settings.featureFlags.enableProForge' },
    // QNBS-v3: Edge-AI Perfection Cycle — adaptive engine, WebNN, and compute shaders
    { key: 'enableAdaptiveAiEngine', labelKey: 'settings.featureFlags.enableAdaptiveAiEngine' },
    { key: 'enableWebnnInference', labelKey: 'settings.featureFlags.enableWebnnInference' },
    { key: 'enableComputeShaders', labelKey: 'settings.featureFlags.enableComputeShaders' },
    // QNBS-v3: Phase 2 — WorkerBus v2 + Rust Compute (wired in services/workerBusManager.ts)
    { key: 'enableWorkerBusV2', labelKey: 'settings.featureFlags.enableWorkerBusV2' },
    { key: 'enableRustCompute', labelKey: 'settings.featureFlags.enableRustCompute' },
    // QNBS-v3: Global AI Copilot — beginner-friendly in-app live assistant (ENABLE_GLOBAL_COPILOT).
    { key: 'enableGlobalCopilot', labelKey: 'settings.featureFlags.enableGlobalCopilot' },
    // QNBS-v3: Local-First sync (shadow) — Yjs doc + y-indexeddb projection; Redux stays SoT (B1.1).
    { key: 'enableLocalFirstSync', labelKey: 'settings.featureFlags.enableLocalFirstSync' },
    // QNBS-v3: enableIdbAtRestEncryption removed — toggling without passphrase setup blocks all users.
    // Dedicated UI lives in Settings → Privacy (PrivacySection.tsx).
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
          {t('settings.featureFlags.title')}
        </h2>
        <p className="text-sm text-[var(--sc-text-muted)] mt-1">
          {t('settings.featureFlags.description')}
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {flags.map(({ key, labelKey }) => (
            <ToggleSwitch
              key={key}
              label={t(labelKey)}
              badge={renderBadge(key)}
              checked={featureFlags[key]}
              onChange={(v) => handleSettingChange(key, v)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
