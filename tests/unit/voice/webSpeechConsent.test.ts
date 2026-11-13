import { afterEach, describe, expect, it, vi } from 'vitest';
import { appStoreRef } from '../../../app/storeRef';
import { setActiveAiMode } from '../../../services/ai/aiModeService';
import {
  ensureWebSpeechConsent,
  isWebSpeechBlocked,
  onWebSpeechBlocked,
  registerWebSpeechConsentPrompt,
} from '../../../services/voice/webSpeechConsent';

/** A store reference with the Web Speech consent and, optionally, the stored AI mode; returns the settings to change. */
function storeConsent(granted: boolean, aiMode?: string) {
  const voice = { webSpeechConsentGranted: granted };
  const settings: { voice: typeof voice; aiMode?: string } = { voice };
  if (aiMode) settings.aiMode = aiMode;
  appStoreRef.current = {
    getState: () => ({ settings }),
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

  it.each(['hybrid', 'cloud'] as const)(
    'the %s mode keeps the consent rule: a stored consent allows Web Speech',
    async (mode) => {
      storeConsent(true);
      setActiveAiMode(mode);

      expect(isWebSpeechBlocked()).toBe(false);
      await expect(ensureWebSpeechConsent()).resolves.toBe(true);
    },
  );

  it('tells subscribers when the mode turns local-only, once per real change', () => {
    const blocked = vi.fn();
    const off = onWebSpeechBlocked(blocked);
    try {
      setActiveAiMode('cloud');
      expect(blocked).not.toHaveBeenCalled();
      setActiveAiMode('eco');
      setActiveAiMode('eco');
      expect(blocked).toHaveBeenCalledTimes(1);
      setActiveAiMode('local');
      expect(blocked).toHaveBeenCalledTimes(2);
    } finally {
      off();
    }
  });

  // The in-memory mode follows the stored one through async listener middleware, so a stored mode alone must block too.
  it.each(
    (['in-memory', 'stored'] as const).flatMap((source) =>
      (['local', 'eco'] as const).map((mode) => ({ source, mode })),
    ),
  )(
    'a $source $mode mode blocks Web Speech despite a stored consent and never asks',
    async ({ source, mode }) => {
      storeConsent(true, source === 'stored' ? mode : undefined);
      if (source === 'in-memory') setActiveAiMode(mode);
      const ask = vi.fn(async () => true);
      unregister = registerWebSpeechConsentPrompt(ask);

      expect(isWebSpeechBlocked()).toBe(true);
      await expect(ensureWebSpeechConsent()).resolves.toBe(false);
      expect(ask).not.toHaveBeenCalled();
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
