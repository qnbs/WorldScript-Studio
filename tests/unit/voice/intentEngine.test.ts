import { describe, expect, it } from 'vitest';
import { STATIC_VOICE_COMMANDS } from '../../../services/voice/commandVoiceMappings';
import { HybridIntentEngine } from '../../../services/voice/intentEngine';
import type { IntentContext } from '../../../services/voice/voiceTypes';

const baseContext: IntentContext = {
  currentView: 'dashboard',
  selectedIds: [],
  characterNames: ['Alice', 'Bob'],
  sectionTitles: ['Chapter 1', 'The Forest'],
  worldNames: ['Narnia'],
  lastCommandId: null,
};

describe('HybridIntentEngine', () => {
  const engine = new HybridIntentEngine();
  engine.initialize();
  engine.registerCommands(STATIC_VOICE_COMMANDS);

  it('matches exact templates', () => {
    const result = engine.parse('open dashboard', baseContext);
    expect(result).not.toBeNull();
    expect(result?.commandId).toBe('global-dashboard');
    expect(result?.confidence).toBe(1);
  });

  it('matches fuzzy keywords', () => {
    const result = engine.parse('dashboard', baseContext);
    expect(result).not.toBeNull();
    expect(result?.commandId).toBe('global-dashboard');
    expect(result!.confidence).toBeGreaterThan(0.6);
  });

  it('extracts navigation slots', () => {
    const result = engine.parse('open manuscript', baseContext);
    expect(result).not.toBeNull();
    expect(result?.commandId).toBe('editor-manuscript');
  });

  it('filters by required view context', () => {
    const result = engine.parse('start dictation', { ...baseContext, currentView: 'dashboard' });
    // dictation requires manuscript or writer view
    expect(result?.commandId).not.toBe('voice-start-dictation');
  });

  it('allows dictation in manuscript view', () => {
    const result = engine.parse('start dictation', { ...baseContext, currentView: 'manuscript' });
    expect(result?.commandId).toBe('voice-start-dictation');
  });

  it('returns null for unknown commands', () => {
    const result = engine.parse('do the impossible thing now', baseContext);
    expect(result).toBeNull();
  });

  it('matches AI commands', () => {
    const result = engine.parse('check consistency', baseContext);
    expect(result?.commandId).toBe('ai-consistency');
  });
});
