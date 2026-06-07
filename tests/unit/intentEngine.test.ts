import { beforeEach, describe, expect, it } from 'vitest';
import { HybridIntentEngine } from '../../services/voice/intentEngine';
import type { IntentContext } from '../../services/voice/voiceTypes';

function makeContext(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    currentView: 'dashboard',
    selectedIds: [],
    characterNames: [],
    sectionTitles: [],
    worldNames: [],
    lastCommandId: null,
    ...overrides,
  };
}

describe('HybridIntentEngine', () => {
  let engine: HybridIntentEngine;

  beforeEach(async () => {
    engine = new HybridIntentEngine();
    await engine.initialize();
  });

  // ── Exact template matching ──────────────────────────────────────────────

  it('matches exact template', () => {
    const result = engine.parse('open dashboard', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('global-dashboard');
    expect(result!.confidence).toBe(1);
  });

  it('matches exact template case-insensitively', () => {
    const result = engine.parse('OPEN DASHBOARD', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('global-dashboard');
  });

  it('trims whitespace for exact match', () => {
    const result = engine.parse('  open dashboard  ', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('global-dashboard');
  });

  // ── View context filtering ───────────────────────────────────────────────

  it('filters exact match by required view', () => {
    // Register a command that requires 'writer' view
    engine.registerCommands([
      {
        id: 'writer-only-cmd',
        templates: ['save draft'],
        keywords: ['save'],
        supportsDictation: false,
        requiredViews: ['writer'],
      },
    ]);
    // Should NOT match when currentView is 'dashboard'
    const result = engine.parse('save draft', makeContext({ currentView: 'dashboard' }));
    expect(result).toBeNull();
    // SHOULD match when currentView is 'writer'
    const result2 = engine.parse('save draft', makeContext({ currentView: 'writer' }));
    expect(result2).not.toBeNull();
    expect(result2!.commandId).toBe('writer-only-cmd');
  });

  // ── Fuzzy matching ───────────────────────────────────────────────────────

  it('matches fuzzy with keyword overlap', () => {
    const result = engine.parse('show me the dashboard overview', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('global-dashboard');
    expect(result!.confidence).toBeGreaterThan(0.6);
  });

  it('returns null when no match exceeds threshold', () => {
    const result = engine.parse('xyz abc def ghi jkl', makeContext());
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = engine.parse('', makeContext());
    expect(result).toBeNull();
  });

  // ── Navigation slot extraction ───────────────────────────────────────────

  it('extracts "open {view}" navigation slot for non-exact view', () => {
    // "preview" has no exact template, so navigation slot extraction kicks in
    const result = engine.parse('open preview', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('editor-preview');
    expect(result!.slots).toEqual([{ name: 'view', value: 'preview' }]);
    expect(result!.confidence).toBe(0.75);
  });

  it('extracts "go to {view}" navigation slot', () => {
    const result = engine.parse('go to templates', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('editor-templates');
  });

  it('extracts "show {view}" navigation slot', () => {
    const result = engine.parse('show mind map', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('editor-mindmap');
  });

  it('handles unknown view in navigation slot', () => {
    const result = engine.parse('open unknownviewxyz', makeContext());
    // Should fall through to fuzzy or return null
    expect(result === null || result!.confidence < 0.75).toBe(true);
  });

  // ── Command registration ─────────────────────────────────────────────────

  it('replaces commands on registerCommands', () => {
    engine.registerCommands([
      {
        id: 'custom-cmd',
        templates: ['do the thing'],
        keywords: ['thing'],
        supportsDictation: false,
        requiredViews: [],
      },
    ]);
    const result = engine.parse('do the thing', makeContext());
    expect(result).not.toBeNull();
    expect(result!.commandId).toBe('custom-cmd');
    // Old exact-match commands should be gone (use 'undo' which has no nav-slot fallback)
    const oldResult = engine.parse('undo', makeContext());
    expect(oldResult).toBeNull();
  });

  it('supports multiple templates per command', () => {
    engine.registerCommands([
      {
        id: 'multi-template',
        templates: ['hello', 'hi there', 'greetings'],
        keywords: ['hello'],
        supportsDictation: false,
        requiredViews: [],
      },
    ]);
    expect(engine.parse('hello', makeContext())!.commandId).toBe('multi-template');
    expect(engine.parse('hi there', makeContext())!.commandId).toBe('multi-template');
    expect(engine.parse('greetings', makeContext())!.commandId).toBe('multi-template');
  });

  // ── Confidence scoring ───────────────────────────────────────────────────

  it('returns confidence 1.0 for exact match', () => {
    const result = engine.parse('dashboard', makeContext());
    expect(result!.confidence).toBe(1);
  });

  it('returns confidence below 1.0 for fuzzy match', () => {
    const result = engine.parse('dashboard overview', makeContext());
    if (result) {
      expect(result.confidence).toBeLessThan(1);
      expect(result.confidence).toBeGreaterThan(0.6);
    }
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  it('preserves original transcript in result', () => {
    const transcript = 'Open Dashboard';
    const result = engine.parse(transcript, makeContext());
    expect(result!.transcript).toBe(transcript);
  });

  it('handles transcript with punctuation', () => {
    const result = engine.parse('open dashboard, please!', makeContext());
    // Exact match fails due to punctuation, fuzzy may match
    expect(result === null || result.commandId === 'global-dashboard').toBe(true);
  });
});
