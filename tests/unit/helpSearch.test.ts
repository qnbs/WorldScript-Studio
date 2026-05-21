import { describe, expect, it, vi } from 'vitest';
import { catalogToHelpCategories } from '../../services/help/helpCatalog';
import { flattenHelpArticles, searchHelpArticles } from '../../services/help/helpSearch';

describe('helpSearch', () => {
  const t = vi.fn((key: string) => {
    if (key.includes('plot')) return 'Plot Board canvas';
    if (key.includes('rag')) return 'RAG context retrieval';
    return key;
  });

  it('flattenHelpArticles includes catalog articles', () => {
    const flat = flattenHelpArticles(catalogToHelpCategories());
    expect(flat.length).toBeGreaterThan(40);
    expect(flat.some((a) => a.titleKey.includes('plot'))).toBe(true);
  });

  it('searchHelpArticles finds plot-related content', () => {
    const flat = flattenHelpArticles(catalogToHelpCategories());
    const hits = searchHelpArticles(flat, 'plot board', t);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('searchHelpArticles returns empty for blank query', () => {
    const flat = flattenHelpArticles(catalogToHelpCategories());
    expect(searchHelpArticles(flat, '   ', t)).toEqual([]);
  });
});
