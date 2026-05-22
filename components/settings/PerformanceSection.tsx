import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

export const PerformanceSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.performance.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label
              htmlFor="settings-autosave-interval"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.performance.autoSaveInterval')} ({settings.performance.autoSaveInterval}
              s)
            </label>
            <input
              id="settings-autosave-interval"
              type="range"
              min="10"
              max="300"
              step="10"
              value={settings.performance.autoSaveInterval}
              onChange={(e) =>
                handleSettingChange('performance', {
                  ...settings.performance,
                  autoSaveInterval: parseInt(e.target.value, 10),
                })
              }
              className="w-full"
            />
          </div>
          <div>
            <label
              htmlFor="settings-cache-size"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.performance.cacheSize')} ({settings.performance.cacheSize} MB)
            </label>
            <input
              id="settings-cache-size"
              type="range"
              min="50"
              max="500"
              step="50"
              value={settings.performance.cacheSize}
              onChange={(e) =>
                handleSettingChange('performance', {
                  ...settings.performance,
                  cacheSize: parseInt(e.target.value, 10),
                })
              }
              className="w-full"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.performance.preloadContent')}
              checked={settings.performance.preloadContent}
              onChange={(v) =>
                handleSettingChange('performance', { ...settings.performance, preloadContent: v })
              }
            />
            <ToggleSwitch
              label={t('settings.performance.lazyLoadImages')}
              checked={settings.performance.lazyLoadImages}
              onChange={(v) =>
                handleSettingChange('performance', { ...settings.performance, lazyLoadImages: v })
              }
            />
            <ToggleSwitch
              label={t('settings.performance.offlineMode')}
              checked={settings.performance.offlineMode}
              onChange={(v) =>
                handleSettingChange('performance', { ...settings.performance, offlineMode: v })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
