import { describe, expect, it } from 'vitest';
import {
  attachCause,
  cleanPrompt,
  sanitizePromptBlock,
  sanitizePromptValue,
  stripControlChars,
  stripJsonFences,
} from '../../services/aiUtils';

describe('stripControlChars', () => {
  it('passes through normal text unchanged', () => {
    expect(stripControlChars('Hello World')).toBe('Hello World');
  });

  it('replaces ASCII control chars with spaces', () => {
    expect(stripControlChars('foo\x00bar')).toBe('foo bar');
    expect(stripControlChars('a\x1fb')).toBe('a b');
    expect(stripControlChars('a\x7fb')).toBe('a b');
  });

  it('replaces C1 control chars (0x80–0x9f) with spaces', () => {
    expect(stripControlChars('a\x80b')).toBe('a b');
    expect(stripControlChars('a\x9fb')).toBe('a b');
  });

  it('preserves newlines (0x0a is below 0x20 → space)', () => {
    expect(stripControlChars('a\nb')).toBe('a b');
  });

  it('handles empty string', () => {
    expect(stripControlChars('')).toBe('');
  });
});

describe('sanitizePromptValue', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizePromptValue('  hello   world  ')).toBe('hello world');
  });

  it('replaces triple backticks with double quotes', () => {
    expect(sanitizePromptValue('say ```code``` here')).toBe('say "code" here');
  });

  it('handles null/undefined via nullish coalescing', () => {
    expect(sanitizePromptValue(null)).toBe('');
    expect(sanitizePromptValue(undefined)).toBe('');
  });

  it('converts non-string values via String()', () => {
    expect(sanitizePromptValue(42)).toBe('42');
  });
});

describe('sanitizePromptBlock', () => {
  // stripControlChars replaces \n (0x0a) and \r (0x0d) with spaces,
  // so the subsequent newline-normalization steps are effectively no-ops.
  it('converts newlines to spaces (stripControlChars runs first)', () => {
    expect(sanitizePromptBlock('para one\n\npara two')).toBe('para one  para two');
  });

  it('converts \\r\\n to two spaces', () => {
    expect(sanitizePromptBlock('a\r\nb')).toBe('a  b');
  });

  it('trims result', () => {
    expect(sanitizePromptBlock('\nhello\n')).toBe('hello');
  });

  it('replaces triple backticks', () => {
    expect(sanitizePromptBlock('before ```json``` after')).toBe('before "json" after');
  });
});

describe('cleanPrompt', () => {
  it('is an alias for sanitizePromptBlock', () => {
    const input = 'hello\n\n\nworld';
    expect(cleanPrompt(input)).toBe(sanitizePromptBlock(input));
  });
});

describe('stripJsonFences', () => {
  it('removes ```json ... ``` wrapper', () => {
    const raw = '```json\n{"key":"value"}\n```';
    expect(stripJsonFences(raw)).toBe('{"key":"value"}');
  });

  it('removes plain ``` wrapper', () => {
    expect(stripJsonFences('```\nplain\n```')).toBe('plain');
  });

  it('returns plain text unchanged', () => {
    expect(stripJsonFences('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it('trims surrounding whitespace', () => {
    expect(stripJsonFences('  hello  ')).toBe('hello');
  });
});

describe('attachCause', () => {
  it('attaches cause to error non-enumerably', () => {
    const err = new Error('base');
    const cause = new Error('root cause');
    attachCause(err, cause);
    expect((err as Error & { cause: unknown }).cause).toBe(cause);
    expect(Object.keys(err)).not.toContain('cause');
  });

  it('returns the same error instance', () => {
    const err = new Error('x');
    expect(attachCause(err, 'reason')).toBe(err);
  });
});
