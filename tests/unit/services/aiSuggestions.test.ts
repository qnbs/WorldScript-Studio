/**
 * Tests for services/commands/aiSuggestions.ts
 * QNBS-v3: Pure deterministic suggestions — no network, no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import { getLocalAiSuggestions } from '../../../services/commands/aiSuggestions';
import type { CommandRuntimeDeps } from '../../../services/commands/commandTypes';

function makeDeps(overrides: Partial<CommandRuntimeDeps> = {}): CommandRuntimeDeps {
  return {
    dispatch: () => {},
    navigate: () => {},
    setLanguage: () => {},
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
      enableTimeline: false,
      enableWizard: false,
      enableReadMode: false,
      enableMindMap: false,
      enableObjects: false,
      enableLoraAdapters: false,
      enablePluginSystem: false,
      enableAppHealthPanel: false,
    },
    ...overrides,
  } as CommandRuntimeDeps;
}

describe('getLocalAiSuggestions', () => {
  it('suggests nav-manuscript when on dashboard', () => {
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 1000 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'nav-manuscript')).toBe(true);
  });

  it('suggests nav-writer when wordCount < 400', () => {
    const deps = makeDeps({ currentView: 'settings', wordCountApprox: 100 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'nav-writer')).toBe(true);
  });

  it('suggests nav-writer at exactly 0 words', () => {
    const deps = makeDeps({ wordCountApprox: 0, currentView: 'writer' });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'nav-writer')).toBe(true);
  });

  it('does not suggest nav-writer when wordCount >= 400', () => {
    const deps = makeDeps({ currentView: 'writer', wordCountApprox: 500 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'nav-writer')).toBe(false);
  });

  it('suggests ai-consistency when on manuscript with > 5000 words', () => {
    const deps = makeDeps({ currentView: 'manuscript', wordCountApprox: 6000 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'ai-consistency')).toBe(true);
  });

  it('does not suggest ai-consistency when not on manuscript view', () => {
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 6000 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.some((s) => s.id === 'ai-consistency')).toBe(false);
  });

  it('returns at most 3 suggestions', () => {
    // dashboard + low word count + manuscript words > 5000 can overlap
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 0 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates suggestions by id', () => {
    const deps = makeDeps({ currentView: 'dashboard', wordCountApprox: 100 });
    const suggestions = getLocalAiSuggestions(deps);
    const ids = suggestions.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('returns empty when no conditions match', () => {
    const deps = makeDeps({ currentView: 'settings', wordCountApprox: 1000 });
    const suggestions = getLocalAiSuggestions(deps);
    expect(suggestions).toHaveLength(0);
  });
});
