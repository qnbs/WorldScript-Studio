import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

/** All experimental feature flags in one settings category. */
export const FeatureFlagsSection: FC = () => {
  const { t, featureFlags, handleSettingChange } = useSettingsViewContext();

  const flags: { key: keyof typeof featureFlags; labelKey: string }[] = [
    { key: 'enableCodexAutoTracking', labelKey: 'settings.featureFlags.enableCodexAutoTracking' },
    { key: 'enableStoryBibleAdvanced', labelKey: 'settings.featureFlags.enableStoryBibleAdvanced' },
    { key: 'enableBinderResearch', labelKey: 'settings.featureFlags.enableBinderResearch' },
    { key: 'enableCompileWizard', labelKey: 'settings.featureFlags.enableCompileWizard' },
    { key: 'enableProjectHealthScore', labelKey: 'settings.featureFlags.enableProjectHealthScore' },
    { key: 'enableCrossProjectSearch', labelKey: 'settings.featureFlags.enableCrossProjectSearch' },
    { key: 'enableAppHealthPanel', labelKey: 'settings.featureFlags.enableAppHealthPanel' },
    { key: 'enablePlotBoardV2', labelKey: 'settings.featureFlags.enablePlotBoardV2' },
    { key: 'enableDuckDbAnalytics', labelKey: 'settings.featureFlags.enableDuckDbAnalytics' },
    { key: 'enableObjectsGroups', labelKey: 'settings.featureFlags.enableObjectsGroups' },
    { key: 'enableMindMaps', labelKey: 'settings.featureFlags.enableMindMaps' },
    {
      key: 'enableCharacterInterviews',
      labelKey: 'settings.featureFlags.enableCharacterInterviews',
    },
    { key: 'enableRtlLayout', labelKey: 'settings.featureFlags.enableRtlLayout' },
    { key: 'enableCloudSync', labelKey: 'settings.featureFlags.enableCloudSync' },
    { key: 'enableLoraAdapters', labelKey: 'settings.featureFlags.enableLoraAdapters' },
    { key: 'enablePluginSystem', labelKey: 'settings.featureFlags.enablePluginSystem' },
    // QNBS-v3: Voice + ProForge were in featureFlagsSlice but missing from the UI toggle list.
    { key: 'enableVoiceSupport', labelKey: 'settings.featureFlags.enableVoiceSupport' },
    { key: 'enableVoiceWasm', labelKey: 'settings.featureFlags.enableVoiceWasm' },
    { key: 'enableProForge', labelKey: 'settings.featureFlags.enableProForge' },
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
