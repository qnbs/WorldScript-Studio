import { describe, expect, it } from 'vitest';
import {
  highlightSubsequence,
  normalizeSearch,
  scoreAgainstQuery,
} from '../../../services/commands/fuzzyScore';

describe('normalizeSearch', () => {
  it('lowercases input', () => {
    expect(normalizeSearch('Hello World')).toBe('hello world');
  });

  it('strips leading and trailing whitespace', () => {
    expect(normalizeSearch('  abc  ')).toBe('abc');
  });

  it('converts accented characters to ASCII equivalents', () => {
    expect(normalizeSearch('café')).toBe('cafe');
    expect(normalizeSearch('über')).toBe('uber');
    expect(normalizeSearch('naïve')).toBe('naive');
    expect(normalizeSearch('résumé')).toBe('resume');
  });

  it('handles empty string', () => {
    expect(normalizeSearch('')).toBe('');
  });

  it('leaves plain ASCII unchanged (after lowercase)', () => {
    expect(normalizeSearch('dashboard')).toBe('dashboard');
  });

  it('handles mixed case + accents + spaces', () => {
    expect(normalizeSearch('  Ëlite  ')).toBe('elite');
  });
});

describe('scoreAgainstQuery', () => {
  it('returns 1 for empty query (pass-all)', () => {
    expect(scoreAgainstQuery('', 'anything')).toBe(1);
    expect(scoreAgainstQuery('', '')).toBe(1);
  });

  it('returns 0 when no haystack matches the query', () => {
    expect(scoreAgainstQuery('xyz', 'abc', 'def')).toBe(0);
  });

  it('returns non-zero score for a matching subsequence', () => {
    expect(scoreAgainstQuery('dash', 'dashboard')).toBeGreaterThan(0);
  });

  it('picks the best score across multiple haystacks', () => {
    const scoreWithExact = scoreAgainstQuery('ab', 'ab', 'xaxbx');
    const scoreExact = scoreAgainstQuery('ab', 'ab');
    const scoreSparse = scoreAgainstQuery('ab', 'xaxbx');
    // Both haystacks present — result should be best of the two
    expect(scoreWithExact).toBe(Math.max(scoreExact, scoreSparse));
  });

  it('skips empty haystacks without throwing', () => {
    expect(scoreAgainstQuery('abc', '')).toBe(0);
  });

  it('awards word-boundary bonus for character after space', () => {
    const withBoundary = scoreAgainstQuery('d', 'nav dashboard');
    const withoutBoundary = scoreAgainstQuery('d', 'abcde');
    // word-boundary gives +3, so boundary match should outscore mid-word
    expect(withBoundary).toBeGreaterThan(withoutBoundary);
  });

  it('awards word-boundary bonus for character after hyphen', () => {
    // Same-length haystacks: 'axs' vs 'a-s' — both have 's' at pos 2, but 'a-s' gets word-boundary bonus
    const withHyphen = scoreAgainstQuery('s', 'a-s');
    const withoutHyphen = scoreAgainstQuery('s', 'axs');
    expect(withHyphen).toBeGreaterThan(withoutHyphen);
  });

  it('awards word-boundary bonus for character after slash', () => {
    const withSlash = scoreAgainstQuery('a', 'foo/ai');
    expect(withSlash).toBeGreaterThan(0);
  });

  it('score is higher for exact full match than sparse subsequence', () => {
    const exact = scoreAgainstQuery('write', 'write');
    const sparse = scoreAgainstQuery('write', 'w-r-i-t-e longword');
    expect(exact).toBeGreaterThan(sparse);
  });

  it('returns 0 when haystack is too short to contain all query chars', () => {
    expect(scoreAgainstQuery('abcdefghij', 'ab')).toBe(0);
  });

  it('handles single-char query matching first char', () => {
    expect(scoreAgainstQuery('d', 'dashboard')).toBeGreaterThan(0);
  });

  it('handles query longer than normalized haystack', () => {
    expect(scoreAgainstQuery('abcde', 'abc')).toBe(0);
  });
});

describe('highlightSubsequence', () => {
  it('returns single non-match segment for empty query', () => {
    const result = highlightSubsequence('', 'Dashboard');
    expect(result).toEqual([{ text: 'Dashboard', match: false }]);
  });

  it('highlights a matching prefix', () => {
    const result = highlightSubsequence('da', 'Dashboard');
    const matchedText = result
      .filter((s) => s.match)
      .map((s) => s.text)
      .join('');
    expect(matchedText.toLowerCase()).toBe('da');
  });

  it('does not throw on empty display text', () => {
    const result = highlightSubsequence('abc', '');
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns non-match when query chars are not in display text', () => {
    const result = highlightSubsequence('xyz', 'Dashboard');
    const hasMatch = result.some((s) => s.match);
    expect(hasMatch).toBe(false);
  });

  it('result segments concatenate back to the original displayText', () => {
    const text = 'Manuscript Editor';
    const result = highlightSubsequence('me', text);
    const reconstructed = result.map((s) => s.text).join('');
    expect(reconstructed).toBe(text);
  });

  it('handles query longer than displayText gracefully', () => {
    const result = highlightSubsequence('abcdefghijklmnop', 'abc');
    const reconstructed = result.map((s) => s.text).join('');
    expect(reconstructed).toBe('abc');
  });

  it('all segments have text and match fields', () => {
    const result = highlightSubsequence('wrt', 'Writer Studio');
    for (const seg of result) {
      expect(typeof seg.text).toBe('string');
      expect(typeof seg.match).toBe('boolean');
    }
  });

  it('consecutive matched chars form a single match segment', () => {
    const result = highlightSubsequence('dash', 'dashboard');
    const matchSegments = result.filter((s) => s.match);
    // 'dash' appears consecutively at the start — should be one segment
    expect(matchSegments.length).toBeGreaterThanOrEqual(1);
    expect(matchSegments[0]?.text.toLowerCase()).toBe('dash');
  });
});
