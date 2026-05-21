import { describe, expect, it, vi } from 'vitest';
import {
  buildHelpSearchIndex,
  flattenHelpArticles,
  searchHelpArticles,
  searchHelpArticlesIndexed,
} from '../../services/help/helpSearch';
import type { HelpCategory } from '../../types';

const sampleCategories: HelpCategory[] = [
  {
    id: 'writing',
    title: 'help.category.writing',
    icon: 'DOCUMENT_TEXT',
    articles: [
      {
        title: 'help.writing.plot.title',
        content: '<p>Plot Board <b>canvas</b> with beats.</p>',
      },
      { title: 'help.writing.rag.title', content: '<p>Hybrid RAG retrieval modes.</p>' },
    ],
  },
];

describe('helpSearch index', () => {
  const t = vi.fn((key: string) => {
    if (key.includes('plot')) return 'Plot Board canvas beats';
    if (key.includes('rag')) return 'Hybrid RAG retrieval';
    if (key.includes('writing')) return 'Writing';
    return key;
  });

  it('buildHelpSearchIndex normalizes haystack once', () => {
    const flat = flattenHelpArticles(sampleCategories);
    const index = buildHelpSearchIndex(flat, t);
    expect(index).toHaveLength(2);
    expect(index[0]?.haystack).toContain('plot board');
  });

  it('searchHelpArticlesIndexed matches without re-translating', () => {
    const flat = flattenHelpArticles(sampleCategories);
    const index = buildHelpSearchIndex(flat, t);
    const hits = searchHelpArticlesIndexed(index, 'hybrid rag');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.titleKey).toContain('rag');
  });

  it('searchHelpArticles delegates to indexed path', () => {
    const flat = flattenHelpArticles(sampleCategories);
    const hits = searchHelpArticles(flat, 'plot board', t);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('returns empty for whitespace query', () => {
    const flat = flattenHelpArticles(sampleCategories);
    const index = buildHelpSearchIndex(flat, t);
    expect(searchHelpArticlesIndexed(index, '   ')).toEqual([]);
  });
});
