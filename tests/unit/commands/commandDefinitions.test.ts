import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEntityCommands,
  buildLanguageCommands,
  getStaticCommandDefinitions,
} from '../../../services/commands/commandDefinitions';
import type { CommandRuntimeDeps } from '../../../services/commands/commandTypes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetCommandPaletteOpen = vi.fn();
const mockSetCrossProjectSearchOpen = vi.fn();

vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: {
    getState: () => ({
      setCommandPaletteOpen: mockSetCommandPaletteOpen,
      setCrossProjectSearchOpen: mockSetCrossProjectSearchOpen,
    }),
  },
}));

vi.mock('../../../constants', () => ({
  ICONS: {
    DASHBOARD: null,
    WRITER: null,
    SPARKLES: null,
    TEMPLATES: null,
    OUTLINE: null,
    CHARACTERS: null,
    WORLD: null,
    EXPORT: null,
    SETTINGS: null,
    HELP: null,
    ADD: null,
    LIGHTNING_BOLT: null,
    CRITIC: null,
  },
}));

// QNBS-v3: dynamic import in help-tour run() — mock so tests don't trigger real import
vi.mock('../../../services/spotlightTour', () => ({
  startSpotlightTour: vi.fn(),
}));

// QNBS-v3: OpenRouter circuit state is module-level in the provider — mock for determinism.
// `mock`-prefixed names are allowed inside the hoisted vi.mock factory.
const mockIsCircuitOpen = vi.fn(() => false);
const mockResetOpenRouterCircuit = vi.fn();
vi.mock('../../../services/ai/providers/openrouterProvider', () => ({
  isCircuitOpen: () => mockIsCircuitOpen(),
  resetOpenRouterCircuit: () => mockResetOpenRouterCircuit(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockNavigate = vi.fn();
const mockSetLanguage = vi.fn();
const mockT = (key: string, reps?: Record<string, string>) => {
  if (reps) return Object.entries(reps).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), key);
  return key;
};

const baseDeps: CommandRuntimeDeps = {
  dispatch: mockDispatch as unknown as CommandRuntimeDeps['dispatch'],
  navigate: mockNavigate,
  setLanguage: mockSetLanguage,
  t: mockT as CommandRuntimeDeps['t'],
  theme: 'dark',
  language: 'en',
  characters: [],
  worlds: [],
  currentView: 'dashboard',
  wordCountApprox: 0,
  featureFlags: {
    enableStoryBibleAdvanced: false,
    enableBinderResearch: false,
    enableCompileWizard: false,
    enableProjectHealthScore: false,
    enableAppHealthPanel: false,
    enableDuckDbAnalytics: false,
    enableObjectsGroups: false,
    enableMindMaps: false,
    enableCharacterInterviews: false,
    enableRtlLayout: false,
    enableLoraAdapters: false,
    enablePluginSystem: false,
    enableVoiceSupport: false,
    enableProForge: false,
    enableIdbAtRestEncryption: false,
    enableVoiceWasm: false,
    enableAdaptiveAiEngine: false,
    enableComputeShaders: false,
    enableWorkerBusV2: false,
    enableRustCompute: false,
    enableGlobalCopilot: false,
    enableLocalFirstSync: false,
  },
  aiMode: 'hybrid',
  openRouterEnabled: false,
  appearancePreset: 'default',
  advancedEditor: {
    distractionFree: false,
    typewriterMode: false,
    zenMode: false,
    focusMode: false,
  },
  accessibility: { highContrast: false, reducedMotion: false, largeText: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  // QNBS-v3: clearAllMocks only clears call history — restore the default impl each test so a
  // per-test mockReturnValue(true) cannot leak the circuit-open state into later cases.
  mockIsCircuitOpen.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// getStaticCommandDefinitions
// ---------------------------------------------------------------------------
describe('getStaticCommandDefinitions', () => {
  it('returns a non-empty array', () => {
    const cmds = getStaticCommandDefinitions();
    expect(cmds.length).toBeGreaterThan(0);
  });

  it('includes all expected navigation IDs', () => {
    const cmds = getStaticCommandDefinitions();
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('nav-dashboard');
    expect(ids).toContain('nav-manuscript');
    expect(ids).toContain('nav-writer');
    expect(ids).toContain('nav-templates');
    expect(ids).toContain('nav-characters');
    expect(ids).toContain('nav-world');
    expect(ids).toContain('nav-export');
    expect(ids).toContain('nav-settings');
    expect(ids).toContain('nav-help');
    expect(ids).toContain('nav-sceneboard');
    expect(ids).toContain('nav-character-graph');
    expect(ids).toContain('nav-consistency');
    expect(ids).toContain('nav-critic');
  });

  it('includes AI action IDs', () => {
    const cmds = getStaticCommandDefinitions();
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('ai-outline');
    expect(ids).toContain('ai-character');
    expect(ids).toContain('ai-consistency');
    expect(ids).toContain('ai-critic');
    expect(ids).toContain('ai-writer');
  });

  it('includes settings command IDs', () => {
    const cmds = getStaticCommandDefinitions();
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('set-theme-dark');
    expect(ids).toContain('set-theme-light');
  });

  it('includes help command IDs', () => {
    const cmds = getStaticCommandDefinitions();
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('help-open');
    expect(ids).toContain('help-tour');
  });

  it('includes global command IDs', () => {
    const cmds = getStaticCommandDefinitions();
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('global-open-command-palette');
    expect(ids).toContain('global-dashboard');
  });

  it('assigns correct categories', () => {
    const cmds = getStaticCommandDefinitions();
    const byId = Object.fromEntries(cmds.map((c) => [c.id, c]));
    expect(byId['nav-dashboard']?.category).toBe('navigation');
    expect(byId['ai-outline']?.category).toBe('aiActions');
    expect(byId['act-new-char']?.category).toBe('projectManagement');
    expect(byId['set-theme-dark']?.category).toBe('appearance');
    expect(byId['help-open']?.category).toBe('help');
    expect(byId['global-dashboard']?.category).toBe('global');
    expect(byId['editor-manuscript']?.category).toBe('editor');
  });

  it('navigation commands call navigate on run', () => {
    const cmds = getStaticCommandDefinitions();
    const navDashboard = cmds.find((c) => c.id === 'nav-dashboard');
    navDashboard?.run(baseDeps);
    expect(mockNavigate).toHaveBeenCalledWith('dashboard');
  });

  // QNBS-v3: set-theme-dark shown when NOT already dark; set-theme-light shown when NOT already light
  it('set-theme-dark/light are shown only when not already on that theme', () => {
    const cmds = getStaticCommandDefinitions();
    const darkCmd = cmds.find((c) => c.id === 'set-theme-dark');
    const lightCmd = cmds.find((c) => c.id === 'set-theme-light');
    expect(darkCmd?.when?.({ ...baseDeps, theme: 'dark' })).toBe(false);
    expect(darkCmd?.when?.({ ...baseDeps, theme: 'light' })).toBe(true);
    expect(lightCmd?.when?.({ ...baseDeps, theme: 'light' })).toBe(false);
    expect(lightCmd?.when?.({ ...baseDeps, theme: 'dark' })).toBe(true);
  });

  it('global-open-command-palette calls setCommandPaletteOpen(true)', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'global-open-command-palette');
    cmd?.run(baseDeps);
    expect(mockSetCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  // QNBS-v3: enableCrossProjectSearch promoted to permanent core — command has no when guard.
  it('labs-cross-project-search has no feature-flag when guard (always available)', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'labs-cross-project-search');
    expect(cmd?.when).toBeUndefined();
  });

  it('labs-cross-project-search calls setCrossProjectSearchOpen(true)', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'labs-cross-project-search');
    cmd?.run(baseDeps);
    expect(mockSetCrossProjectSearchOpen).toHaveBeenCalledWith(true);
  });
});

// ---------------------------------------------------------------------------
// OpenRouter commands (TODO v1.23 P1)
// ---------------------------------------------------------------------------
describe('OpenRouter palette commands', () => {
  it('exposes toggle + resetCircuit with aiActions category', () => {
    const cmds = getStaticCommandDefinitions();
    const byId = Object.fromEntries(cmds.map((c) => [c.id, c]));
    expect(byId['ai.mode.openrouter.toggle']?.category).toBe('aiActions');
    expect(byId['ai.mode.openrouter.resetCircuit']?.category).toBe('aiActions');
  });

  it('toggle enables OpenRouter when currently disabled', () => {
    const cmd = getStaticCommandDefinitions().find((c) => c.id === 'ai.mode.openrouter.toggle');
    cmd?.run({ ...baseDeps, openRouterEnabled: false });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { enabled: true } }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'palette.openRouter.enabledToast' }),
      }),
    );
  });

  it('toggle disables OpenRouter when currently enabled', () => {
    const cmd = getStaticCommandDefinitions().find((c) => c.id === 'ai.mode.openrouter.toggle');
    cmd?.run({ ...baseDeps, openRouterEnabled: true });
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { enabled: false } }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'palette.openRouter.disabledToast' }),
      }),
    );
  });

  // QNBS-v3: `when` gates ONLY on the reactive openRouterEnabled dep (no module-level circuit read),
  // so the palette's deps-keyed memo can't cache a stale visibility result (CodeAnt #131).
  it('resetCircuit visibility depends only on openRouterEnabled, never on circuit state', () => {
    const cmd = getStaticCommandDefinitions().find(
      (c) => c.id === 'ai.mode.openrouter.resetCircuit',
    );
    mockIsCircuitOpen.mockReturnValue(true);
    expect(cmd?.when?.({ ...baseDeps, openRouterEnabled: false })).toBe(false);
    expect(cmd?.when?.({ ...baseDeps, openRouterEnabled: true })).toBe(true);
    // Visibility is identical regardless of the (non-reactive) circuit-open flag.
    mockIsCircuitOpen.mockReturnValue(false);
    expect(cmd?.when?.({ ...baseDeps, openRouterEnabled: false })).toBe(false);
    expect(cmd?.when?.({ ...baseDeps, openRouterEnabled: true })).toBe(true);
  });

  it('resetCircuit clears the breaker and announces it when the circuit is open', () => {
    const cmd = getStaticCommandDefinitions().find(
      (c) => c.id === 'ai.mode.openrouter.resetCircuit',
    );
    mockIsCircuitOpen.mockReturnValue(true);
    cmd?.run({ ...baseDeps, openRouterEnabled: true });
    expect(mockResetOpenRouterCircuit).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ title: 'palette.openRouter.resetToast' }),
      }),
    );
  });

  it('resetCircuit is a no-op with an info toast when the circuit is not open', () => {
    const cmd = getStaticCommandDefinitions().find(
      (c) => c.id === 'ai.mode.openrouter.resetCircuit',
    );
    mockIsCircuitOpen.mockReturnValue(false);
    cmd?.run({ ...baseDeps, openRouterEnabled: true });
    expect(mockResetOpenRouterCircuit).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.any(String),
        payload: expect.objectContaining({
          type: 'info',
          title: 'palette.openRouter.noPause',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// buildLanguageCommands
// ---------------------------------------------------------------------------
describe('buildLanguageCommands', () => {
  it('excludes the currently active language', () => {
    const cmds = buildLanguageCommands({ ...baseDeps, language: 'en' });
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('set-lang-en');
  });

  it('includes the other 4 languages when active is en', () => {
    const cmds = buildLanguageCommands({ ...baseDeps, language: 'en' });
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('set-lang-de');
    expect(ids).toContain('set-lang-fr');
    expect(ids).toContain('set-lang-es');
    expect(ids).toContain('set-lang-it');
  });

  it('calls setLanguage with correct lang code on run', () => {
    const cmds = buildLanguageCommands({ ...baseDeps, language: 'en' });
    const deCmd = cmds.find((c) => c.id === 'set-lang-de');
    deCmd?.run(baseDeps);
    expect(mockSetLanguage).toHaveBeenCalledWith('de');
  });

  it('all returned commands have category "settings"', () => {
    const cmds = buildLanguageCommands({ ...baseDeps, language: 'fr' });
    for (const c of cmds) expect(c.category).toBe('settings');
  });

  it('returns 4 commands when active language is de', () => {
    const cmds = buildLanguageCommands({ ...baseDeps, language: 'de' });
    expect(cmds).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// buildEntityCommands
// ---------------------------------------------------------------------------
describe('buildEntityCommands', () => {
  it('returns empty array when no characters or worlds', () => {
    const cmds = buildEntityCommands({ ...baseDeps, characters: [], worlds: [] });
    expect(cmds).toHaveLength(0);
  });

  it('creates one command per character', () => {
    const cmds = buildEntityCommands({
      ...baseDeps,
      characters: [
        { id: 'c1', name: 'Alice' },
        { id: 'c2', name: 'Bob' },
      ],
      worlds: [],
    });
    expect(cmds).toHaveLength(2);
    expect(cmds[0]?.id).toBe('char-c1');
    expect(cmds[1]?.id).toBe('char-c2');
  });

  it('creates one command per world', () => {
    const cmds = buildEntityCommands({
      ...baseDeps,
      characters: [],
      worlds: [{ id: 'w1', name: 'Middle Earth' }],
    });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]?.id).toBe('world-w1');
  });

  it('character commands navigate to characters view', () => {
    const cmds = buildEntityCommands({
      ...baseDeps,
      characters: [{ id: 'c1', name: 'Alice' }],
      worlds: [],
    });
    cmds[0]?.run(baseDeps);
    expect(mockNavigate).toHaveBeenCalledWith('characters');
  });

  it('world commands navigate to world view', () => {
    const cmds = buildEntityCommands({
      ...baseDeps,
      characters: [],
      worlds: [{ id: 'w1', name: 'Narnia' }],
    });
    cmds[0]?.run(baseDeps);
    expect(mockNavigate).toHaveBeenCalledWith('world');
  });

  it('character name is set as inlineTitle', () => {
    const cmds = buildEntityCommands({
      ...baseDeps,
      characters: [{ id: 'c1', name: 'Gandalf' }],
      worlds: [],
    });
    expect(cmds[0]?.inlineTitle).toBe('Gandalf');
  });
});
