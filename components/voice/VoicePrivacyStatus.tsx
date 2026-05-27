/**
 * VoicePrivacyStatus — shows 🔒 Local or ⚠️ External indicator for the active STT engine.
 * QNBS-v3: Informs users at a glance whether their audio stays on-device or is sent to cloud providers.
 */

import { useAppSelector } from '../../app/hooks';
import { selectVoiceSettings } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';

export default function VoicePrivacyStatus() {
  const { t } = useTranslation();
  const voice = useAppSelector(selectVoiceSettings);
  const sttEngine = voice.sttEngine;

  // Web Speech API is the only non-local engine in Phase 1.
  const isExternal = sttEngine === 'webSpeech';

  if (isExternal) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sc-sm bg-[var(--sc-status-warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--sc-status-warning-text)]">
        {/* QNBS-v3: aria-hidden on decorative indicator — text label carries the meaning. */}
        <span aria-hidden="true">⚠️</span>
        {t('settings.voice.privacy.statusExternal')}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-sc-sm bg-[var(--sc-status-success-bg)] px-2 py-0.5 text-xs font-medium text-[var(--sc-status-success-text)]">
      <span aria-hidden="true">🔒</span>
      {t('settings.voice.privacy.statusLocal')}
    </span>
  );
}
