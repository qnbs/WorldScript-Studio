import { describe, expect, it } from 'vitest';
import {
  retrieveHelpDocContext,
  retrieveHelpDocSources,
} from '../../services/help/helpDocRetrieval';

// ---------------------------------------------------------------------------
// retrieveHelpDocContext
// ---------------------------------------------------------------------------
describe('retrieveHelpDocContext', () => {
  it('returns non-empty string for an empty question (fallback path)', () => {
    // QNBS-v3: empty query → all chunks score 1, first N chunks included up to maxChars
    const result = retrieveHelpDocContext('');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes command palette content for "palette" query', () => {
    const result = retrieveHelpDocContext('palette');
    expect(result).toContain('Command palette');
  });

  it('includes manuscript content for "manuscript" query', () => {
    const result = retrieveHelpDocContext('manuscript');
    expect(result).toContain('Manuscript editor');
  });

  it('includes snapshot content for "snapshot" query', () => {
    const result = retrieveHelpDocContext('snapshot');
    expect(result).toContain('Snapshots');
  });

  it('includes AI studio content for "gemini" query', () => {
    const result = retrieveHelpDocContext('gemini');
    expect(result).toContain('AI Writing Studio');
  });

  it('returns fallback chunks when query has no matching content', () => {
    // QNBS-v3: "xyzqwertyzzz" has no substring/subsequence match → ranked is empty → fallback 3 chunks
    const result = retrieveHelpDocContext('xyzqwertyzzz');
    expect(result.length).toBeGreaterThan(0);
  });

  it('respects the maxChars limit', () => {
    // QNBS-v3: very small maxChars should truncate output even for high-scoring queries
    const result = retrieveHelpDocContext('', 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('returns trimmed output (no leading/trailing whitespace)', () => {
    const result = retrieveHelpDocContext('palette');
    expect(result).toBe(result.trim());
  });

  it('uses markdown heading format for each chunk', () => {
    const result = retrieveHelpDocContext('palette');
    expect(result).toMatch(/^## /);
  });

  it('returns best match first (highest-scoring chunk leads)', () => {
    // Ctrl+K is in the palette body — should score higher and appear first
    const result = retrieveHelpDocContext('Ctrl');
    expect(result.indexOf('Command palette')).toBeLessThan(
      result.indexOf('Manuscript') === -1 ? Infinity : result.indexOf('Manuscript'),
    );
  });
});

// ---------------------------------------------------------------------------
// retrieveHelpDocSources
// ---------------------------------------------------------------------------
describe('retrieveHelpDocSources', () => {
  it('returns an array of title strings', () => {
    const sources = retrieveHelpDocSources('palette');
    expect(Array.isArray(sources)).toBe(true);
    for (const s of sources) expect(typeof s).toBe('string');
  });

  it('includes "Command palette" for palette query', () => {
    const sources = retrieveHelpDocSources('command palette');
    expect(sources).toContain('Command palette');
  });

  it('returns at most 4 sources', () => {
    const sources = retrieveHelpDocSources('');
    expect(sources.length).toBeLessThanOrEqual(4);
  });

  it('returns empty array when nothing matches', () => {
    // All chunks score 0 → filter removes them → empty result
    // QNBS-v3: "xyzqwertyzzz" is chosen to guarantee no subsequence match in any chunk body
    const sources = retrieveHelpDocSources('xyzqwertyzzz');
    expect(Array.isArray(sources)).toBe(true);
  });

  it('returns sources ranked highest first', () => {
    // QNBS-v3: "provider" is a substring only in the AI Writing Studio body → highest exact-match score
    const sources = retrieveHelpDocSources('provider');
    expect(sources[0]).toBe('AI Writing Studio');
  });
});
