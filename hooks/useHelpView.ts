import { useCallback, useMemo, useState } from 'react';
import { catalogToHelpCategories } from '../services/help/helpCatalog';
import {
  buildHelpSearchIndex,
  flattenHelpArticles,
  searchHelpArticlesIndexed,
} from '../services/help/helpSearch';
import type { HelpArticle } from '../types';
import { useTranslation } from './useTranslation';

export const useHelpView = () => {
  const { t } = useTranslation();

  const helpContent = useMemo(() => catalogToHelpCategories(), []);
  const flatArticles = useMemo(() => flattenHelpArticles(helpContent), [helpContent]);
  const searchIndex = useMemo(() => buildHelpSearchIndex(flatArticles, t), [flatArticles, t]);

  const [activeCategory, setActiveCategory] = useState<string>('getting-started');
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
