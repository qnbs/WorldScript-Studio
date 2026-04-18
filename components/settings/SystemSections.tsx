import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

export const AccessibilitySection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.accessibility.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.accessibility.highContrast')}
              checked={settings.accessibility.highContrast}
              onChange={(v) =>
                handleSettingChange('accessibility', { ...settings.accessibility, highContrast: v })
              }
            />
            <ToggleSwitch
              label={t('settings.accessibility.reducedMotion')}
              checked={settings.accessibility.reducedMotion}
              onChange={(v) =>
                handleSettingChange('accessibility', {
                  ...settings.accessibility,
                  reducedMotion: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.accessibility.largeText')}
              checked={settings.accessibility.largeText}
              onChange={(v) =>
                handleSettingChange('accessibility', { ...settings.accessibility, largeText: v })
              }
            />
            <ToggleSwitch
              label={t('settings.accessibility.screenReader')}
              checked={settings.accessibility.screenReader}
              onChange={(v) =>
                handleSettingChange('accessibility', { ...settings.accessibility, screenReader: v })
              }
            />
            <ToggleSwitch
              label={t('settings.accessibility.focusIndicators')}
              checked={settings.accessibility.focusIndicators}
              onChange={(v) =>
                handleSettingChange('accessibility', {
                  ...settings.accessibility,
                  focusIndicators: v,
                })
              }
            />
          </div>
          <div>
            <label
              htmlFor="settings-colorblind-mode"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.accessibility.colorBlindMode')}
            </label>
            <Select
              id="settings-colorblind-mode"
              value={settings.accessibility.colorBlindMode}
              onChange={(e) =>
                handleSettingChange('accessibility', {
                  ...settings.accessibility,
                  colorBlindMode: e.target.value,
                })
              }
            >
              <option value="none">{t('settings.accessibility.colorBlind.none')}</option>
              <option value="protanopia">
                {t('settings.accessibility.colorBlind.protanopia')}
              </option>
              <option value="deuteranopia">
                {t('settings.accessibility.colorBlind.deuteranopia')}
              </option>
              <option value="tritanopia">
                {t('settings.accessibility.colorBlind.tritanopia')}
              </option>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const PrivacySection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
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

export const PerformanceSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.performance.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label
              htmlFor="settings-autosave-interval"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
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
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
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

export const NotificationsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.notifications.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.notifications.desktopNotifications')}
              checked={settings.notifications.desktopNotifications}
              onChange={(v) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  desktopNotifications: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.notifications.emailNotifications')}
              checked={settings.notifications.emailNotifications}
              onChange={(v) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  emailNotifications: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.notifications.goalAchievements')}
              checked={settings.notifications.goalAchievements}
              onChange={(v) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  goalAchievements: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.notifications.collaborationUpdates')}
              checked={settings.notifications.collaborationUpdates}
              onChange={(v) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  collaborationUpdates: v,
                })
              }
            />
          </div>
          <div>
            <label
              htmlFor="settings-writing-reminders"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.notifications.writingReminders')}
            </label>
            <Select
              id="settings-writing-reminders"
              value={settings.notifications.writingReminders}
              onChange={(e) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  writingReminders: e.target.value,
                })
              }
            >
              <option value="never">{t('settings.notifications.frequency.never')}</option>
              <option value="daily">{t('settings.notifications.frequency.daily')}</option>
              <option value="weekly">{t('settings.notifications.frequency.weekly')}</option>
              <option value="monthly">{t('settings.notifications.frequency.monthly')}</option>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const CollaborationSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.collaboration.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.collaboration.realTimeCollaboration')}
              checked={settings.collaboration.realTimeCollaboration}
              onChange={(v) =>
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  realTimeCollaboration: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.collaboration.publicSharing')}
              checked={settings.collaboration.publicSharing}
              onChange={(v) =>
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  publicSharing: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.collaboration.commentSystem')}
              checked={settings.collaboration.commentSystem}
              onChange={(v) =>
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  commentSystem: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.collaboration.versionHistory')}
              checked={settings.collaboration.versionHistory}
              onChange={(v) =>
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  versionHistory: v,
                })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const IntegrationsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.integrations.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label
              htmlFor="settings-sync-provider"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.integrations.syncProvider')}
            </label>
            <Select
              id="settings-sync-provider"
              value={settings.integrations.syncProvider}
              onChange={(e) =>
                handleSettingChange('integrations', {
                  ...settings.integrations,
                  syncProvider: e.target.value,
                })
              }
            >
              <option value="none">{t('settings.integrations.providers.none')}</option>
              <option value="google-drive">
                {t('settings.integrations.providers.googleDrive')}
              </option>
              <option value="dropbox">{t('settings.integrations.providers.dropbox')}</option>
              <option value="onedrive">{t('settings.integrations.providers.onedrive')}</option>
              <option value="icloud">{t('settings.integrations.providers.icloud')}</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.integrations.evernoteSync')}
              checked={settings.integrations.evernoteSync}
              onChange={(v) =>
                handleSettingChange('integrations', { ...settings.integrations, evernoteSync: v })
              }
            />
            <ToggleSwitch
              label={t('settings.integrations.notionSync')}
              checked={settings.integrations.notionSync}
              onChange={(v) =>
                handleSettingChange('integrations', { ...settings.integrations, notionSync: v })
              }
            />
            <ToggleSwitch
              label={t('settings.integrations.scrivenerExport')}
              checked={settings.integrations.scrivenerExport}
              onChange={(v) =>
                handleSettingChange('integrations', {
                  ...settings.integrations,
                  scrivenerExport: v,
                })
              }
            />
            <ToggleSwitch
              label={t('settings.integrations.googleDocsImport')}
              checked={settings.integrations.googleDocsImport}
              onChange={(v) =>
                handleSettingChange('integrations', {
                  ...settings.integrations,
                  googleDocsImport: v,
                })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const BackupSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.backup.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.backup.autoBackup')}
              checked={settings.backup.autoBackup}
              onChange={(v) => handleSettingChange('backup', { ...settings.backup, autoBackup: v })}
            />
            <ToggleSwitch
              label={t('settings.backup.encryptBackups')}
              checked={settings.backup.encryptBackups}
              onChange={(v) =>
                handleSettingChange('backup', { ...settings.backup, encryptBackups: v })
              }
            />
          </div>
          <div>
            <label
              htmlFor="settings-backup-frequency"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.backup.backupFrequency')}
            </label>
            <Select
              id="settings-backup-frequency"
              value={settings.backup.backupFrequency}
              onChange={(e) =>
                handleSettingChange('backup', {
                  ...settings.backup,
                  backupFrequency: e.target.value,
                })
              }
            >
              <option value="manual">{t('settings.backup.frequency.manual')}</option>
              <option value="daily">{t('settings.backup.frequency.daily')}</option>
              <option value="weekly">{t('settings.backup.frequency.weekly')}</option>
              <option value="monthly">{t('settings.backup.frequency.monthly')}</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="settings-backup-max"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.backup.maxBackups')} ({settings.backup.maxBackups})
            </label>
            <input
              id="settings-backup-max"
              type="range"
              min="5"
              max="50"
              step="5"
              value={settings.backup.maxBackups}
              onChange={(e) =>
                handleSettingChange('backup', {
                  ...settings.backup,
                  maxBackups: parseInt(e.target.value, 10),
                })
              }
              className="w-full"
            />
          </div>
          <div>
            <label
              htmlFor="settings-backup-location"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.backup.backupLocation')}
            </label>
            <Input
              id="settings-backup-location"
              value={settings.backup.backupLocation}
              onChange={(e) =>
                handleSettingChange('backup', {
                  ...settings.backup,
                  backupLocation: e.target.value,
                })
              }
              placeholder="./backups"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
