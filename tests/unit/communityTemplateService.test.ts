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
    tags: ['fixture'],
    arcDescription: 'arc',
    stars: 5,
    sections: [{ title: 'Act 1' }],
  },
];

const mockDeTemplates = [
  {
    id: 'tpl-1',
    name: 'Test-Vorlage',
    description: 'Beschreibung',
    type: 'Structure',
    author: 'Tester',
    tags: ['Fixture'],
    arcDescription: 'Bogen',
    stars: 5,
    sections: [{ title: 'Akt 1' }],
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
  it('returns templates on successful fetch (no locale)', async () => {
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
    expect(result.isFallback).toBe(true);
    expect(result.error).toContain('offline');
  });

  it('returns fallback templates on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Network error'));

    const result = await fetchCommunityTemplates();

    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.isFallback).toBe(true);
    expect(result.error).toContain('offline');
  });

  it('returns fallback templates when JSON fails Zod validation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: '', name: 'bad' }]), { status: 200 }),
    );

    const result = await fetchCommunityTemplates();

    expect(result.templates.length).toBeGreaterThan(0);
    expect(result.isFallback).toBe(true);
  });

  it('returns empty templates on AbortError', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    vi.mocked(fetch).mockRejectedValueOnce(abortError);

    const result = await fetchCommunityTemplates();

    expect(result.templates).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('loads locale-specific file when lang is a translated locale', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockDeTemplates), { status: 200 }),
    );

    const result = await fetchCommunityTemplates('de');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toContain('index.de.json');
    expect(result.templates).toEqual(mockDeTemplates);
  });

  it('falls back to default index when locale file returns HTTP error', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('', { status: 404 })) // de file not found
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockTemplates), { status: 200 }), // en fallback
      );

    const result = await fetchCommunityTemplates('de');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.templates).toEqual(mockTemplates);
    expect(result.isFallback).toBeUndefined();
  });

  it('uses separate cache keys per locale', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTemplates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDeTemplates), { status: 200 }));

    const en = await fetchCommunityTemplates('en');
    const de = await fetchCommunityTemplates('de');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(en.templates[0]?.name).toBe('Test Template');
    expect(de.templates[0]?.name).toBe('Test-Vorlage');
  });

  it('treats unknown locales as English (single URL)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockTemplates), { status: 200 }),
    );

    await fetchCommunityTemplates('ar'); // ar is not a translated locale

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0]).not.toContain('index.ar.json');
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

  it('clears all locale caches', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTemplates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDeTemplates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockTemplates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(mockDeTemplates), { status: 200 }));

    await fetchCommunityTemplates('en');
    await fetchCommunityTemplates('de');
    clearCommunityTemplateCache();
    await fetchCommunityTemplates('en');
    await fetchCommunityTemplates('de');

    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
