import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

export const BackupSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
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
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
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
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
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
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
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
