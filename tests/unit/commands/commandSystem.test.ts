import { describe, expect, it, vi } from 'vitest';

// Mock transient UI store used by global-open-command-palette command
vi.mock('../../../app/transientUiStore', () => ({
  useTransientUiStore: {
    getState: vi.fn().mockReturnValue({ setCommandPaletteOpen: vi.fn() }),
  },
}));

// Mock spotlight tour (dynamic import inside help-tour command run)
vi.mock('../../../services/spotlightTour', () => ({
  startSpotlightTour: vi.fn(),
}));

import type { FeatureFlagsState } from '../../../features/featureFlags/featureFlagsSlice';
import { getLocalAiSuggestions } from '../../../services/commands/aiSuggestions';
import {
  buildPaletteCommandModels,
  collectAllDefinitions,
  runCommandById,
} from '../../../services/commands/commandBuilder';
import {
  buildEntityCommands,
  buildLanguageCommands,
  getStaticCommandDefinitions,
} from '../../../services/commands/commandDefinitions';
import type { CommandRuntimeDeps, I18nTranslate } from '../../../services/commands/commandTypes';
import { getEffectiveTheme } from '../../../services/commands/effectiveTheme';
import { approximateManuscriptWordCount } from '../../../services/commands/wordCountApprox';

const defaultFeatureFlags: FeatureFlagsState = {
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
  enableWebnnInference: false,
  enableComputeShaders: false,
  enableWorkerBusV2: false,
  enableRustCompute: false,
  enableGlobalCopilot: false,
};

