/**
 * VoiceSettingsSection — configuration UI for Voice Full Support.
 * QNBS-v3: Opt-in settings with clear privacy indicators.
 */

import type { FC } from 'react';
import { useId, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { useSettingsViewContext } from '../../contexts/SettingsViewContext';
import { settingsActions } from '../../features/settings/settingsSlice';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Select } from '../ui/Select';
import { VoiceModelDownloadModal } from '../voice/VoiceModelDownloadModal';
import { ToggleSwitch } from './SettingsShared';

export const VoiceSettingsSection: FC = () => {
  const { t, settings, handleSettingChange, featureFlags } = useSettingsViewContext();
  const dispatch = useAppDispatch();
  const voice = settings.voice;
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadModelType, setDownloadModelType] = useState<'stt' | 'tts'>('stt');

  const activationId = useId();
  const feedbackId = useId();
  const timeoutId = useId();
  const sttEngineId = useId();
  const ttsEngineId = useId();
  const speechRateId = useId();
  const speechVolumeId = useId();
  const wakeWordPhraseId = useId();

  const patchVoice = (partial: Partial<typeof voice>) => {
    handleSettingChange('voice', { ...voice, ...partial });
  };

  const engineOptions = [
    { value: 'auto', label: t('settings.voice.engine.auto') },
    { value: 'webSpeech', label: t('settings.voice.engine.webSpeech') },
    { value: 'wasm', label: t('settings.voice.engine.wasm') },
  ];

  return (
    <div className="space-y-6">
      {/* ── Master toggle ── */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('settings.voice.title')}
          </h2>
          <p className="text-sm text-[var(--sc-text-muted)] mt-2">{t('settings.voice.intro')}</p>
        </CardHeader>
        <CardContent className="space-y-6">
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

              {/* Push-to-Talk hint */}
              {voice.activationMode === 'pushToTalk' && (
                <p className="text-xs text-[var(--sc-text-muted)] rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] p-3">
                  {t('settings.voice.pttHint')}
                </p>
              )}

              {/* Wake Word Phrase — only shown in wakeWord mode */}
              {voice.activationMode === 'wakeWord' && (
                <div className="space-y-2">
                  <label
                    htmlFor={wakeWordPhraseId}
                    className="text-sm font-medium text-[var(--sc-text-primary)]"
                  >
                    {t('settings.voice.wakeWordPhrase')}
                  </label>
                  <input
                    id={wakeWordPhraseId}
                    type="text"
                    value={voice.wakeWordPhrase}
                    onChange={(e) => patchVoice({ wakeWordPhrase: e.target.value })}
                    className="w-full rounded-md border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-base)] px-3 py-2 text-sm text-[var(--sc-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--sc-border-focus)]"
                    aria-describedby={`${wakeWordPhraseId}-hint`}
                  />
                  <p
                    id={`${wakeWordPhraseId}-hint`}
                    className="text-xs text-[var(--sc-text-muted)]"
                  >
                    {t('settings.voice.wakeWordPhraseHint')}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Speech Recognition (STT) ── */}
      {voice.enabled && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
              {t('settings.voice.sttEngine')}
            </h3>
            <p className="text-xs text-[var(--sc-text-muted)] mt-1">
              {t('settings.voice.sttEngineHint')}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor={sttEngineId}
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.voice.sttEngine')}
              </label>
              <Select
                id={sttEngineId}
                value={voice.sttEngine}
                onChange={(v) => patchVoice({ sttEngine: v as typeof voice.sttEngine })}
                options={engineOptions}
                ariaLabel={t('settings.voice.sttEngine')}
              />
            </div>

            {/* Cloud fallback */}
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

            {/* Listening timeout */}
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
                className="w-full accent-[var(--sc-accent)]"
                aria-valuetext={`${voice.listeningTimeoutSeconds}s`}
              />
              <p className="text-xs text-[var(--sc-text-muted)]">
                {voice.listeningTimeoutSeconds}s
              </p>
            </div>

            {/* Dictation auto-punctuation */}
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
          </CardContent>
        </Card>
      )}

      {/* ── Text-to-Speech (TTS) ── */}
      {voice.enabled && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
              {t('settings.voice.ttsEngine')}
            </h3>
            <p className="text-xs text-[var(--sc-text-muted)] mt-1">
              {t('settings.voice.ttsEngineHint')}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor={ttsEngineId}
                className="text-sm font-medium text-[var(--sc-text-primary)]"
              >
                {t('settings.voice.ttsEngine')}
              </label>
              <Select
                id={ttsEngineId}
                value={voice.ttsEngine}
                onChange={(v) => patchVoice({ ttsEngine: v as typeof voice.ttsEngine })}
                options={engineOptions}
                ariaLabel={t('settings.voice.ttsEngine')}
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

            {/* Speech Rate */}
            {!voice.ttsMuted && (
              <>
                <div className="space-y-2">
                  <label
                    htmlFor={speechRateId}
                    className="text-sm font-medium text-[var(--sc-text-primary)]"
                  >
                    {t('settings.voice.speechRate')}
                  </label>
                  <input
                    id={speechRateId}
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    value={voice.speechRate}
                    onChange={(e) => patchVoice({ speechRate: Number(e.target.value) })}
                    className="w-full accent-[var(--sc-accent)]"
                    aria-valuetext={`${voice.speechRate.toFixed(1)}×`}
                  />
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {voice.speechRate.toFixed(1)}×{' '}
                    <span className="opacity-60">{t('settings.voice.speechRateHint')}</span>
                  </p>
                </div>

                {/* Speech Volume */}
                <div className="space-y-2">
                  <label
                    htmlFor={speechVolumeId}
                    className="text-sm font-medium text-[var(--sc-text-primary)]"
                  >
                    {t('settings.voice.speechVolume')}
                  </label>
                  <input
                    id={speechVolumeId}
                    type="range"
                    min={0.0}
                    max={1.0}
                    step={0.05}
                    value={voice.speechVolume}
                    onChange={(e) => patchVoice({ speechVolume: Number(e.target.value) })}
                    className="w-full accent-[var(--sc-accent)]"
                    aria-valuetext={`${Math.round(voice.speechVolume * 100)}%`}
                  />
                  <p className="text-xs text-[var(--sc-text-muted)]">
                    {Math.round(voice.speechVolume * 100)}%{' '}
                    <span className="opacity-60">{t('settings.voice.speechVolumeHint')}</span>
                  </p>
                </div>
              </>
            )}

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
          </CardContent>
        </Card>
      )}

      {/* ── WASM Models ── */}
      {/* QNBS-v3: Only render when enableVoiceWasm is on — the section is meaningless without
          the offline engine flag, and the test matrix expects it absent when the flag is off. */}
      {featureFlags.enableVoiceWasm && voice.enabled && (
        <Card data-testid="voice-wasm-download-section">
          <CardHeader>
            <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
              {t('settings.voice.wasmModels')}
            </h3>
            <p className="text-xs text-[var(--sc-text-muted)] mt-1">
              {voice.wasmModelsReady
                ? t('settings.voice.wasmModelsReady')
                : t('settings.voice.wasmModelsNotReady')}
            </p>
          </CardHeader>
          {!voice.wasmModelsReady && (
            <CardContent>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDownloadModelType('stt');
                    setDownloadModalOpen(true);
                  }}
                  className="rounded-md bg-[var(--sc-accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--sc-accent-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] focus-visible:outline-none"
                >
                  {t('settings.voice.downloadSttModel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDownloadModelType('tts');
                    setDownloadModalOpen(true);
                  }}
                  className="rounded-md bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] px-3 py-1.5 text-sm font-medium text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] focus-visible:outline-none"
                >
                  {t('settings.voice.downloadTtsModel')}
                </button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Privacy & Consent ── */}
      {voice.enabled && voice.webSpeechConsentGranted && (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-[var(--sc-text-primary)]">
              {t('settings.voice.privacy.consentTitle')}
            </h3>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--sc-text-secondary)]">
                {t('settings.voice.privacy.revokeConsentHint')}
              </p>
              <button
                type="button"
                onClick={() =>
                  dispatch(
                    settingsActions.setVoiceSettings({
                      webSpeechConsentGranted: false,
                      sttEngine: 'auto',
                    }),
                  )
                }
                className="ml-4 shrink-0 rounded-md border border-[var(--sc-danger-border)] px-3 py-1.5 text-sm font-medium text-[var(--sc-danger-fg)] hover:bg-[var(--sc-danger-bg)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] focus-visible:outline-none"
              >
                {t('settings.voice.privacy.revokeConsent')}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* WASM Model Download Modal */}
      <VoiceModelDownloadModal
        isOpen={downloadModalOpen}
        onClose={() => setDownloadModalOpen(false)}
        modelType={downloadModelType}
      />
    </div>
  );
};
