// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetLanguageToolCacheForTest,
  applyMatchReplacement,
  checkText,
} from '../../services/languageToolService';

// A minimal but realistic LanguageTool /v2/check response.
function ltResponse(
  matches: Array<{
    offset: number;
    length: number;
    message?: string;
    shortMessage?: string;
    replacements?: string[];
    ruleId?: string;
    issueType?: string;
    categoryId?: string;
    categoryName?: string;
  }>,
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      matches: matches.map((m) => ({
        message: m.message ?? 'Possible issue',
        shortMessage: m.shortMessage ?? '',
        offset: m.offset,
        length: m.length,
        replacements: (m.replacements ?? []).map((value) => ({ value })),
        rule: {
          id: m.ruleId ?? 'SOME_RULE',
          issueType: m.issueType ?? 'grammar',
          category: { id: m.categoryId ?? 'GRAMMAR', name: m.categoryName ?? 'Grammar' },
        },
      })),
    }),
  } as unknown as Response;
}

const BASE = 'http://localhost:8010';

describe('languageToolService.checkText', () => {
  beforeEach(() => {
    _resetLanguageToolCacheForTest();
  });

  it('parses matches and slices matchedText from the source', async () => {
    const text = 'She go to the market.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ltResponse([{ offset: 4, length: 2, replacements: ['goes'], message: 'Agreement' }]),
      );
    const result = await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl });

    expect(result.status).toBe('ok');
    expect(result.matches).toHaveLength(1);
    const firstMatch = result.matches[0]!;
    expect(firstMatch.matchedText).toBe('go');
    expect(firstMatch.replacements).toEqual(['goes']);
    expect(firstMatch.offset).toBe(4);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('returns ok with no fetch for empty/whitespace text', async () => {
    const fetchImpl = vi.fn();
    const result = await checkText('   \n  ', 'en-US', { baseUrl: BASE, fetchImpl });
    expect(result.status).toBe('ok');
    expect(result.matches).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves a second identical check from cache (no second fetch)', async () => {
    const text = 'A teh typo.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ltResponse([{ offset: 2, length: 3, issueType: 'misspelling' }]));
    await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl });
    await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('filters spelling matches that are in the user dictionary', async () => {
    const text = 'Gandalf walked on.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ltResponse([{ offset: 0, length: 7, issueType: 'misspelling', categoryId: 'TYPOS' }]),
      );
    const withDict = await checkText(text, 'en-US', {
      baseUrl: BASE,
      fetchImpl,
      dictionary: ['gandalf'],
    });
    expect(withDict.matches).toHaveLength(0);

    // Cache is keyed by text, not dictionary — a fresh call without the dict still sees the match.
    const withoutDict = await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl });
    expect(withoutDict.matches).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce(); // second call hit the cache
  });

  it('does NOT filter a non-spelling match even if its text is in the dictionary', async () => {
    const text = 'however it works.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(ltResponse([{ offset: 0, length: 7, issueType: 'style' }]));
    const result = await checkText(text, 'en-US', {
      baseUrl: BASE,
      fetchImpl,
      dictionary: ['however'],
    });
    expect(result.matches).toHaveLength(1);
  });

  it('caps replacements at maxReplacements', async () => {
    const text = 'colour somewhere.';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        ltResponse([{ offset: 0, length: 6, replacements: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }]),
      );
    const result = await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl, maxReplacements: 3 });
    expect(result.matches[0]!.replacements).toEqual(['a', 'b', 'c']);
  });

  it('drops matches whose range falls outside the text', async () => {
    const text = 'short';
    const fetchImpl = vi.fn().mockResolvedValue(
      ltResponse([
        { offset: 3, length: 99 },
        { offset: 0, length: 5 },
      ]),
    );
    const result = await checkText(text, 'en-US', { baseUrl: BASE, fetchImpl });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.offset).toBe(0);
  });

  it('degrades to offline (empty, no throw) when fetch rejects', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkText('Some text.', 'en-US', { baseUrl: BASE, fetchImpl });
    expect(result.status).toBe('offline');
    expect(result.matches).toEqual([]);
  });

  it('returns error status on non-2xx HTTP', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response);
    const result = await checkText('Some text.', 'en-US', { baseUrl: BASE, fetchImpl });
    expect(result.status).toBe('error');
    expect(result.matches).toEqual([]);
  });

  it('rethrows when the caller-supplied signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(
      checkText('Some text.', 'en-US', { baseUrl: BASE, fetchImpl, signal: controller.signal }),
    ).rejects.toBeTruthy();
  });
});

describe('languageToolService.applyMatchReplacement', () => {
  it('replaces the flagged span with the suggestion', () => {
    const out = applyMatchReplacement(
      'She go to the market.',
      { offset: 4, length: 2, matchedText: 'go' },
      'goes',
    );
    expect(out).toBe('She goes to the market.');
  });

  it('does nothing when matchedText differs from the current span (stale offset)', () => {
    const out = applyMatchReplacement(
      'Completely different sentence.',
      { offset: 0, length: 3, matchedText: 'XYZ' },
      'ABC',
    );
    expect(out).toBe('Completely different sentence.');
  });

  it('ignores out-of-bounds ranges', () => {
    const out = applyMatchReplacement('hi', { offset: 0, length: 99, matchedText: 'hi' }, 'X');
    expect(out).toBe('hi');
  });
});
