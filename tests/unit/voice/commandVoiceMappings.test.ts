import { describe, expect, it } from 'vitest';
import {
  buildVoiceCommandMap,
  STATIC_VOICE_COMMANDS,
} from '../../../services/voice/commandVoiceMappings';

describe('STATIC_VOICE_COMMANDS', () => {
  it('contains navigation commands', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('global-dashboard');
    expect(ids).toContain('editor-manuscript');
    expect(ids).toContain('nav-settings');
    expect(ids).toContain('help-open');
  });

  it('contains editor action commands', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('act-save');
    expect(ids).toContain('act-undo');
    expect(ids).toContain('act-redo');
  });

  it('contains AI commands', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('ai-consistency');
    expect(ids).toContain('ai-outline');
    expect(ids).toContain('ai-critic');
  });

  it('contains voice-specific commands', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('voice-start-dictation');
    expect(ids).toContain('voice-stop-dictation');
    expect(ids).toContain('voice-toggle-listening');
  });

  it('contains settings shortcuts', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    expect(ids).toContain('toggle-theme');
    expect(ids).toContain('toggle-zen-mode');
  });

  it('has unique command ids', () => {
    const ids = STATIC_VOICE_COMMANDS.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('dictation commands require specific views', () => {
    const dictationCmd = STATIC_VOICE_COMMANDS.find((c) => c.id === 'voice-start-dictation');
    expect(dictationCmd).toBeDefined();
    expect(dictationCmd!.supportsDictation).toBe(true);
    expect(dictationCmd!.requiredViews).toContain('manuscript');
    expect(dictationCmd!.requiredViews).toContain('writer');
  });

  it('all commands have templates and keywords', () => {
    for (const cmd of STATIC_VOICE_COMMANDS) {
      expect(cmd.templates.length).toBeGreaterThan(0);
      expect(cmd.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('buildVoiceCommandMap', () => {
  it('maps templates to command ids', () => {
    const map = buildVoiceCommandMap(STATIC_VOICE_COMMANDS);
    expect(map.get('open dashboard')).toBe('global-dashboard');
    expect(map.get('save')).toBe('act-save');
    expect(map.get('undo')).toBe('act-undo');
  });

  it('handles case insensitivity by storing lowercase', () => {
    const map = buildVoiceCommandMap(STATIC_VOICE_COMMANDS);
    // Templates are already lowercase in the data, but verify the contract
    const keys = Array.from(map.keys());
    for (const key of keys) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('returns empty map for empty commands', () => {
    const map = buildVoiceCommandMap([]);
    expect(map.size).toBe(0);
  });

  it('handles duplicate templates by last-one-wins', () => {
    const commands = [
      {
        id: 'cmd-a',
        templates: ['same'],
        keywords: [],
        supportsDictation: false,
        requiredViews: [],
      },
      {
        id: 'cmd-b',
        templates: ['same'],
        keywords: [],
        supportsDictation: false,
        requiredViews: [],
      },
    ];
    const map = buildVoiceCommandMap(commands);
    expect(map.get('same')).toBe('cmd-b');
  });
});
