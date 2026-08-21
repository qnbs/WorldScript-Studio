import { describe, expect, it, vi } from 'vitest';
import { normalizeAccessibilitySettings } from '../../features/settings/accessibilitySchema';
import { assertLanguageToolAllowed, languageToolPing } from '../../services/languageToolClient';
import type { Settings } from '../../types';

const baseSettings = (): Settings => ({
  theme: 'dark',
  appearancePreset: 'default',
  writingSurfaceStyle: 'textured',
  aiMode: 'hybrid',
  editorFont: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  aiCreativity: 'Balanced',
  paragraphSpacing: 1,
  indentFirstLine: false,
  keyboardShortcuts: [],
  writingGoals: [],
  advancedAi: {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    customPrompts: {},
    rateLimit: 60,
    ollamaBaseUrl: 'http://localhost:11434',
    localBackendPreset: 'ollama_default',
    openAiCompatibleBaseUrl: '',
    openAiSiteUrl: '',
    openAiSiteTitle: 'WorldScript Studio',
    hybridFallbackEnabled: false,
    hybridFallbackChain: [],
    ragMode: 'hybrid',
  },
  accessibility: normalizeAccessibilitySettings({
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
    focusIndicators: true,
    colorBlindMode: 'none',
  }),
  privacy: {
    analyticsEnabled: false,
    dataEncryption: true,
    localStorageOnly: true,
    euDataResidency: true,
  },
  collaboration: {
    webrtcSignalingUrls: [],
  },
  integrations: {
    languageToolEnabled: true,
    languageToolBaseUrl: 'http://localhost:8010',
  },
  advancedEditor: {
    autoComplete: true,
    spellCheck: true,
    grammarCheck: true,
    wordCount: true,
    readingTime: true,
    distractionFree: false,
    typewriterMode: false,
    zenMode: false,
    focusMode: false,
    customDictionary: [],
    writingStats: true,
  },
  themeCustomization: {
    primaryColor: '#3b82f6',
    secondaryColor: '#64748b',
    accentColor: '#f59e0b',
    backgroundColor: '#0f172a',
    textColor: '#f8fafc',
    customCss: '',
  },
  voice: {
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
  },
  // QNBS-v3: Settings fixture must include the desktop group so assertLanguageToolAllowed's full Settings type-check compiles.
  desktop: {
    minimizeToTray: false,
    desktopNotifications: false,
  },
});

describe('languageToolClient', () => {
  it('blocks a ping before sending sample text to an unlisted origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(languageToolPing('https://unlisted.example.test')).rejects.toThrow(
      /blocked.*CSP network policy/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('allows localhost when local-only privacy is on', () => {
    expect(() =>
      assertLanguageToolAllowed(baseSettings(), 'http://localhost:8010/v2/check'),
    ).not.toThrow();
  });

  it('blocks remote URLs when local-only privacy is on', () => {
    expect(() =>
      assertLanguageToolAllowed(baseSettings(), 'https://api.languagetool.org/'),
    ).toThrow(/blocked/i);
  });

  it('throws when disabled', () => {
    const s = baseSettings();
    s.integrations.languageToolEnabled = false;
    expect(() => assertLanguageToolAllowed(s, 'http://localhost:8010')).toThrow(/disabled/i);
  });
});
