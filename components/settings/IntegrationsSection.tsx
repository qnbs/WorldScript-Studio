import type { FC } from 'react';
import { useState } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { assertLanguageToolAllowed, languageToolPing } from '../../services/languageToolClient';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { ToggleSwitch } from './SettingsShared';

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
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.integrations.title')}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label
              htmlFor="settings-sync-provider"
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-2 block"
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
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.integrations.languageToolTitle')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-1">
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
              className="text-sm font-medium text-[var(--sc-text-secondary)] mb-1 block"
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
              <span className="text-xs text-[var(--sc-text-secondary)] max-w-md">{ltMsg}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
