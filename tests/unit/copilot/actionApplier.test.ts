// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyTextEdit, extractCodeBlock } from '../../../services/copilot/actionApplier';

describe('applyTextEdit', () => {
  it('whole-section replacement when original is empty', () => {
    const result = applyTextEdit('old content', '', 'brand new content');
    expect(result.content).toBe('brand new content');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('partial replacement when original is provided and found', () => {
    const result = applyTextEdit('The fox jumped.', 'fox', 'cat');
    expect(result.content).toBe('The cat jumped.');
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips when original text is not found in content', () => {
    const result = applyTextEdit('Hello world.', 'missing phrase', 'replacement');
    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(0);
    // content unchanged
    expect(result.content).toBe('Hello world.');
  });

  it('handles whitespace-only original as whole-section replacement', () => {
    const result = applyTextEdit('original', '   ', 'new text');
    expect(result.content).toBe('new text');
    expect(result.applied).toBe(1);
  });
});

describe('extractCodeBlock', () => {
  it('extracts content of first fenced code block', () => {
    const text = 'Here is a rewrite:\n```\nThe hero stood tall.\n```\nEnd.';
    expect(extractCodeBlock(text)).toBe('The hero stood tall.');
  });

  it('handles language tag after opening fence', () => {
    const text = '```markdown\nSome content\n```';
    expect(extractCodeBlock(text)).toBe('Some content');
  });

  it('returns null when no code block present', () => {
    expect(extractCodeBlock('No code block here.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractCodeBlock('')).toBeNull();
  });

  it('trims whitespace from extracted content', () => {
    const text = '```\n  spaced  \n```';
    expect(extractCodeBlock(text)).toBe('spaced');
  });
});
