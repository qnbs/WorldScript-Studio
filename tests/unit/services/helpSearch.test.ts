/**
 * Tests for services/help/helpSearch.ts
 * QNBS-v3: Pure functions — flattenHelpArticles, buildHelpSearchIndex, searchHelpArticlesIndexed, searchHelpArticles.
 */

import { describe, expect, it } from 'vitest';
import {
  buildHelpSearchIndex,
  flattenHelpArticles,
  searchHelpArticles,
  searchHelpArticlesIndexed,
} from '../../../services/help/helpSearch';
import type { HelpCategory } from '../../../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    title: 'help.cat.gettingStarted',
    icon: 'BookOpen',
    articles: [
      {
        title: 'help.art.intro.title',
        content: 'help.art.intro.content',
        tryActionId: 'open-dashboard',
      },
      { title: 'help.art.setup.title', content: 'help.art.setup.content' },
    ],
  },
  {
    id: 'ai',
    title: 'help.cat.ai',
    icon: 'Sparkles',
    articles: [{ title: 'help.art.ai.title', content: 'help.art.ai.content' }],
  },
];

const translate = (key: string) => {
  const map: Record<string, string> = {
    'help.cat.gettingStarted': 'Getting Started',
    'help.art.intro.title': 'Introduction',
    'help.art.intro.content': '<p>Welcome to WorldScript Studio.</p>',
    'help.art.setup.title': 'Setup',
    'help.art.setup.content': '<p>Install and configure.</p>',
    'help.cat.ai': 'AI Features',
    'help.art.ai.title': 'AI Writing Assistant',
    'help.art.ai.content': '<p>Use Gemini or OpenAI to generate text.</p>',
  };
  return map[key] ?? key;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('flattenHelpArticles', () => {
  it('returns empty array for empty categories', () => {
    expect(flattenHelpArticles([])).toEqual([]);
  });

  it('flattens all articles across categories', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    expect(flat).toHaveLength(3);
  });

  it('sets correct categoryId and categoryTitleKey', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    expect(flat[0]?.categoryId).toBe('getting-started');
    expect(flat[0]?.categoryTitleKey).toBe('help.cat.gettingStarted');
  });

  it('carries tryActionId when present', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    expect(flat[0]?.tryActionId).toBe('open-dashboard');
  });

  it('does not set tryActionId when absent', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    expect(flat[1]?.tryActionId).toBeUndefined();
  });

  it('skips category with no articles array', () => {
    const cats = [
      {
        id: 'empty',
        title: 'empty.title',
        icon: 'HelpCircle',
        articles: undefined as unknown as HelpCategory['articles'],
      },
      ...CATEGORIES,
    ];
    const flat = flattenHelpArticles(cats);
    expect(flat).toHaveLength(3); // same count as CATEGORIES
  });
});

describe('buildHelpSearchIndex', () => {
  it('builds an index entry for each article', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    const index = buildHelpSearchIndex(flat, translate);
    expect(index).toHaveLength(3);
  });

  it('haystack contains translated title (normalised)', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    const index = buildHelpSearchIndex(flat, translate);
    // "Introduction" → normalised lowercase
    expect(index[0]?.haystack).toContain('introduction');
  });

  it('haystack strips HTML tags from content', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    const index = buildHelpSearchIndex(flat, translate);
    expect(index[0]?.haystack).not.toContain('<p>');
    expect(index[0]?.haystack).toContain('welcome');
  });
});

describe('searchHelpArticlesIndexed', () => {
  const flat = flattenHelpArticles(CATEGORIES);
  const index = buildHelpSearchIndex(flat, translate);

  it('returns empty array for empty query', () => {
    expect(searchHelpArticlesIndexed(index, '')).toEqual([]);
  });

  it('returns matching articles for a known keyword', () => {
    const results = searchHelpArticlesIndexed(index, 'introduction');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.titleKey).toBe('help.art.intro.title');
  });

  it('returns empty for unknown keyword', () => {
    expect(searchHelpArticlesIndexed(index, 'xyzzy_not_found')).toHaveLength(0);
  });

  it('is case-insensitive (normalised)', () => {
    const lower = searchHelpArticlesIndexed(index, 'gemini');
    const upper = searchHelpArticlesIndexed(index, 'GEMINI');
    expect(lower).toHaveLength(upper.length);
  });
});

describe('searchHelpArticles', () => {
  it('combines flatten + index + search', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    const results = searchHelpArticles(flat, 'setup', translate);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.titleKey).toBe('help.art.setup.title');
  });

  it('returns empty for no match', () => {
    const flat = flattenHelpArticles(CATEGORIES);
    expect(searchHelpArticles(flat, 'nothinghere', translate)).toHaveLength(0);
  });
});
