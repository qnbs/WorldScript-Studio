// QNBS-v3 (#190): Side-effect-FREE default settings fragments. The settings *slice*
// (settingsSlice.ts) runs `applyInitialTheme()` at module load (DOM/theme side effect), so low-level
// modules (e.g. the IndexedDB storage layer) must NOT import their defaults from there — doing so
// would touch the DOM/theme on any storage import and break non-DOM runtimes. Import from here instead.
import type { Settings } from '../../types';

export const defaultDesktopSettings: Settings['desktop'] = {
  minimizeToTray: false,
};

export const defaultVoiceSettings: Settings['voice'] = {
  enabled: false,
  activationMode: 'manual',
  sttEngine: 'auto',
  ttsEngine: 'auto',
  feedbackLevel: 'standard',
  speechRate: 1.0,
  speechVolume: 1.0,
  allowCloudSttFallback: false,
  listeningTimeoutSeconds: 8,
  wakeWordPhrase: 'Hey WorldScript',
  pttShortcutId: 'voice-push-to-talk',
  ttsMuted: false,
  dictationAutoPunctuation: true,
  webSpeechConsentGranted: false,
};
