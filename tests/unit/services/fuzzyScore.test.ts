/**
 * Tests for services/commands/fuzzyScore.ts
 * QNBS-v3: Pure functions — normalizeSearch, scoreAgainstQuery, highlightSubsequence.
 */

import { describe, expect, it } from 'vitest';
import {
  highlightSubsequence,
  normalizeSearch,
  scoreAgainstQuery,
} from '../../../services/commands/fuzzyScore';

describe('normalizeSearch', () => {
  it('lowercases the string', () => {
    expect(normalizeSearch('HELLO')).toBe('hello');
  });

  it('strips diacritics', () => {
    expect(normalizeSearch('café')).toBe('cafe');
    expect(normalizeSearch('über')).toBe('uber');
    expect(normalizeSearch('naïve')).toBe('naive');
  });

  it('trims whitespace', () => {
    expect(normalizeSearch('  test  ')).toBe('test');
  });

  it('handles empty string', () => {
    expect(normalizeSearch('')).toBe('');
  });
});

describe('scoreAgainstQuery', () => {
  it('returns 1 when query is empty (matches everything)', () => {
    expect(scoreAgainstQuery('', 'anything')).toBe(1);
  });

  it('returns 0 when query is not a subsequence of haystack', () => {
    expect(scoreAgainstQuery('xyz', 'abcdef')).toBe(0);
  });

  it('returns > 0 when query matches as subsequence', () => {
    expect(scoreAgainstQuery('dash', 'dashboard')).toBeGreaterThan(0);
  });

  it('prefers exact prefix match (higher score)', () => {
    const exactPrefix = scoreAgainstQuery('nav', 'navigate');
    const scattered = scoreAgainstQuery('nav', 'n_a_v_scattered');
    expect(exactPrefix).toBeGreaterThan(scattered);
  });

  it('accepts multiple haystacks and returns the best score', () => {
    const bestOf = scoreAgainstQuery('dash', 'other', 'dashboard', 'unrelated');
    const singleBest = scoreAgainstQuery('dash', 'dashboard');
    expect(bestOf).toBe(singleBest);
  });

  it('returns 0 when all haystacks are empty', () => {
    expect(scoreAgainstQuery('abc', '', '')).toBe(0);
  });

  it('case-insensitively matches haystack', () => {
    expect(scoreAgainstQuery('dash', 'DASHBOARD')).toBeGreaterThan(0);
  });
});

describe('highlightSubsequence', () => {
  it('returns whole string unmatched when query is empty', () => {
    const result = highlightSubsequence('', 'Dashboard');
    expect(result).toEqual([{ text: 'Dashboard', match: false }]);
  });

  it('returns segments with match=true for matched chars', () => {
    const result = highlightSubsequence('da', 'Dashboard');
    const matchedText = result
      .filter((s) => s.match)
      .map((s) => s.text)
      .join('');
    expect(matchedText.toLowerCase()).toContain('d');
    expect(matchedText.toLowerCase()).toContain('a');
  });

  it('produces at least one segment for any input', () => {
    const result = highlightSubsequence('abc', 'xyzabc');
    expect(result.length).toBeGreaterThan(0);
  });

  it('all segment texts concatenate to the original display string', () => {
    const display = 'Navigator Panel';
    const result = highlightSubsequence('nav', display);
    const reconstructed = result.map((s) => s.text).join('');
    expect(reconstructed).toBe(display);
  });
});
