/**
 * VoiceSettingsSection — configuration UI for Voice Full Support.
 * QNBS-v3: Opt-in settings with clear privacy indicators.
 */

import type { FC } from 'react';
import { useId } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { ToggleSwitch } from './SettingsShared';

export const VoiceSettingsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const voice = settings.voice;

  const activationId = useId();
  const feedbackId = useId();
  const timeoutId = useId();

  const patchVoice = (partial: Partial<typeof voice>) => {
    handleSettingChange('voice', { ...voice, ...partial });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.voice.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-2">{t('settings.voice.intro')}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Master Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-[var(--sc-border-subtle)] p-4">
            <div>
              <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                {t('settings.voice.enableLabel')}
              </p>
              <p className="text-xs text-[var(--sc-text-muted)]">
                {t('settings.voice.enableHint')}
              </p>
            </div>
            <ToggleSwitch
              checked={voice.enabled}
              onChange={(v) => patchVoice({ enabled: v })}
              ariaLabel={t('settings.voice.enableLabel')}
            />
          </div>

          {voice.enabled && (
            <>
              {/* Privacy Notice */}
              <div className="rounded-lg border border-[var(--sc-info)]/30 bg-[var(--sc-info)]/10 p-3">
                <p className="text-xs text-[var(--sc-text-secondary)]">
                  {t('settings.voice.privacyNotice')}
                </p>
              </div>

              {/* Activation Mode */}
              <div className="space-y-2">
                <label
                  htmlFor={activationId}
                  className="text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.voice.activationMode')}
                </label>
                <select
                  id={activationId}
                  className="w-full rounded-md border border-[var(--sc-border)] bg-[var(--sc-surface-base)] px-3 py-2 text-sm text-[var(--sc-text-primary)]"
                  value={voice.activationMode}
                  onChange={(e) =>
                    patchVoice({ activationMode: e.target.value as typeof voice.activationMode })
                  }
                >
                  <option value="manual">{t('settings.voice.mode.manual')}</option>
                  <option value="pushToTalk">{t('settings.voice.mode.pushToTalk')}</option>
                  <option value="wakeWord">{t('settings.voice.mode.wakeWord')}</option>
                </select>
              </div>

              {/* Feedback Level */}
              <div className="space-y-2">
                <label
                  htmlFor={feedbackId}
                  className="text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.voice.feedbackLevel')}
                </label>
                <select
                  id={feedbackId}
                  className="w-full rounded-md border border-[var(--sc-border)] bg-[var(--sc-surface-base)] px-3 py-2 text-sm text-[var(--sc-text-primary)]"
                  value={voice.feedbackLevel}
                  onChange={(e) =>
                    patchVoice({ feedbackLevel: e.target.value as typeof voice.feedbackLevel })
                  }
                >
                  <option value="minimal">{t('settings.voice.level.minimal')}</option>
                  <option value="standard">{t('settings.voice.level.standard')}</option>
                  <option value="verbose">{t('settings.voice.level.verbose')}</option>
                </select>
              </div>

              {/* TTS Mute */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--sc-border-subtle)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                    {t('settings.voice.ttsMuted')}
                  </p>
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {t('settings.voice.ttsMutedHint')}
                  </p>
                </div>
                <ToggleSwitch
                  checked={voice.ttsMuted}
                  onChange={(v) => patchVoice({ ttsMuted: v })}
                  ariaLabel={t('settings.voice.ttsMuted')}
                />
              </div>

              {/* Dictation Auto-Punctuation */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--sc-border-subtle)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                    {t('settings.voice.autoPunctuation')}
                  </p>
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {t('settings.voice.autoPunctuationHint')}
                  </p>
                </div>
                <ToggleSwitch
                  checked={voice.dictationAutoPunctuation}
                  onChange={(v) => patchVoice({ dictationAutoPunctuation: v })}
                  ariaLabel={t('settings.voice.autoPunctuation')}
                />
              </div>

              {/* Cloud Fallback */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--sc-border-subtle)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                    {t('settings.voice.cloudFallback')}
                  </p>
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {t('settings.voice.cloudFallbackHint')}
                  </p>
                </div>
                <ToggleSwitch
                  checked={voice.allowCloudSttFallback}
                  onChange={(v) => patchVoice({ allowCloudSttFallback: v })}
                  ariaLabel={t('settings.voice.cloudFallback')}
                />
              </div>

              {/* Listening Timeout */}
              <div className="space-y-2">
                <label
                  htmlFor={timeoutId}
                  className="text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.voice.listeningTimeout')}
                </label>
                <input
                  id={timeoutId}
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={voice.listeningTimeoutSeconds}
                  onChange={(e) => patchVoice({ listeningTimeoutSeconds: Number(e.target.value) })}
                  className="w-full"
                />
                <p className="text-xs text-[var(--sc-text-muted)]">
                  {voice.listeningTimeoutSeconds}s
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
