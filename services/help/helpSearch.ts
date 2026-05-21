import type { HelpCategory } from '../../types';
import { normalizeSearch } from '../commands/fuzzyScore';

export type FlatHelpArticle = {
  categoryId: string;
  categoryTitleKey: string;
  titleKey: string;
  contentKey: string;
  tryActionId?: string;
};

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

/** Search help articles by translated title + stripped HTML body. */
export function searchHelpArticles(
  articles: FlatHelpArticle[],
  query: string,
  translate: (key: string) => string,
): FlatHelpArticle[] {
  const q = normalizeSearch(query.trim());
  if (!q) return [];

  return articles.filter((a) => {
    const title = normalizeSearch(translate(a.titleKey));
    const body = normalizeSearch(stripHtml(translate(a.contentKey)));
    const cat = normalizeSearch(translate(a.categoryTitleKey));
    return title.includes(q) || body.includes(q) || cat.includes(q);
  });
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}
