// QNBS-v3 (#1261): the browser's Web Speech recognition sends the audio to the browser vendor, so every start needs the stored consent.
import { appStoreRef } from '../../app/storeRef';

/** Asks the user for Web Speech consent; resolves true only when they granted it. */
export type WebSpeechConsentPrompt = () => Promise<boolean>;

let registeredPrompt: WebSpeechConsentPrompt | null = null;

/** Whether the stored settings hold Web Speech consent. Fails closed when no store is available. */
export function hasWebSpeechConsent(): boolean {
  return appStoreRef.current?.getState().settings.voice?.webSpeechConsentGranted === true;
}

/** Registers the UI that asks for consent (`WebSpeechConsentHost`); returns the unregister function. */
export function registerWebSpeechConsentPrompt(prompt: WebSpeechConsentPrompt): () => void {
  registeredPrompt = prompt;
  return () => {
    if (registeredPrompt === prompt) registeredPrompt = null;
  };
}

/**
 * Resolves true when Web Speech may start: consent is already stored, or the registered prompt asked
 * and the user granted it. Without a prompt nothing can ask, so it resolves false. Only the stored
 * consent counts, so the answer is read back from the settings after the prompt.
 */
export async function ensureWebSpeechConsent(): Promise<boolean> {
  if (hasWebSpeechConsent()) return true;
  if (!registeredPrompt) return false;
  const granted = await registeredPrompt();
  return granted && hasWebSpeechConsent();
}
