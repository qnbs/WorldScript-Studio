import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCommunityTemplateCache,
  fetchCommunityTemplates,
} from '../../services/communityTemplateService';

const mockTemplates = [
  {
    id: 'tpl-1',
    name: 'Test Template',
    description: 'desc',
    type: 'Structure',
    author: 'Tester',
    tags: [],
    arcDescription: 'arc',
    stars: 5,
    sections: [{ title: 'Act 1' }],
  },
];

beforeEach(() => {
  clearCommunityTemplateCache();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCommunityTemplates', () => {
  it('returns templates on successful fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockTemplates), { status: 200 }),
    );

    const result = await fetchCommunityTemplates();

    expect(result.templates).toEqual(mockTemplates);
    expect(result.error).toBeUndefined();
    expect(result.isFallback).toBeUndefined();
  });

  it('returns cached templates on second call (no second fetch)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockTemplates), { status: 200 }),
    );

    await fetchCommunityTemplates();
    const second = await fetchCommunityTemplates();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second.templates).toEqual(mockTemplates);
  });

  it('returns fallback templates on HTTP error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));

    const result = await fetchCommunityTemplates();

    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.error).toContain('HTTP 500');
    expect(result.isFallback).toBeUndefined();
  });

  it('returns fallback templates on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network error'));

    const result = await fetchCommunityTemplates();

    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.isFallback).toBe(true);
    expect(result.error).toContain('offline');
  });

  it('returns empty templates on AbortError', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await fetchCommunityTemplates();

    expect(result.templates).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe('clearCommunityTemplateCache', () => {
  it('forces a fresh fetch after clearing', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTemplates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTemplates), { status: 200 }));

    await fetchCommunityTemplates();
    clearCommunityTemplateCache();
    await fetchCommunityTemplates();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
