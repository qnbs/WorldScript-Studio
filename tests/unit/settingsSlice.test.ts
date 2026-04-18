import { beforeEach, describe, expect, it, vi } from 'vitest';
import settingsReducer, {
  applyInitialTheme,
  settingsActions,
} from '../../features/settings/settingsSlice';

const initState = () => settingsReducer(undefined, { type: '@@INIT' });

describe('settingsSlice', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.className = '';
  });

  it('returns a full initial state', () => {
    const state = initState();
    expect(state).toBeDefined();
    expect(state.theme).toBeTypeOf('string');
    expect(state.aiCreativity).toBe('Balanced');
    expect(state.keyboardShortcuts.length).toBeGreaterThan(0);
    expect(state.writingGoals.length).toBeGreaterThan(0);
  });

  it('setSettings replaces state values from payload', () => {
    const base = initState();
    const nextSettings = {
      ...base,
      theme: 'light' as const,
      fontSize: 20,
    };

    const state = settingsReducer(base, settingsActions.setSettings(nextSettings));

    expect(state.theme).toBe('light');
    expect(state.fontSize).toBe(20);
  });

  it('setTheme updates theme', () => {
    const state = settingsReducer(initState(), settingsActions.setTheme('auto'));
    expect(state.theme).toBe('auto');
  });

  it('setEditorFont updates editor font', () => {
    const state = settingsReducer(initState(), settingsActions.setEditorFont('monospace'));
    expect(state.editorFont).toBe('monospace');
  });

  it('setFontSize updates font size', () => {
    const state = settingsReducer(initState(), settingsActions.setFontSize(22));
    expect(state.fontSize).toBe(22);
  });

  it('setLineSpacing updates line spacing', () => {
    const state = settingsReducer(initState(), settingsActions.setLineSpacing(1.9));
    expect(state.lineSpacing).toBe(1.9);
  });

  it('setAiCreativity updates AI creativity level', () => {
    const state = settingsReducer(initState(), settingsActions.setAiCreativity('Imaginative'));
    expect(state.aiCreativity).toBe('Imaginative');
  });

  it('setParagraphSpacing updates paragraph spacing', () => {
    const state = settingsReducer(initState(), settingsActions.setParagraphSpacing(2.2));
    expect(state.paragraphSpacing).toBe(2.2);
  });

  it('setIndentFirstLine updates indent setting', () => {
    const state = settingsReducer(initState(), settingsActions.setIndentFirstLine(true));
    expect(state.indentFirstLine).toBe(true);
  });

  it('setCustomFont stores custom font', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setCustomFont({
        name: 'My Font',
        url: 'https://example.test/font.woff2',
        format: 'woff2',
      }),
    );

    expect(state.customFont).toEqual({
      name: 'My Font',
      url: 'https://example.test/font.woff2',
      format: 'woff2',
    });
  });

  it('setCustomFont removes custom font when payload is undefined', () => {
    const withFont = settingsReducer(
      initState(),
      settingsActions.setCustomFont({
        name: 'Temp Font',
        url: 'https://example.test/temp.woff',
        format: 'woff',
      }),
    );

    const state = settingsReducer(withFont, settingsActions.setCustomFont(undefined));

    expect(state.customFont).toBeUndefined();
  });

  it('setKeyboardShortcuts replaces shortcut list', () => {
    const shortcuts = [
      { id: 'toggle-theme', keys: ['Ctrl', 'J'], action: 'toggleTheme' },
      { id: 'open-command-palette', keys: ['Ctrl', 'K'], action: 'openCommandPalette' },
    ];

    const state = settingsReducer(initState(), settingsActions.setKeyboardShortcuts(shortcuts));
    expect(state.keyboardShortcuts).toEqual(shortcuts);
  });

  it('updateKeyboardShortcut updates only matching shortcut', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.updateKeyboardShortcut({
        id: 'save',
        shortcut: { keys: ['Meta', 'S'] },
      }),
    );

    const saveShortcut = state.keyboardShortcuts.find((s) => s.id === 'save');
    expect(saveShortcut?.keys).toEqual(['Meta', 'S']);
  });

  it('updateKeyboardShortcut is a no-op for unknown id', () => {
    const base = initState();
    const state = settingsReducer(
      base,
      settingsActions.updateKeyboardShortcut({
        id: 'does-not-exist',
        shortcut: { keys: ['Ctrl', 'X'] },
      }),
    );

    expect(state.keyboardShortcuts).toEqual(base.keyboardShortcuts);
  });

  it('setWritingGoals replaces goals list', () => {
    const goals = [{ type: 'words' as const, target: 3500, period: 'daily', enabled: true }];
    const state = settingsReducer(initState(), settingsActions.setWritingGoals(goals));
    expect(state.writingGoals).toEqual(goals);
  });

  it('updateWritingGoal updates goal by index', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.updateWritingGoal({
        index: 1,
        goal: { enabled: true, target: 180 },
      }),
    );

    expect(state.writingGoals[1]?.enabled).toBe(true);
    expect(state.writingGoals[1]?.target).toBe(180);
  });

  it('updateWritingGoal is a no-op for out-of-range index', () => {
    const base = initState();
    const state = settingsReducer(
      base,
      settingsActions.updateWritingGoal({
        index: 99,
        goal: { enabled: true },
      }),
    );

    expect(state.writingGoals).toEqual(base.writingGoals);
  });

  it('setAdvancedAi merges advanced AI settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setAdvancedAi({
        provider: 'openai',
        model: 'gpt-4o-mini',
        rateLimit: 30,
      }),
    );

    expect(state.advancedAi.provider).toBe('openai');
    expect(state.advancedAi.model).toBe('gpt-4o-mini');
    expect(state.advancedAi.rateLimit).toBe(30);
    expect(state.advancedAi.temperature).toBe(0.7);
  });

  it('setAccessibility merges accessibility settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setAccessibility({ reducedMotion: true, colorBlindMode: 'deuteranopia' }),
    );

    expect(state.accessibility.reducedMotion).toBe(true);
    expect(state.accessibility.colorBlindMode).toBe('deuteranopia');
    expect(state.accessibility.focusIndicators).toBe(true);
  });

  it('setPrivacy merges privacy settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setPrivacy({ analyticsEnabled: true, shareUsageData: true }),
    );

    expect(state.privacy.analyticsEnabled).toBe(true);
    expect(state.privacy.shareUsageData).toBe(true);
    expect(state.privacy.dataEncryption).toBe(true);
  });

  it('setPerformance merges performance settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setPerformance({ autoSaveInterval: 10, offlineMode: true }),
    );

    expect(state.performance.autoSaveInterval).toBe(10);
    expect(state.performance.offlineMode).toBe(true);
    expect(state.performance.preloadContent).toBe(true);
  });

  it('setNotifications merges notification settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setNotifications({ desktopNotifications: true, writingReminders: 'daily' }),
    );

    expect(state.notifications.desktopNotifications).toBe(true);
    expect(state.notifications.writingReminders).toBe('daily');
    expect(state.notifications.goalAchievements).toBe(true);
  });

  it('setCollaboration merges collaboration settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setCollaboration({ realTimeCollaboration: true, commentSystem: true }),
    );

    expect(state.collaboration.realTimeCollaboration).toBe(true);
    expect(state.collaboration.commentSystem).toBe(true);
    expect(state.collaboration.versionHistory).toBe(true);
  });

  it('setIntegrations merges integration settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setIntegrations({
        syncProvider: 'google-drive',
        googleDocsImport: true,
      }),
    );

    expect(state.integrations.syncProvider).toBe('google-drive');
    expect(state.integrations.googleDocsImport).toBe(true);
    expect(state.integrations.notionSync).toBe(false);
  });

  it('setAdvancedEditor merges editor settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setAdvancedEditor({
        focusMode: true,
        customDictionary: ['storycraft', 'worldbuilding'],
      }),
    );

    expect(state.advancedEditor.focusMode).toBe(true);
    expect(state.advancedEditor.customDictionary).toEqual(['storycraft', 'worldbuilding']);
    expect(state.advancedEditor.autoComplete).toBe(true);
  });

  it('setBackup merges backup settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setBackup({
        backupFrequency: 'daily',
        backupLocation: '/tmp/storycraft-backups',
      }),
    );

    expect(state.backup.backupFrequency).toBe('daily');
    expect(state.backup.backupLocation).toBe('/tmp/storycraft-backups');
    expect(state.backup.autoBackup).toBe(true);
  });

  it('setThemeCustomization merges theme customization settings', () => {
    const state = settingsReducer(
      initState(),
      settingsActions.setThemeCustomization({
        primaryColor: '#ff0000',
        customCss: 'body { letter-spacing: 0.01em; }',
      }),
    );

    expect(state.themeCustomization.primaryColor).toBe('#ff0000');
    expect(state.themeCustomization.customCss).toBe('body { letter-spacing: 0.01em; }');
    expect(state.themeCustomization.accentColor).toBe('#f59e0b');
  });

  it('applyInitialTheme applies persisted theme from localStorage roundtrip', () => {
    const state = settingsReducer(initState(), settingsActions.setTheme('light'));

    localStorage.setItem('storycraft-state', JSON.stringify({ settings: state }));
    document.body.classList.add('dark-theme', 'auto-theme');

    applyInitialTheme();

    expect(document.body.classList.contains('light-theme')).toBe(true);
    expect(document.body.classList.contains('dark-theme')).toBe(false);
    expect(document.body.classList.contains('auto-theme')).toBe(false);
  });

  it('applyInitialTheme resolves auto theme using current system preference', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const state = settingsReducer(initState(), settingsActions.setTheme('auto'));
    localStorage.setItem('storycraft-state', JSON.stringify({ settings: state }));

    applyInitialTheme();

    expect(document.body.classList.contains('dark-theme')).toBe(true);
    expect(document.body.classList.contains('auto-theme')).toBe(false);
  });
});
