import { describe, expect, it } from 'vitest';
import { getLocalAiSuggestions } from '../../services/commands/aiSuggestions';
import type { CommandRuntimeDeps, I18nTranslate } from '../../services/commands/commandTypes';

function makeDeps(overrides: Partial<CommandRuntimeDeps> = {}): CommandRuntimeDeps {
  return {
    currentView: 'dashboard',
    wordCountApprox: 0,
    dispatch: (() => undefined) as never,
    t: ((k: string) => k) as I18nTranslate,
    language: 'en',
    setLanguage: () => undefined,
    featureFlags: {} as never,
    characters: [],
    worlds: [],
    navigate: () => undefined,
    theme: 'dark' as const,
    ...overrides,
  };
}

describe('getLocalAiSuggestions', () => {
  it('returns nav-manuscript suggestion when on dashboard', () => {
    const result = getLocalAiSuggestions(makeDeps({ currentView: 'dashboard' }));
    expect(result.some((s) => s.id === 'nav-manuscript')).toBe(true);
  });

  it('returns nav-writer suggestion when word count is below 400', () => {
    const result = getLocalAiSuggestions(makeDeps({ wordCountApprox: 100 }));
    expect(result.some((s) => s.id === 'nav-writer')).toBe(true);
  });

  it('returns ai-consistency suggestion on manuscript view with >5000 words', () => {
    const result = getLocalAiSuggestions(
      makeDeps({ currentView: 'manuscript', wordCountApprox: 6000 }),
    );
    expect(result.some((s) => s.id === 'ai-consistency')).toBe(true);
  });

  it('does not return nav-writer when word count >= 400', () => {
    const result = getLocalAiSuggestions(makeDeps({ wordCountApprox: 500 }));
    expect(result.some((s) => s.id === 'nav-writer')).toBe(false);
  });

  it('limits results to max 3 suggestions', () => {
    // Dashboard + low word count + high word count all at once (edge case)
    const result = getLocalAiSuggestions(
      makeDeps({ currentView: 'dashboard', wordCountApprox: 100 }),
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates suggestions with same id', () => {
    const result = getLocalAiSuggestions(makeDeps({ currentView: 'dashboard' }));
    const ids = result.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns empty array when no conditions match', () => {
    const result = getLocalAiSuggestions(
      makeDeps({ currentView: 'manuscript', wordCountApprox: 1000 }),
    );
    expect(result.length).toBe(0);
  });
});
