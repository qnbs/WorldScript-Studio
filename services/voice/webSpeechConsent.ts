// QNBS-v3 (#1261): the browser's Web Speech recognition sends the audio to the browser vendor, so every start needs the stored consent.
import { appStoreRef } from '../../app/storeRef';
import { getActiveAiMode } from '../ai/aiModeService';

/** Why a start that needs Web Speech is refused while the AI mode is local-only. */
export const WEB_SPEECH_LOCAL_ONLY_MESSAGE =
  'Web Speech recognition is blocked while the AI mode is local-only. Use the local Whisper model, or switch the AI mode.';

/**
 * Whether the AI mode is local-only (local or eco, the single cloud authority, #818). QNBS-v3 (#1261): the maintainer
 * decided that local-only outranks a stored consent, so Web Speech is blocked there outright.
 */
export function isWebSpeechBlocked(): boolean {
  const mode = getActiveAiMode();
  return mode === 'local' || mode === 'eco';
}

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
 * Resolves true when Web Speech may start: the AI mode is not local-only, and consent is already stored or the
 * registered prompt asked and the user granted it. Local-only never asks. Without a prompt nothing can ask, so it
 * resolves false. Only the stored consent counts, so the answer is read back from the settings after the prompt.
 */
export async function ensureWebSpeechConsent(): Promise<boolean> {
  if (isWebSpeechBlocked()) return false;
  if (hasWebSpeechConsent()) return true;
  if (!registeredPrompt) return false;
  const granted = await registeredPrompt();
  // The AI mode may have turned local-only while the dialog was open.
  return granted && hasWebSpeechConsent() && !isWebSpeechBlocked();
}
