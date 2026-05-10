import { sanitizeForPrompt } from '@domain/ai-core';
import { describe, expect, it } from 'vitest';

describe('@domain/ai-core sanitizeForPrompt', () => {
  it('redacts email-like tokens', () => {
    expect(sanitizeForPrompt('Contact me at user@example.com please')).toContain(
      '[REDACTED_EMAIL]',
    );
  });

  it('truncates very long input', () => {
    const long = `${'word '.repeat(5000)}`;
    const out = sanitizeForPrompt(long);
    expect(out.length).toBeLessThanOrEqual(13000);
    expect(out).toContain('truncated');
  });

  it('returns heuristic marker for empty sanitized string', async () => {
    const { runLocalTextGeneration } = await import('@domain/ai-core');
    const r = await runLocalTextGeneration('   \n\t  ');
    expect(r.layer).toBe('heuristic');
  });
});