function makeDeps(overrides?: Partial<CommandRuntimeDeps>): CommandRuntimeDeps {
  return {
    dispatch: vi.fn(),
    navigate: vi.fn(),
    setLanguage: vi.fn(),
    t: ((key: string, replacements?: Record<string, string>) => {
      if (replacements?.['name']) return `${key}:${replacements['name']}`;
      return key;
    }) as I18nTranslate,
    theme: 'light',
    language: 'en',
    characters: [],
    worlds: [],
    currentView: 'dashboard',
    wordCountApprox: 0,
    featureFlags: { ...defaultFeatureFlags },
    aiMode: 'hybrid',
    appearancePreset: 'default',
    advancedEditor: {
      distractionFree: false,
      typewriterMode: false,
      zenMode: false,
      focusMode: false,
    },
    accessibility: { highContrast: false, reducedMotion: false, largeText: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// wordCountApprox
// ---------------------------------------------------------------------------
describe('approximateManuscriptWordCount', () => {
  it('returns 0 for undefined data', () => {
    expect(approximateManuscriptWordCount(undefined)).toBe(0);
  });

  it('returns 0 for empty manuscript array', () => {
    expect(
      approximateManuscriptWordCount({ manuscript: [] } as unknown as Parameters<
        typeof approximateManuscriptWordCount
      >[0]),
    ).toBe(0);
  });

  it('strips HTML tags before counting words', () => {
    const data = {
      manuscript: [{ content: '<p>Hello world</p>' }],
    } as Parameters<typeof approximateManuscriptWordCount>[0];
    expect(approximateManuscriptWordCount(data)).toBe(2);
  });

  it('accumulates words across multiple sections', () => {
    const data = {
      manuscript: [{ content: 'one two three' }, { content: 'four five' }],
    } as Parameters<typeof approximateManuscriptWordCount>[0];
    expect(approximateManuscriptWordCount(data)).toBe(5);
  });

  it('handles sections with no content (undefined/empty)', () => {
    const data = {
      manuscript: [{ content: undefined }, { content: '' }, { content: 'hello' }],
    } as Parameters<typeof approximateManuscriptWordCount>[0];
    expect(approximateManuscriptWordCount(data)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// effectiveTheme
// ---------------------------------------------------------------------------
describe('getEffectiveTheme', () => {
  it('returns "dark" for explicit dark theme', () => {
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('returns "light" for explicit light theme', () => {
    expect(getEffectiveTheme('light')).toBe('light');
  });

  it('returns "dark" for system theme when matchMedia prefers dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    expect(getEffectiveTheme('auto')).toBe('dark');
  });

  it('returns "light" for system theme when matchMedia does not prefer dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    expect(getEffectiveTheme('auto')).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// aiSuggestions
// ---------------------------------------------------------------------------
describe('getLocalAiSuggestions', () => {
  it('includes nav-manuscript suggestion on dashboard view', () => {
    const deps = makeDeps({ currentView: 'dashboard' });
    const ids = getLocalAiSuggestions(deps).map((s) => s.id);
    expect(ids).toContain('nav-manuscript');
  });

  it('includes nav-writer when wordCount < 400', () => {
    const deps = makeDeps({ wordCountApprox: 100, currentView: 'writer' });
    const ids = getLocalAiSuggestions(deps).map((s) => s.id);
    expect(ids).toContain('nav-writer');
  });

  it('includes ai-consistency when on manuscript view with > 5000 words', () => {
    const deps = makeDeps({ currentView: 'manuscript', wordCountApprox: 6000 });
    const ids = getLocalAiSuggestions(deps).map((s) => s.id);
    expect(ids).toContain('ai-consistency');
  });

  it('does not include ai-consistency on non-manuscript view', () => {
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 6000 });
    const ids = getLocalAiSuggestions(deps).map((s) => s.id);
    expect(ids).not.toContain('ai-consistency');
  });

  it('deduplicates suggestions with same id', () => {
    // dashboard + low word count may produce nav-manuscript + nav-writer
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 100 });
    const suggestions = getLocalAiSuggestions(deps);
    const ids = suggestions.map((s) => s.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('caps output at 3 suggestions', () => {
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 100 });
    expect(getLocalAiSuggestions(deps).length).toBeLessThanOrEqual(3);
  });

  it('returns empty array when no conditions match', () => {
    const deps = makeDeps({ currentView: 'writer', wordCountApprox: 1000 });
    expect(getLocalAiSuggestions(deps).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// commandDefinitions — shape checks
// ---------------------------------------------------------------------------
describe('getStaticCommandDefinitions', () => {
  it('returns an array of command definitions', () => {
    const defs = getStaticCommandDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it('includes expected navigation command ids', () => {
    const ids = getStaticCommandDefinitions().map((d) => d.id);
    expect(ids).toContain('nav-dashboard');
    expect(ids).toContain('nav-writer');
    expect(ids).toContain('nav-manuscript');
    expect(ids).toContain('nav-characters');
    expect(ids).toContain('nav-help');
  });

  it('all definitions have id, category, titleKey, and run function', () => {
    for (const def of getStaticCommandDefinitions()) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.category).toBe('string');
      expect(typeof def.titleKey).toBe('string');
      expect(typeof def.run).toBe('function');
    }
  });

  it('nav-dashboard run calls navigate with "dashboard"', () => {
    const deps = makeDeps();
    const def = getStaticCommandDefinitions().find((d) => d.id === 'nav-dashboard');
    def!.run(deps);
    expect(deps.navigate).toHaveBeenCalledWith('dashboard');
  });

  it('set-theme-dark is visible only when theme is not dark', () => {
    const defs = getStaticCommandDefinitions();
    const toggle = defs.find((d) => d.id === 'set-theme-dark');
    // QNBS-v3: old id was set-theme-toggle; renamed to set-theme-dark with explicit when guards
    expect(toggle!.when!(makeDeps({ theme: 'light' }))).toBe(true);
    expect(toggle!.when!(makeDeps({ theme: 'dark' }))).toBe(false);
  });

  // QNBS-v3: enableCrossProjectSearch promoted to permanent core — command is always available.
  it('labs-cross-project-search has no feature-flag when guard', () => {
    const defs = getStaticCommandDefinitions();
    const def = defs.find((d) => d.id === 'labs-cross-project-search');
    expect(def).toBeDefined();
    expect(def!.when).toBeUndefined();
  });
});

describe('buildLanguageCommands', () => {
  it('excludes the current language from results', () => {
    const defs = buildLanguageCommands(makeDeps({ language: 'en' }));
    const codes = defs.map((d) => d.id);
    expect(codes).not.toContain('set-lang-en');
  });

  it('returns 4 commands when current language is "en" (5 langs minus 1)', () => {
    const defs = buildLanguageCommands(makeDeps({ language: 'en' }));
    expect(defs.length).toBe(4);
  });

  it('all language commands have category "settings"', () => {
    for (const def of buildLanguageCommands(makeDeps({ language: 'de' }))) {
      expect(def.category).toBe('settings');
    }
  });

  it('run calls setLanguage with the correct code', () => {
    const deps = makeDeps({ language: 'en' });
    const defs = buildLanguageCommands(deps);
    const deDef = defs.find((d) => d.id === 'set-lang-de');
    deDef!.run(deps);
    expect(deps.setLanguage).toHaveBeenCalledWith('de');
  });
});

describe('buildEntityCommands', () => {
  it('creates one command per character', () => {
    const deps = makeDeps({
      characters: [
        { id: 'c1', name: 'Alice' },
        { id: 'c2', name: 'Bob' },
      ],
    });
    const defs = buildEntityCommands(deps);
    expect(defs.some((d) => d.id === 'char-c1')).toBe(true);
    expect(defs.some((d) => d.id === 'char-c2')).toBe(true);
  });

  it('creates one command per world', () => {
    const deps = makeDeps({
      worlds: [{ id: 'w1', name: 'Midgard' }],
    });
    const defs = buildEntityCommands(deps);
    expect(defs.some((d) => d.id === 'world-w1')).toBe(true);
  });

  it('returns empty array when no entities exist', () => {
    expect(buildEntityCommands(makeDeps())).toEqual([]);
  });

  it('character command run navigates to characters', () => {
    const deps = makeDeps({ characters: [{ id: 'c1', name: 'Alice' }] });
    const def = buildEntityCommands(deps).find((d) => d.id === 'char-c1');
    def!.run(deps);
    expect(deps.navigate).toHaveBeenCalledWith('characters');
  });

  it('world command run navigates to world', () => {
    const deps = makeDeps({ worlds: [{ id: 'w1', name: 'Midgard' }] });
    const def = buildEntityCommands(deps).find((d) => d.id === 'world-w1');
    def!.run(deps);
    expect(deps.navigate).toHaveBeenCalledWith('world');
  });
});

// ---------------------------------------------------------------------------
// commandBuilder
// ---------------------------------------------------------------------------
describe('collectAllDefinitions', () => {
  it('returns at least the static + language commands', () => {
    const deps = makeDeps({ language: 'en' });
    const all = collectAllDefinitions(deps);
    const staticDefs = getStaticCommandDefinitions();
    // Static commands should be in the collected set
    for (const def of staticDefs) {
      expect(all.some((d) => d.id === def.id)).toBe(true);
    }
  });

  it('includes language commands in the collection', () => {
    const deps = makeDeps({ language: 'en' });
    const all = collectAllDefinitions(deps);
    expect(all.some((d) => d.id === 'set-lang-de')).toBe(true);
  });

  it('includes entity commands when characters are present', () => {
    const deps = makeDeps({ characters: [{ id: 'c1', name: 'Hero' }] });
    const all = collectAllDefinitions(deps);
    expect(all.some((d) => d.id === 'char-c1')).toBe(true);
  });
});

describe('buildPaletteCommandModels', () => {
  it('excludes commands whose when() condition is false', () => {
    // set-theme-dark is hidden when already on dark theme
    const deps = makeDeps({ theme: 'dark' });
    const models = buildPaletteCommandModels(deps);
    expect(models.some((m) => m.id === 'set-theme-dark')).toBe(false);
  });

  it('includes commands whose when() condition is true', () => {
    // set-theme-dark is shown when on light theme
    const deps = makeDeps({ theme: 'light' });
    const models = buildPaletteCommandModels(deps);
    expect(models.some((m) => m.id === 'set-theme-dark')).toBe(true);
  });

  it('includes commands without a when() guard', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    expect(models.some((m) => m.id === 'nav-dashboard')).toBe(true);
  });

  it('sets shortcutDisplay when def has shortcutHint', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    const aiOutline = models.find((m) => m.id === 'ai-outline');
    expect(aiOutline?.shortcutDisplay).toBeDefined();
    expect(Array.isArray(aiOutline?.shortcutDisplay)).toBe(true);
  });

  it('does not set shortcutDisplay when def has no shortcutHint', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    const navDashboard = models.find((m) => m.id === 'nav-dashboard');
    expect(navDashboard?.shortcutDisplay).toBeUndefined();
  });

  it('run() closure calls the underlying def.run with deps', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    const navDashboard = models.find((m) => m.id === 'nav-dashboard');
    navDashboard!.run();
    expect(deps.navigate).toHaveBeenCalledWith('dashboard');
  });

  it('model has required fields: id, title, categoryLabel, category, keywords', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    for (const model of models) {
      expect(typeof model.id).toBe('string');
      expect(typeof model.title).toBe('string');
      expect(typeof model.categoryLabel).toBe('string');
      expect(typeof model.category).toBe('string');
      expect(Array.isArray(model.keywords)).toBe(true);
    }
  });
});

describe('runCommandById', () => {
  it('returns false for unknown command id', () => {
    expect(runCommandById('does-not-exist', makeDeps())).toBe(false);
  });

  it('returns false when command when() condition is false', () => {
    // set-theme-dark is only visible when NOT on dark theme
    const deps = makeDeps({ theme: 'dark' });
    expect(runCommandById('set-theme-dark', deps)).toBe(false);
  });

  it('returns true and executes command for valid id', () => {
    const deps = makeDeps();
    const result = runCommandById('nav-dashboard', deps);
    expect(result).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('dashboard');
  });

  it('executes language command and calls setLanguage', () => {
    const deps = makeDeps({ language: 'en' });
    const result = runCommandById('set-lang-de', deps);
    expect(result).toBe(true);
    expect(deps.setLanguage).toHaveBeenCalledWith('de');
  });

  it('executes entity command for existing character', () => {
    const deps = makeDeps({ characters: [{ id: 'c1', name: 'Alice' }] });
    const result = runCommandById('char-c1', deps);
    expect(result).toBe(true);
    expect(deps.navigate).toHaveBeenCalledWith('characters');
  });
});
