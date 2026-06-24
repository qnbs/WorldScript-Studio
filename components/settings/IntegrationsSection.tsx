import type { FC } from 'react';
import { useState } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { assertLanguageToolAllowed, languageToolPing } from '../../services/languageToolClient';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Input } from '../ui/Input';
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
            {/* QNBS-v3: role="status" announces async test result to AT without interrupting (WCAG 4.1.3) */}
            <span
              role="status"
              aria-live="polite"
              className="text-xs text-[var(--sc-text-secondary)] max-w-md"
            >
              {ltMsg}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
