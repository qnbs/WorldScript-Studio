import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

export const PrivacySection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.privacy.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.privacy.analyticsEnabled')}
              checked={settings.privacy.analyticsEnabled}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, analyticsEnabled: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.crashReporting')}
              checked={settings.privacy.crashReporting}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, crashReporting: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.dataEncryption')}
              checked={settings.privacy.dataEncryption}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, dataEncryption: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.localStorageOnly')}
              checked={settings.privacy.localStorageOnly}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, localStorageOnly: v })
              }
            />
            <ToggleSwitch
              label={t('settings.privacy.shareUsageData')}
              checked={settings.privacy.shareUsageData}
              onChange={(v) =>
                handleSettingChange('privacy', { ...settings.privacy, shareUsageData: v })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
