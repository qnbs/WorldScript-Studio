import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

/** All experimental feature flags in one settings category. */
export const FeatureFlagsSection: FC = () => {
  const { t, featureFlags, handleSettingChange } = useSettingsViewContext();

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
              checked={featureFlags[key]}
              onChange={(v) => handleSettingChange(key, v)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
