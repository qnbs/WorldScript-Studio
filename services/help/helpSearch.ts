import type { HelpCategory } from '../../types';
import { normalizeSearch } from '../commands/fuzzyScore';

export type FlatHelpArticle = {
  categoryId: string;
  categoryTitleKey: string;
  titleKey: string;
  contentKey: string;
  tryActionId?: string;
};

export type HelpSearchIndexEntry = FlatHelpArticle & { haystack: string };

export function flattenHelpArticles(categories: HelpCategory[]): FlatHelpArticle[] {
  const out: FlatHelpArticle[] = [];
  for (const cat of categories) {
    if (!Array.isArray(cat.articles)) continue;
    for (const article of cat.articles) {
      out.push({
        categoryId: cat.id,
        categoryTitleKey: cat.title,
        titleKey: article.title,
        contentKey: article.content,
        ...(article.tryActionId ? { tryActionId: article.tryActionId } : {}),
      });
    }
  }
  return out;
}

/** Pre-translate article fields once per locale change — avoids re-translating HTML on every keystroke. */
export function buildHelpSearchIndex(
  articles: FlatHelpArticle[],
  translate: (key: string) => string,
): HelpSearchIndexEntry[] {
  return articles.map((a) => ({
    ...a,
    haystack: normalizeSearch(
      `${translate(a.titleKey)} ${stripHtml(translate(a.contentKey))} ${translate(a.categoryTitleKey)}`,
    ),
  }));
}

/** Fast search over a pre-built index (see buildHelpSearchIndex). */
export function searchHelpArticlesIndexed(
  index: HelpSearchIndexEntry[],
  query: string,
): FlatHelpArticle[] {
  const q = normalizeSearch(query.trim());
  if (!q) return [];
  return index.filter((entry) => entry.haystack.includes(q));
}

/** Search help articles by translated title + stripped HTML body. */
export function searchHelpArticles(
  articles: FlatHelpArticle[],
  query: string,
  translate: (key: string) => string,
): FlatHelpArticle[] {
  return searchHelpArticlesIndexed(buildHelpSearchIndex(articles, translate), query);
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
