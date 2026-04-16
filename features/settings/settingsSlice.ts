import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';
import type {
  Settings,
  Theme,
  EditorFont,
  AiCreativity,
  CustomFont,
  KeyboardShortcut,
  WritingGoal,
  AdvancedAiSettings,
  AccessibilitySettings,
  PrivacySettings,
  PerformanceSettings,
  NotificationSettings,
  CollaborationSettings,
  IntegrationSettings,
  AdvancedEditorSettings,
  BackupSettings,
  ThemeCustomization,
} from '../../types';

// Detect system preference for initial theme
const getSystemThemePreference = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

const defaultSettings: Settings = {
  // Basic Settings
  theme: getSystemThemePreference(),
  editorFont: 'serif',
  fontSize: 16,
  lineSpacing: 1.6,
  aiCreativity: 'Balanced',
  paragraphSpacing: 1,
  indentFirstLine: false,

  // Advanced Settings
  keyboardShortcuts: [
    { id: 'save', keys: ['Ctrl', 'S'], action: 'save' },
    { id: 'new-section', keys: ['Ctrl', 'N'], action: 'newSection' },
    { id: 'search', keys: ['Ctrl', 'F'], action: 'search' },
    { id: 'export', keys: ['Ctrl', 'E'], action: 'export' },
  ],
  writingGoals: [
    { type: 'words', target: 2000, period: 'daily', enabled: false },
    { type: 'time', target: 120, period: 'daily', enabled: false },
  ],
  advancedAi: {
    model: 'gemini-1.5-flash',
    provider: 'gemini',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    customPrompts: {},
    rateLimit: 60,
    ollamaBaseUrl: 'http://localhost:11434',
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReader: false,
    focusIndicators: true,
    colorBlindMode: 'none',
  },
  privacy: {
    analyticsEnabled: false,
    crashReporting: false,
    dataEncryption: true,
    localStorageOnly: true,
    shareUsageData: false,
  },
  performance: {
    autoSaveInterval: 30,
    cacheSize: 100,
    preloadContent: true,
    lazyLoadImages: true,
    offlineMode: false,
  },
  notifications: {
    desktopNotifications: false,
    emailNotifications: false,
    writingReminders: 'never',
    goalAchievements: true,
    collaborationUpdates: false,
  },
  collaboration: {
    realTimeCollaboration: false,
    publicSharing: false,
    commentSystem: false,
    versionHistory: true,
  },
  integrations: {
    syncProvider: 'none',
    evernoteSync: false,
    notionSync: false,
    scrivenerExport: false,
    googleDocsImport: false,
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
};

const initialState: Settings = { ...defaultSettings };

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setSettings(state, action: PayloadAction<Settings>) {
      Object.assign(state, action.payload);
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
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
        state['customFont'] = action.payload;
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
      }>
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
      state.accessibility = { ...state.accessibility, ...action.payload };
    },
    setPrivacy(state, action: PayloadAction<Partial<PrivacySettings>>) {
      state.privacy = { ...state.privacy, ...action.payload };
    },
    setPerformance(state, action: PayloadAction<Partial<PerformanceSettings>>) {
      state.performance = { ...state.performance, ...action.payload };
    },
    setNotifications(state, action: PayloadAction<Partial<NotificationSettings>>) {
      state.notifications = { ...state.notifications, ...action.payload };
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
  },
});

// Helper function to apply initial theme on load
const applyInitialTheme = () => {
  let settings = defaultSettings;
  const hasLocalStorage =
    typeof localStorage !== 'undefined' &&
    localStorage !== null &&
    typeof localStorage.getItem === 'function';

  const storedState = hasLocalStorage ? localStorage.getItem('storycraft-state') : null;
  if (storedState) {
    const persistedState = JSON.parse(storedState);
    if (persistedState.settings) {
      settings = persistedState.settings;
    }
  }
  const theme = settings.theme === 'auto' ? getSystemThemePreference() : settings.theme;
  document.body.classList.remove('light-theme', 'dark-theme', 'auto-theme');
  document.body.classList.add(`${theme}-theme`);
};

applyInitialTheme();

export const settingsActions = settingsSlice.actions;
export default settingsSlice.reducer;
