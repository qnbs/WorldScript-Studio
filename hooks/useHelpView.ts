import { useCallback, useMemo, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { streamAiHelpResponse } from '../services/aiProviderService';
import { catalogToHelpCategories } from '../services/help/helpCatalog';
import { retrieveHelpDocContext } from '../services/help/helpDocRetrieval';
import {
  buildHelpSearchIndex,
  flattenHelpArticles,
  searchHelpArticlesIndexed,
} from '../services/help/helpSearch';
import type { AiCreativity, HelpArticle } from '../types';
import { useTranslation } from './useTranslation';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}
const creativityToTemperature: Record<AiCreativity, number> = {
  Focused: 0.2,
  Balanced: 0.7,
  Imaginative: 1.0,
};

export const useHelpView = () => {
  const { t } = useTranslation();
  const settings = useAppSelector((state) => state.settings);

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

  // AI Assistant State
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'model', text: t('help.ai.initialMessage') },
  ]);
  const [isAiReplying, setIsAiReplying] = useState(false);

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

  const handleAskAi = useCallback(
    async (overrideQuestion?: string) => {
      const question = (overrideQuestion ?? userInput).trim();
      if (!question || isAiReplying) return;

      const newUserMessage: ChatMessage = { role: 'user', text: question };
      const aiPlaceholderMessage: ChatMessage = { role: 'model', text: '' };

      setChatHistory((prev) => [...prev, newUserMessage, aiPlaceholderMessage]);
      setIsAiReplying(true);
      setUserInput('');

      try {
        const temperature = creativityToTemperature[settings.aiCreativity];
        const docContext = retrieveHelpDocContext(question);

        await streamAiHelpResponse(
          question,
          settings.aiCreativity,
          {
            provider: settings.advancedAi.provider,
            model: settings.advancedAi.model,
            temperature,
            maxTokens: settings.advancedAi.maxTokens,
            ollamaBaseUrl: settings.advancedAi.ollamaBaseUrl,
          },
          {
            onChunk: (chunk) => {
              setChatHistory((prev) => {
                const lastMsgIndex = prev.length - 1;
                const lastMessage = prev[lastMsgIndex];
                if (lastMessage?.role === 'model') {
                  const newHistory = [...prev];
                  newHistory[lastMsgIndex] = {
                    ...lastMessage,
                    text: lastMessage.text + chunk,
                  };
                  return newHistory;
                }
                return prev;
              });
            },
          },
          { docContext },
        );
      } catch {
        setChatHistory((prev) => {
          const lastMsgIndex = prev.length - 1;
          const lastMessage = prev[lastMsgIndex];
          if (lastMessage?.role === 'model') {
            const newHistory = [...prev];
            newHistory[lastMsgIndex] = { ...lastMessage, text: t('help.ai.error') };
            return newHistory;
          }
          return prev;
        });
      } finally {
        setIsAiReplying(false);
      }
    },
    [userInput, isAiReplying, settings.aiCreativity, settings.advancedAi, t],
  );

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
    // AI state
    chatHistory,
    userInput,
    setUserInput,
    isAiReplying,
    handleAskAi,
  };
};

export type UseHelpViewReturnType = ReturnType<typeof useHelpView>;
