/**
 * Tests for services/commands/commandBuilder.ts
 * QNBS-v3: Tests runCommandById (found/not-found/when-gated) and buildPaletteCommandModels filtering.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CommandRuntimeDeps } from '../../../services/commands/commandTypes';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockNavigate = vi.fn();
const mockSetLanguage = vi.fn();
const mockRun = vi.fn();

vi.mock('../../../services/commands/commandDefinitions', () => ({
  getStaticCommandDefinitions: vi.fn(() => [
    {
      id: 'nav-dashboard',
      category: 'navigation',
      titleKey: 'palette.nav.dashboard',
      keywords: ['dashboard', 'home'],
      icon: null,
      run: (deps: CommandRuntimeDeps) => deps.navigate('dashboard'),
    },
    {
      id: 'ai-generate',
      category: 'aiActions',
      titleKey: 'palette.ai.generate',
      keywords: [],
      icon: null,
      when: (deps: CommandRuntimeDeps) => deps.featureFlags.enableProForge,
      run: mockRun,
    },
    {
      id: 'inline-cmd',
      category: 'global',
      titleKey: 'palette.global.inline',
      inlineTitle: 'Inline Title',
      icon: null,
      shortcutHint: ['Ctrl', 'K'],
      run: vi.fn(),
    },
  ]),
  buildLanguageCommands: vi.fn(() => []),
  buildEntityCommands: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  buildPaletteCommandModels,
  collectAllDefinitions,
  runCommandById,
} from '../../../services/commands/commandBuilder';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<CommandRuntimeDeps> = {}): CommandRuntimeDeps {
  return {
    dispatch: mockDispatch,
    navigate: mockNavigate,
    setLanguage: mockSetLanguage,
    t: <T = string>(k: string) => k as unknown as T,
    theme: 'dark',
    language: 'en',
    characters: [],
    worlds: [],
    currentView: 'dashboard',
    wordCountApprox: 0,
    featureFlags: {
      enableDuckDbAnalytics: false,
      enableVoiceSupport: false,
      enableProForge: false,
      enableCharacterInterviews: false,
      enableLoraAdapters: false,
      enablePluginSystem: false,
      enableAppHealthPanel: false,
      enableStoryBibleAdvanced: false,
      enableBinderResearch: false,
      enableCompileWizard: false,
      enableProjectHealthScore: false,
      enableObjectsGroups: false,
      enableMindMaps: false,
      enableRtlLayout: false,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCommandById', () => {
  it('calls run and returns true for a known command', () => {
    const deps = makeDeps();
    const result = runCommandById('nav-dashboard', deps);
    expect(result).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('dashboard');
  });

  it('returns false for unknown command id', () => {
    const deps = makeDeps();
    expect(runCommandById('non-existent-command', deps)).toBe(false);
  });

  it('returns false when when() guard is false', () => {
    const deps = makeDeps(); // enableProForge: false
    const result = runCommandById('ai-generate', deps);
    expect(result).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('returns true when when() guard is true', () => {
    const deps = makeDeps({ featureFlags: { ...makeDeps().featureFlags, enableProForge: true } });
    const result = runCommandById('ai-generate', deps);
    expect(result).toBe(true);
    expect(mockRun).toHaveBeenCalled();
  });
});

describe('collectAllDefinitions', () => {
  it('returns at least the static definitions', () => {
    const deps = makeDeps();
    const defs = collectAllDefinitions(deps);
    expect(defs.length).toBeGreaterThanOrEqual(3);
    expect(defs.some((d) => d.id === 'nav-dashboard')).toBe(true);
  });
});

describe('buildPaletteCommandModels', () => {
  it('excludes commands where when() is false', () => {
    const deps = makeDeps(); // enableProForge: false
    const models = buildPaletteCommandModels(deps);
    expect(models.some((m) => m.id === 'ai-generate')).toBe(false);
  });

  it('includes commands where when() is true', () => {
    const deps = makeDeps({ featureFlags: { ...makeDeps().featureFlags, enableProForge: true } });
    const models = buildPaletteCommandModels(deps);
    expect(models.some((m) => m.id === 'ai-generate')).toBe(true);
  });

  it('uses inlineTitle when present', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    const inlineCmd = models.find((m) => m.id === 'inline-cmd');
    expect(inlineCmd?.title).toBe('Inline Title');
  });

  it('sets shortcutDisplay from shortcutHint', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    const inlineCmd = models.find((m) => m.id === 'inline-cmd');
    expect(inlineCmd?.shortcutDisplay).toEqual(['Ctrl', 'K']);
  });

  it('each model has a run function', () => {
    const deps = makeDeps();
    const models = buildPaletteCommandModels(deps);
    for (const model of models) {
      expect(typeof model.run).toBe('function');
    }
  });
});
