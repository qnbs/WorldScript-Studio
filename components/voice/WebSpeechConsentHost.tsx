import { useCallback, useEffect, useRef, useState } from 'react';
import { registerWebSpeechConsentPrompt } from '../../services/voice/webSpeechConsent';
import VoicePrivacyConsentModal from './VoicePrivacyConsentModal';

/**
 * Shows the Web Speech consent dialog whenever a start needs consent (#1261). Mounted once in the
 * app shell; concurrent requests share one dialog and one answer, and unmounting declines.
 */
export function WebSpeechConsentHost() {
  const [isOpen, setIsOpen] = useState(false);
  const pending = useRef<{ answer: Promise<boolean>; resolve: (granted: boolean) => void } | null>(
    null,
  );

  const settle = useCallback((granted: boolean) => {
    pending.current?.resolve(granted);
    pending.current = null;
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const unregister = registerWebSpeechConsentPrompt(() => {
      if (!pending.current) {
        let resolve: (granted: boolean) => void = () => {};
        const answer = new Promise<boolean>((done) => {
          resolve = done;
        });
        pending.current = { answer, resolve };
        setIsOpen(true);
      }
      return pending.current.answer;
    });
    return () => {
      unregister();
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  return <VoicePrivacyConsentModal isOpen={isOpen} onClose={settle} />;
}
