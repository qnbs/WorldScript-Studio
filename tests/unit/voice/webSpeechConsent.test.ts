import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStoreRef } from '../../../app/storeRef';
import { setActiveAiMode } from '../../../services/ai/aiModeService';
import {
  ensureWebSpeechConsent,
  isWebSpeechBlocked,
  registerWebSpeechConsentPrompt,
} from '../../../services/voice/webSpeechConsent';

/** A store reference that holds only the Web Speech consent; returns the voice settings so a test can change it. */
function storeConsent(granted: boolean) {
  const voice = { webSpeechConsentGranted: granted };
  appStoreRef.current = {
    getState: () => ({ settings: { voice } }),
    dispatch: vi.fn(),
  } as unknown as typeof appStoreRef.current;
  return voice;
}

// #1261, maintainer decision of 2026-11-13: a local-only AI mode outranks any stored Web Speech consent.
describe('Web Speech consent in a local-only AI mode', () => {
  let unregister = () => {};
  afterEach(() => {
    unregister();
    unregister = () => {};
    setActiveAiMode('hybrid');
    appStoreRef.current = null;
  });

  it.each(['local', 'eco'] as const)(
    'the %s mode blocks Web Speech despite a stored consent and never asks',
    async (mode) => {
      storeConsent(true);
      const ask = vi.fn(async () => true);
      unregister = registerWebSpeechConsentPrompt(ask);
      setActiveAiMode(mode);

      expect(isWebSpeechBlocked()).toBe(true);
      await expect(ensureWebSpeechConsent()).resolves.toBe(false);
      expect(ask).not.toHaveBeenCalled();
    },
  );

  it.each(['hybrid', 'cloud'] as const)(
    'the %s mode keeps the consent rule: a stored consent allows Web Speech',
    async (mode) => {
      storeConsent(true);
      setActiveAiMode(mode);

      expect(isWebSpeechBlocked()).toBe(false);
      await expect(ensureWebSpeechConsent()).resolves.toBe(true);
    },
  );

  it('a switch to a local-only mode while the dialog is open refuses the grant', async () => {
    const voice = storeConsent(false);
    unregister = registerWebSpeechConsentPrompt(async () => {
      voice.webSpeechConsentGranted = true;
      setActiveAiMode('local');
      return true;
    });

    await expect(ensureWebSpeechConsent()).resolves.toBe(false);
  });
});
