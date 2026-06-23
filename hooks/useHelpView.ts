import { useCallback, useMemo, useState } from 'react';
import { catalogToHelpCategories } from '../services/help/helpCatalog';
import {
  buildHelpSearchIndex,
  flattenHelpArticles,
  searchHelpArticlesIndexed,
} from '../services/help/helpSearch';
import type { HelpArticle, View } from '../types';
import { useTranslation } from './useTranslation';

// QNBS-v3: PR3 — view-aware Help. Maps the view the user came from to the most relevant help
// category so Help opens contextually instead of always on "getting-started".
const VIEW_TO_HELP_CATEGORY: Partial<Record<View, string>> = {
  dashboard: 'getting-started',
  templates: 'getting-started',
  manuscript: 'writing',
  writer: 'writing',
  zen: 'writing',
  outline: 'writing',
  preview: 'writing',
  sceneboard: 'writing',
  mindmap: 'writing',
  characters: 'worldbuilding',
  world: 'worldbuilding',
  objects: 'worldbuilding',
  characterGraph: 'worldbuilding',
  characterInterviews: 'worldbuilding',
  consistencyChecker: 'analysis',
  critic: 'analysis',
  analytics: 'analysis',
  progress: 'analysis',
  export: 'management',
  settings: 'settings-guide',
  // QNBS-v3 (CodeAnt): LoRA help content lives under the 'advanced' category (help.advanced.lora.*),
  // not 'ai-studio' — map there so Help opens on the actual LoRA docs.
  lora: 'advanced',
};

/** Resolve the initial help category from the originating view (defaults to getting-started). */
export function helpCategoryForView(view?: View): string {
  return (view && VIEW_TO_HELP_CATEGORY[view]) || 'getting-started';
}

export const useHelpView = (contextView?: View) => {
  const { t } = useTranslation();

  const helpContent = useMemo(() => catalogToHelpCategories(), []);
  const flatArticles = useMemo(() => flattenHelpArticles(helpContent), [helpContent]);
  const searchIndex = useMemo(() => buildHelpSearchIndex(flatArticles, t), [flatArticles, t]);

  const [activeCategory, setActiveCategory] = useState<string>(() =>
    helpCategoryForView(contextView),
  );
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(
    () => searchHelpArticlesIndexed(searchIndex, searchQuery),
    [searchIndex, searchQuery],
  );

  const handleSelectCategory = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
    setSelectedArticle(null);
    setSearchQuery('');
  }, []);

  const handleSearchSelect = useCallback(
    (hit: { categoryId: string; titleKey: string; contentKey: string; tryActionId?: string }) => {
      const cat = helpContent.find((c) => c.id === hit.categoryId);
      const article = cat?.articles.find((a) => a.title === hit.titleKey);
      if (article) {
        setActiveCategory(hit.categoryId);
        setSelectedArticle(article);
        setSearchQuery('');
      }
    },
    [helpContent],
  );

  const handleSelectArticle = useCallback((article: HelpArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  return {
    t,
    helpContent,
    activeCategory,
    selectedArticle,
    searchQuery,
    setSearchQuery,
    searchResults,
    handleSelectCategory,
    handleSelectArticle,
    handleSearchSelect,
    handleBackToList,
  };
};

export type UseHelpViewReturnType = ReturnType<typeof useHelpView>;
