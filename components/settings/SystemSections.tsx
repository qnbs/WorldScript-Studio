import type { FC } from 'react';
import { useContext, useState } from 'react';
import { AppContext } from '../../contexts/AppContext';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { accessibilityPresetDefaults } from '../../features/settings/accessibilitySchema';
import { DEFAULT_WEBRTC_SIGNALING_URLS } from '../../services/collaborationService';
import { assertLanguageToolAllowed, languageToolPing } from '../../services/languageToolClient';
import type { AccessibilityPresetId, AccessibilitySettings } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { Textarea } from '../ui/Textarea';
import { ToggleSwitch } from './SettingsShared';

const PRESET_IDS: Exclude<AccessibilityPresetId, 'custom'>[] = [
  'motor',
  'lowVision',
  'cognitive',
  'screenReader',
];

export const AccessibilitySection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const appCtx = useContext(AppContext);

  const patchA11y = (partial: Partial<AccessibilitySettings>) => {
    handleSettingChange('accessibility', {
      ...settings.accessibility,
      ...partial,
      presetId: 'custom',
    });
  };

  const applyPreset = (id: Exclude<AccessibilityPresetId, 'custom'>) => {
    handleSettingChange('accessibility', accessibilityPresetDefaults(id));
  };

  const openHelp = () => appCtx?.handleNavigate('help');

  const presetTitleKey = (id: Exclude<AccessibilityPresetId, 'custom'>) =>
    `settings.accessibility.hub.preset.${id}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.accessibility.title')}
          </h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-2">
            {t('settings.accessibility.hub.intro')}
          </p>
          <p className="text-xs text-[var(--foreground-tertiary)] mt-2">
            {t('settings.accessibility.activePreset')}:{' '}
            <span className="font-medium text-[var(--foreground-secondary)]">
              {t(`settings.accessibility.preset.${settings.accessibility.presetId}`)}
            </span>
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* QNBS-v3: Accessibility-Hub — Presets + Vorschau + Hilfe, ohne bestehende Feineinstellungen zu entfernen. */}
          <section aria-labelledby="a11y-presets-heading">
            <h3
              id="a11y-presets-heading"
              className="text-sm font-semibold text-[var(--foreground-secondary)] mb-3"
            >
              {t('settings.accessibility.hub.presetsTitle')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRESET_IDS.map((id) => (
                <div
                  key={id}
                  className="rounded-xl border border-[var(--border-primary)] bg-[var(--background-tertiary)]/40 p-4 flex flex-col gap-2"
                >
                  <Button
                    type="button"
                    variant={settings.accessibility.presetId === id ? 'primary' : 'secondary'}
                    size="sm"
                    className="w-full justify-center"
                    aria-pressed={settings.accessibility.presetId === id}
                    aria-label={t(presetTitleKey(id))}
                    onClick={() => applyPreset(id)}
                  >
                    {t(presetTitleKey(id))}
                  </Button>
                  <p className="text-xs text-[var(--foreground-muted)] leading-snug">
                    {t(`${presetTitleKey(id)}Hint`)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="a11y-preview-heading">
            <h3
              id="a11y-preview-heading"
              className="text-sm font-semibold text-[var(--foreground-secondary)] mb-3"
            >
              {t('settings.accessibility.hub.previewTitle')}
            </h3>
            <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--background-primary)] p-4 flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" size="sm">
                {t('settings.accessibility.hub.preview.sampleButton')}
              </Button>
              <button
                type="button"
                className="text-sm text-[var(--background-interactive)] underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] rounded"
              >
                {t('settings.accessibility.hub.preview.sampleLink')}
              </button>
              <span className="text-xs px-2 py-1 rounded-md bg-[var(--background-tertiary)] border border-[var(--border-primary)]">
                {t('settings.accessibility.hub.preview.badge')}
              </span>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!appCtx}
              onClick={() => openHelp()}
            >
              {t('settings.accessibility.hub.helpButton')}
            </Button>
            <span className="text-xs text-[var(--foreground-muted)]">
              {t('settings.accessibility.hub.helpHint')}
            </span>
          </div>

          <div>
            <label
              htmlFor="settings-live-region-verbosity"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.accessibility.liveRegionVerbosity')}
            </label>
            <Select
              id="settings-live-region-verbosity"
              value={settings.accessibility.liveRegionVerbosity}
              onChange={(e) =>
                patchA11y({
                  liveRegionVerbosity: e.target
                    .value as AccessibilitySettings['liveRegionVerbosity'],
                })
              }
            >
              <option value="minimal">{t('settings.accessibility.liveRegion.minimal')}</option>
              <option value="normal">{t('settings.accessibility.liveRegion.normal')}</option>
              <option value="verbose">{t('settings.accessibility.liveRegion.verbose')}</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ToggleSwitch
              label={t('settings.accessibility.highContrast')}
              checked={settings.accessibility.highContrast}
              onChange={(v) => patchA11y({ highContrast: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.reducedMotion')}
              checked={settings.accessibility.reducedMotion}
              onChange={(v) => patchA11y({ reducedMotion: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.largeText')}
              checked={settings.accessibility.largeText}
              onChange={(v) => patchA11y({ largeText: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.screenReader')}
              checked={settings.accessibility.screenReader}
              onChange={(v) => patchA11y({ screenReader: v })}
            />
            <ToggleSwitch
              label={t('settings.accessibility.focusIndicators')}
              checked={settings.accessibility.focusIndicators}
              onChange={(v) => patchA11y({ focusIndicators: v })}
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
                patchA11y({
                  colorBlindMode: e.target.value as AccessibilitySettings['colorBlindMode'],
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
          {/* QNBS-v3: Security warning always shown so users understand public-relay implications before configuring signaling URLs */}
          <div
            role="alert"
            aria-live="polite"
            className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-700 dark:text-amber-300 space-y-1"
          >
            <p className="font-semibold">{t('collab.securityWarning')}</p>
            <p>{t('collab.securityWarningDetail')}</p>
          </div>
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
          <div>
            <label
              htmlFor="settings-webrtc-signaling-urls"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-2 block"
            >
              {t('settings.collaboration.webrtcSignalingUrls')}
            </label>
            <Textarea
              id="settings-webrtc-signaling-urls"
              className="min-h-[5.5rem] font-mono text-sm"
              value={settings.collaboration.webrtcSignalingUrls.join('\n')}
              onChange={(e) => {
                const lines = e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean);
                handleSettingChange('collaboration', {
                  ...settings.collaboration,
                  webrtcSignalingUrls:
                    lines.length > 0 ? lines : [...DEFAULT_WEBRTC_SIGNALING_URLS],
                });
              }}
              placeholder={t('settings.collaboration.webrtcSignalingUrlsPlaceholder')}
              aria-describedby="settings-webrtc-signaling-help"
            />
            <p
              id="settings-webrtc-signaling-help"
              className="mt-1 text-xs text-[var(--foreground-tertiary)]"
            >
              {t('settings.collaboration.webrtcSignalingUrlsHelp')}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export const IntegrationsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const [ltBusy, setLtBusy] = useState(false);
  const [ltMsg, setLtMsg] = useState('');

  const runLanguageToolPing = async () => {
    setLtBusy(true);
    setLtMsg('');
    try {
      assertLanguageToolAllowed(settings, settings.integrations.languageToolBaseUrl);
      const ok = await languageToolPing(settings.integrations.languageToolBaseUrl);
      setLtMsg(
        ok
          ? t('settings.integrations.languageToolTestOk')
          : t('settings.integrations.languageToolTestFail'),
      );
    } catch (e: unknown) {
      setLtMsg(
        typeof e === 'string'
          ? e
          : e instanceof Error
            ? e.message
            : t('settings.integrations.languageToolTestFail'),
      );
    } finally {
      setLtBusy(false);
    }
  };

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

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--foreground-primary)]">
            {t('settings.integrations.languageToolTitle')}
          </h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-1">
            {t('settings.integrations.languageToolPrivacy')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleSwitch
            label={t('settings.integrations.languageToolEnable')}
            checked={settings.integrations.languageToolEnabled}
            onChange={(v) =>
              handleSettingChange('integrations', {
                ...settings.integrations,
                languageToolEnabled: v,
              })
            }
          />
          <div>
            <label
              htmlFor="settings-languagetool-url"
              className="text-sm font-medium text-[var(--foreground-secondary)] mb-1 block"
            >
              {t('settings.integrations.languageToolUrl')}
            </label>
            <Input
              id="settings-languagetool-url"
              type="url"
              value={settings.integrations.languageToolBaseUrl}
              onChange={(e) =>
                handleSettingChange('integrations', {
                  ...settings.integrations,
                  languageToolBaseUrl: e.target.value,
                })
              }
              className="font-mono text-sm"
              disabled={!settings.integrations.languageToolEnabled}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!settings.integrations.languageToolEnabled || ltBusy}
              onClick={() => void runLanguageToolPing()}
            >
              {ltBusy ? (
                <Spinner className="w-4 h-4" />
              ) : (
                t('settings.integrations.languageToolTest')
              )}
            </Button>
            {ltMsg ? (
              <span className="text-xs text-[var(--foreground-secondary)] max-w-md">{ltMsg}</span>
            ) : null}
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
