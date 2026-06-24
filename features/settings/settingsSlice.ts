import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type {
  AccessibilitySettings,
  AdvancedAiSettings,
  AdvancedEditorSettings,
  AiCreativity,
  AiMode,
  AppearancePreset,
  BackupSettings,
  CollaborationSettings,
  CustomFont,
  DesktopSettings,
  EditorFont,
  IntegrationSettings,
  KeyboardShortcut,
  OpenRouterSettings,
  PrivacySettings,
  Settings,
  Theme,
  ThemeCustomization,
  VoiceSettings,
  WritingGoal,
} from '../../types';
import { normalizeAccessibilitySettings } from './accessibilitySchema';
import { getDefaultKeyboardShortcuts } from './keyboardShortcutsDefaults';
import { defaultDesktopSettings, defaultVoiceSettings } from './settingsDefaults';

// Detect system preference for initial theme
const getSystemThemePreference = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

export const DEFAULT_OPENROUTER_SETTINGS: OpenRouterSettings = {
  enabled: false,
  apiKey: '',
  // QNBS-v3: DeepSeek R1 free tier — strong reasoning + no cost, ideal default (zero friction).
  preferredModel: 'deepseek/deepseek-r1:free',
};

const defaultSettings: Settings = {
  // Basic Settings
  theme: getSystemThemePreference(),
  appearancePreset: 'sepia',
  aiMode: 'hybrid',
  openRouter: DEFAULT_OPENROUTER_SETTINGS,
  editorFont: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  aiCreativity: 'Balanced',
  paragraphSpacing: 1,
  indentFirstLine: false,

  // Advanced Settings
  keyboardShortcuts: getDefaultKeyboardShortcuts(),
  writingGoals: [
    { type: 'words', target: 2000, period: 'daily', enabled: false },
    { type: 'time', target: 120, period: 'daily', enabled: false },
  ],
  advancedAi: {
    model: 'gemini-3.5-flash',
    provider: 'gemini',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
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
    // QNBS-v3: SEC — analytics default ON because the data is local-only metadata (no manuscript
    // prose, never leaves the device) and the analytics dashboard relies on it. The toggle is now a
    // functional opt-out (gates DuckDB writes + inference telemetry via isAnalyticsPersistenceAllowed).
    analyticsEnabled: true,
    dataEncryption: true,
    localStorageOnly: true,
    euDataResidency: true,
    // QNBS-v3: SEC — fresh installs are born post-migration so the normalizer respects this default.
    analyticsGateMigrated: true,
  },
  collaboration: {
    realTimeCollaboration: false,
    publicSharing: false,
    commentSystem: true,
    versionHistory: true,
    webrtcSignalingUrls: ['wss://y-webrtc-signaling.fly.dev', 'wss://signaling.yjs.dev'],
  },
  integrations: {
    syncProvider: 'none',
    evernoteSync: false,
    notionSync: false,
    scrivenerExport: false,
    googleDocsImport: false,
    languageToolEnabled: false,
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
  backup: {
    autoBackup: true,
    backupFrequency: 'weekly',
    backupLocation: './backups',
    maxBackups: 10,
    encryptBackups: false,
  },
  themeCustomization: {
    primaryColor: '#3b82f6',
    secondaryColor: '#64748b',
    accentColor: '#f59e0b',
    backgroundColor: '#0f172a',
    textColor: '#f8fafc',
    customCss: '',
  },
  voice: defaultVoiceSettings,
  // QNBS-v3 (T2): desktop-only behavior; default off so the web/PWA is unaffected.
  desktop: defaultDesktopSettings,
};

// QNBS-v3 (#190): re-exported (sourced from the side-effect-free settingsDefaults module) so existing
// importers keep working, while low-level modules (storage layer) import straight from settingsDefaults
// to avoid triggering this slice's top-level applyInitialTheme().
export { defaultDesktopSettings, defaultVoiceSettings };
// QNBS-v3: exported so components + IDB rehydration can backfill missing nested objects
// (older persisted settings lacked advancedEditor/themeCustomization → page crash on read).
export const defaultAdvancedEditorSettings = defaultSettings.advancedEditor;
export const defaultThemeCustomization = defaultSettings.themeCustomization;

const initialState: Settings = { ...defaultSettings };

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setSettings(state, action: PayloadAction<Settings>) {
      Object.assign(state, action.payload);
      state.accessibility = normalizeAccessibilitySettings(state.accessibility);
      // QNBS-v3: backfill aiMode for settings persisted before v1.22
      if (!state.aiMode) state.aiMode = 'hybrid';
      // QNBS-v3: backfill openRouter for settings persisted before OpenRouter integration
      if (!state.openRouter) state.openRouter = { ...DEFAULT_OPENROUTER_SETTINGS };
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
    },
    setAppearancePreset(state, action: PayloadAction<AppearancePreset>) {
      state.appearancePreset = action.payload;
    },
    setAiMode(state, action: PayloadAction<AiMode>) {
      state.aiMode = action.payload;
    },
    setEditorFont(state, action: PayloadAction<EditorFont>) {
      state.editorFont = action.payload;
    },
    setFontSize(state, action: PayloadAction<number>) {
      state.fontSize = action.payload;
    },
    setLineSpacing(state, action: PayloadAction<number>) {
      state.lineSpacing = action.payload;
    },
    setAiCreativity(state, action: PayloadAction<AiCreativity>) {
      state.aiCreativity = action.payload;
    },
    setParagraphSpacing(state, action: PayloadAction<number>) {
      state.paragraphSpacing = action.payload;
    },
    setIndentFirstLine(state, action: PayloadAction<boolean>) {
      state.indentFirstLine = action.payload;
    },
    // Advanced Settings Reducers
    setCustomFont(state, action: PayloadAction<CustomFont | undefined>) {
      if (action.payload !== undefined) {
        state.customFont = action.payload;
      } else {
        delete (state as Record<string, unknown>)['customFont'];
      }
    },
    setKeyboardShortcuts(state, action: PayloadAction<KeyboardShortcut[]>) {
      state.keyboardShortcuts = action.payload;
    },
    updateKeyboardShortcut(
      state,
      action: PayloadAction<{
        id: string;
        shortcut: Partial<KeyboardShortcut>;
      }>,
    ) {
      const index = state.keyboardShortcuts.findIndex((s) => s.id === action.payload.id);
      const shortcut = state.keyboardShortcuts[index];
      if (shortcut) {
        Object.assign(shortcut, action.payload.shortcut);
      }
    },
    setWritingGoals(state, action: PayloadAction<WritingGoal[]>) {
      state.writingGoals = action.payload;
    },
    updateWritingGoal(state, action: PayloadAction<{ index: number; goal: Partial<WritingGoal> }>) {
      const goal = state.writingGoals[action.payload.index];
      if (goal) {
        Object.assign(goal, action.payload.goal);
      }
    },
    setAdvancedAi(state, action: PayloadAction<Partial<AdvancedAiSettings>>) {
      state.advancedAi = { ...state.advancedAi, ...action.payload };
    },
    setAccessibility(state, action: PayloadAction<Partial<AccessibilitySettings>>) {
      state.accessibility = normalizeAccessibilitySettings({
        ...state.accessibility,
        ...action.payload,
      });
    },
    setPrivacy(state, action: PayloadAction<Partial<PrivacySettings>>) {
      state.privacy = { ...state.privacy, ...action.payload };
    },
    setCollaboration(state, action: PayloadAction<Partial<CollaborationSettings>>) {
      state.collaboration = { ...state.collaboration, ...action.payload };
    },
    setIntegrations(state, action: PayloadAction<Partial<IntegrationSettings>>) {
      state.integrations = { ...state.integrations, ...action.payload };
    },
    setAdvancedEditor(state, action: PayloadAction<Partial<AdvancedEditorSettings>>) {
      state.advancedEditor = { ...state.advancedEditor, ...action.payload };
    },
    setBackup(state, action: PayloadAction<Partial<BackupSettings>>) {
      state.backup = { ...state.backup, ...action.payload };
    },
    setThemeCustomization(state, action: PayloadAction<Partial<ThemeCustomization>>) {
      state.themeCustomization = {
        ...state.themeCustomization,
        ...action.payload,
      };
    },
    setVoiceSettings(state, action: PayloadAction<Partial<VoiceSettings>>) {
      state.voice = { ...state.voice, ...action.payload };
    },
    setDesktopSettings(state, action: PayloadAction<Partial<DesktopSettings>>) {
      state.desktop = { ...(state.desktop ?? defaultDesktopSettings), ...action.payload };
    },
    setOpenRouter(state, action: PayloadAction<Partial<OpenRouterSettings>>) {
      state.openRouter = {
        ...(state.openRouter ?? DEFAULT_OPENROUTER_SETTINGS),
        ...action.payload,
      };
    },
    resetVoiceSettings(state) {
      state.voice = {
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
      };
    },
  },
});

