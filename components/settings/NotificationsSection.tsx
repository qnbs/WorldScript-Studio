import type { FC } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { ToggleSwitch } from './SettingsShared';

export const NotificationsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
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
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
            >
              {t('settings.notifications.writingReminders')}
            </label>
            <Select
              id="settings-writing-reminders"
              value={settings.notifications.writingReminders}
              onChange={(v) =>
                handleSettingChange('notifications', {
                  ...settings.notifications,
                  writingReminders: v,
                })
              }
              options={[
                { value: 'never', label: t('settings.notifications.frequency.never') },
                { value: 'daily', label: t('settings.notifications.frequency.daily') },
                { value: 'weekly', label: t('settings.notifications.frequency.weekly') },
                { value: 'monthly', label: t('settings.notifications.frequency.monthly') },
              ]}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
