/**
 * VoiceSettingsSection — configuration UI for Voice Full Support.
 * QNBS-v3: Opt-in settings with clear privacy indicators.
 */

import type { FC } from 'react';
import { useId, useState } from 'react';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { VoiceModelDownloadModal } from '../voice/VoiceModelDownloadModal';
import { ToggleSwitch } from './SettingsShared';

export const VoiceSettingsSection: FC = () => {
  const { t, settings, handleSettingChange } = useSettingsViewContext();
  const voice = settings.voice;
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadModelType, setDownloadModelType] = useState<'stt' | 'tts'>('stt');

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
                <Select
                  id={activationId}
                  value={voice.activationMode}
                  onChange={(v) => patchVoice({ activationMode: v as typeof voice.activationMode })}
                  options={[
                    { value: 'manual', label: t('settings.voice.mode.manual') },
                    { value: 'pushToTalk', label: t('settings.voice.mode.pushToTalk') },
                    { value: 'wakeWord', label: t('settings.voice.mode.wakeWord') },
                  ]}
                  ariaLabel={t('settings.voice.activationMode')}
                />
              </div>

              {/* Feedback Level */}
              <div className="space-y-2">
                <label
                  htmlFor={feedbackId}
                  className="text-sm font-medium text-[var(--sc-text-primary)]"
                >
                  {t('settings.voice.feedbackLevel')}
                </label>
                <Select
                  id={feedbackId}
                  value={voice.feedbackLevel}
                  onChange={(v) => patchVoice({ feedbackLevel: v as typeof voice.feedbackLevel })}
                  options={[
                    { value: 'minimal', label: t('settings.voice.level.minimal') },
                    { value: 'standard', label: t('settings.voice.level.standard') },
                    { value: 'verbose', label: t('settings.voice.level.verbose') },
                  ]}
                  ariaLabel={t('settings.voice.feedbackLevel')}
                />
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

              {/* WASM Model Download */}
              <div className="flex items-center justify-between rounded-lg border border-[var(--sc-border-subtle)] p-4">
                <div>
                  <p className="text-sm font-medium text-[var(--sc-text-primary)]">
                    {t('settings.voice.wasmModels')}
                  </p>
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {voice.wasmModelsReady
                      ? t('settings.voice.wasmModelsReady')
                      : t('settings.voice.wasmModelsNotReady')}
                  </p>
                </div>
                {!voice.wasmModelsReady && (
                  // QNBS-v3: Separate STT/TTS buttons — CodeAnt P2-2 fix (TTS path was unreachable)
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadModelType('stt');
                        setDownloadModalOpen(true);
                      }}
                      className="rounded-md bg-[var(--sc-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--sc-accent-hover)]"
                    >
                      {t('settings.voice.downloadSttModel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadModelType('tts');
                        setDownloadModalOpen(true);
                      }}
                      className="rounded-md bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)]"
                    >
                      {t('settings.voice.downloadTtsModel')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* WASM Model Download Modal */}
      <VoiceModelDownloadModal
        isOpen={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
        modelType={downloadModelType}
      />
    </div>
  );
};