// Helper function to apply initial theme on load
export const applyInitialTheme = () => {
  let settings = defaultSettings;
  const hasLocalStorage =
    typeof localStorage !== 'undefined' &&
    localStorage !== null &&
    typeof localStorage.getItem === 'function';

  // Fast path: read simple theme string mirrored by App.tsx
  const directTheme = hasLocalStorage ? localStorage.getItem('worldscript-theme') : null;
  if (directTheme === 'dark' || directTheme === 'light') {
    document.body.classList.remove('light-theme', 'dark-theme', 'auto-theme');
    document.body.classList.add(`${directTheme}-theme`);
    return;
  }

  // Fallback: read from legacy serialized state (used in tests)
  const storedState = hasLocalStorage ? localStorage.getItem('worldscript-state') : null;
  if (storedState) {
    try {
      const persistedState = JSON.parse(storedState);
      if (persistedState.settings) {
        settings = persistedState.settings;
      }
    } catch {
      // Corrupted localStorage — fall through to defaults
    }
  }
  const theme = settings.theme === 'auto' ? getSystemThemePreference() : settings.theme;
  document.body.classList.remove('light-theme', 'dark-theme', 'auto-theme');
  document.body.classList.add(`${theme}-theme`);
};

applyInitialTheme();

export const selectVoiceSettings = (state: { settings: Settings }) =>
  state.settings.voice ?? defaultVoiceSettings;

export const settingsActions = settingsSlice.actions;
export default settingsSlice.reducer;
