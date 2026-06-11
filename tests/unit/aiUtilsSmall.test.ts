/**
 * Tests for small pure-logic AI/command utils:
 * - services/commands/wordCountApprox.ts
 * - services/ai/creativityTemperature.ts
 * - services/ai/localBackendPresets.ts
 * - services/commands/effectiveTheme.ts
 * QNBS-v3: All pure functions / constant maps — no mocks needed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREATIVITY_TO_TEMPERATURE } from '../../services/ai/creativityTemperature';
import { LOCAL_BACKEND_PRESET_DEFAULT_URL } from '../../services/ai/localBackendPresets';
import { getEffectiveTheme } from '../../services/commands/effectiveTheme';
import { approximateManuscriptWordCount } from '../../services/commands/wordCountApprox';

// QNBS-v3: exact param type of the SUT — avoids `as any` while still passing partial fixtures.
type WordCountArg = Parameters<typeof approximateManuscriptWordCount>[0];

// ---------------------------------------------------------------------------
// approximateManuscriptWordCount
// ---------------------------------------------------------------------------

describe('approximateManuscriptWordCount', () => {
  it('returns 0 for undefined input', () => {
    expect(approximateManuscriptWordCount(undefined)).toBe(0);
  });

  it('returns 0 for empty manuscript array', () => {
    expect(approximateManuscriptWordCount({ manuscript: [] } as unknown as WordCountArg)).toBe(0);
  });

  it('counts words across sections', () => {
    const data = {
      manuscript: [{ content: 'Hello world' }, { content: 'Three more words here' }],
    };
    expect(approximateManuscriptWordCount(data as unknown as WordCountArg)).toBe(6);
  });

  it('strips HTML tags before counting', () => {
    const data = {
      manuscript: [{ content: '<p>Hello <b>world</b></p>' }],
    };
    expect(approximateManuscriptWordCount(data as unknown as WordCountArg)).toBe(2);
  });

  it('handles sections with null/undefined content', () => {
    const data = {
      manuscript: [{ content: null }, { content: undefined }, { content: 'one' }],
    };
    expect(approximateManuscriptWordCount(data as unknown as WordCountArg)).toBe(1);
  });

  it('handles multiple whitespace sequences', () => {
    const data = { manuscript: [{ content: '  word1   word2  ' }] };
    expect(approximateManuscriptWordCount(data as unknown as WordCountArg)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CREATIVITY_TO_TEMPERATURE
// ---------------------------------------------------------------------------

describe('CREATIVITY_TO_TEMPERATURE', () => {
  it('maps Focused to 0.2', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Focused).toBe(0.2);
  });

  it('maps Balanced to 0.7', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Balanced).toBe(0.7);
  });

  it('maps Imaginative to 1.0', () => {
    expect(CREATIVITY_TO_TEMPERATURE.Imaginative).toBe(1.0);
  });

  it('has exactly 3 entries', () => {
    expect(Object.keys(CREATIVITY_TO_TEMPERATURE)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// LOCAL_BACKEND_PRESET_DEFAULT_URL
// ---------------------------------------------------------------------------

describe('LOCAL_BACKEND_PRESET_DEFAULT_URL', () => {
  it('maps ollama_default to port 11434', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.ollama_default).toContain('11434');
  });

  it('maps lm_studio to port 1234', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.lm_studio).toContain('1234');
  });

  it('maps vllm to port 8000', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.vllm).toContain('8000');
  });

  it('has a custom entry', () => {
    expect(LOCAL_BACKEND_PRESET_DEFAULT_URL.custom).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getEffectiveTheme
// ---------------------------------------------------------------------------

describe('getEffectiveTheme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "dark" for theme="dark"', () => {
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('returns "light" for theme="light"', () => {
    expect(getEffectiveTheme('light')).toBe('light');
  });

  it('uses matchMedia for system theme when theme is not light/dark', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    });
    expect(getEffectiveTheme('auto')).toBe('light');
  });

  it('returns "dark" via matchMedia when prefers-color-scheme is dark', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    expect(getEffectiveTheme('auto')).toBe('dark');
  });

  it('falls back to "dark" when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(getEffectiveTheme('system' as 'dark')).toBe('dark');
  });
});
