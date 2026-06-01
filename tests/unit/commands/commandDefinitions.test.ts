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
    enableCodexAutoTracking: true,
    enableStoryBibleAdvanced: false,
    enableBinderResearch: false,
    enableCompileWizard: false,
    enableProjectHealthScore: false,
    enableCrossProjectSearch: true,
    enableAppHealthPanel: false,
    enablePlotBoardV2: true,
    enableDuckDbAnalytics: false,
    enableObjectsGroups: false,
    enableMindMaps: false,
    enableCharacterInterviews: false,
    enableRtlLayout: false,
    enableCloudSync: false,
    enableLoraAdapters: false,
    enablePluginSystem: false,
    enableVoiceSupport: false,
    enableProForge: false,
    enableIdbAtRestEncryption: false,
    enableVoiceWasm: false,
    enableAdaptiveAiEngine: false,
    enableWebnnInference: false,
    enableComputeShaders: false,
    enableWorkerBusV2: false,
    enableRustCompute: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(ids).toContain('set-theme-toggle');
    expect(ids).toContain('set-theme-toggle-dark');
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
    expect(byId['set-theme-toggle']?.category).toBe('settings');
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

  it('set-theme-toggle is only shown in dark theme (when dep)', () => {
    const cmds = getStaticCommandDefinitions();
    const darkToggle = cmds.find((c) => c.id === 'set-theme-toggle');
    const lightToggle = cmds.find((c) => c.id === 'set-theme-toggle-dark');
    expect(darkToggle?.when?.({ ...baseDeps, theme: 'dark' })).toBe(true);
    expect(darkToggle?.when?.({ ...baseDeps, theme: 'light' })).toBe(false);
    expect(lightToggle?.when?.({ ...baseDeps, theme: 'dark' })).toBe(false);
    expect(lightToggle?.when?.({ ...baseDeps, theme: 'light' })).toBe(true);
  });

  it('global-open-command-palette calls setCommandPaletteOpen(true)', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'global-open-command-palette');
    cmd?.run(baseDeps);
    expect(mockSetCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  it('labs-cross-project-search is only shown when flag enabled', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'labs-cross-project-search');
    expect(
      cmd?.when?.({
        ...baseDeps,
        featureFlags: { ...baseDeps.featureFlags, enableCrossProjectSearch: false },
      }),
    ).toBe(false);
    expect(
      cmd?.when?.({
        ...baseDeps,
        featureFlags: { ...baseDeps.featureFlags, enableCrossProjectSearch: true },
      }),
    ).toBe(true);
  });

  it('labs-cross-project-search calls setCrossProjectSearchOpen(true)', () => {
    const cmds = getStaticCommandDefinitions();
    const cmd = cmds.find((c) => c.id === 'labs-cross-project-search');
    cmd?.run(baseDeps);
    expect(mockSetCrossProjectSearchOpen).toHaveBeenCalledWith(true);
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
