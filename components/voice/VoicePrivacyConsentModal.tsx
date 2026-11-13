/**
 * VoicePrivacyConsentModal — GDPR Art. 13 blocking consent gate for Web Speech API.
 * QNBS-v3: Mandatory before any audio is routed to cloud STT providers.
 * Cannot be dismissed without an explicit accept or decline action.
 */

import { useCallback } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { settingsActions } from '../../features/settings/settingsSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { Modal } from '../ui/Modal';

interface VoicePrivacyConsentModalProps {
  isOpen: boolean;
  /** Called after the answer is stored: true when the user granted consent. */
  onClose: (granted: boolean) => void;
}

export default function VoicePrivacyConsentModal({
  isOpen,
  onClose,
}: VoicePrivacyConsentModalProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const handleAcknowledge = useCallback(() => {
    dispatch(settingsActions.setVoiceSettings({ webSpeechConsentGranted: true }));
    onClose(true);
  }, [dispatch, onClose]);

  // QNBS-v3 (#1261): declining only records the answer; the stored engine choice stays as the user set it.
  const handleDecline = useCallback(() => {
    dispatch(settingsActions.setVoiceSettings({ webSpeechConsentGranted: false }));
    onClose(false);
  }, [dispatch, onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDecline}
      title={t('settings.voice.privacy.consentTitle')}
      aria-describedby="voice-consent-body"
    >
      <div className="flex flex-col gap-4">
        <p
          id="voice-consent-body"
          className="text-[var(--sc-text-secondary)] text-sm leading-relaxed"
        >
          {t('settings.voice.privacy.consentBody')}
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleDecline}
            className="rounded-sc-md px-4 py-2 text-sm font-medium text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
          >
            {t('settings.voice.privacy.consentDecline')}
          </button>
          <button
            type="button"
            onClick={handleAcknowledge}
            className="rounded-sc-md bg-[var(--sc-interactive-primary)] px-4 py-2 text-sm font-medium text-[var(--sc-text-on-interactive)] hover:bg-[var(--sc-interactive-primary-hover)] focus-visible:ring-2 focus-visible:ring-[var(--sc-border-focus)] outline-none"
          >
            {t('settings.voice.privacy.consentAcknowledge')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
