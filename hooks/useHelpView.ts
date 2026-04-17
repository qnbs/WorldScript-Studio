import { useState, useCallback } from 'react';
import { useTranslation } from './useTranslation';
import type { HelpCategory, HelpArticle } from '../types';
import { useAppSelector } from '../app/hooks';
import { streamAiHelpResponse } from '../services/aiProviderService';
import type { AiCreativity } from '../types';

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

  const rawHelpContent = t<HelpCategory[]>('help.categories');
  const helpContent: HelpCategory[] = Array.isArray(rawHelpContent)
    ? rawHelpContent.filter((c): c is HelpCategory => c != null && typeof c === 'object' && 'id' in c)
    : [];

  const [activeCategory, setActiveCategory] = useState<string>(helpContent[0]?.id || 'ai');
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  // AI Assistant State
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'model', text: t('help.ai.initialMessage') },
  ]);
  const [isAiReplying, setIsAiReplying] = useState(false);

  const handleSelectCategory = useCallback((categoryId: string) => {
    setActiveCategory(categoryId);
    setSelectedArticle(null); // Reset article selection when changing category
  }, []);

  const handleSelectArticle = useCallback((article: HelpArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  const handleAskAi = useCallback(async () => {
    if (!userInput.trim() || isAiReplying) return;

    const newUserMessage: ChatMessage = { role: 'user', text: userInput };
    const aiPlaceholderMessage: ChatMessage = { role: 'model', text: '' };

    setChatHistory((prev) => [...prev, newUserMessage, aiPlaceholderMessage]);
    setIsAiReplying(true);
    const question = userInput;
    setUserInput('');

    try {
      const temperature = creativityToTemperature[settings.aiCreativity];
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
        }
      );
    } catch {
      setChatHistory((prev) => {
        const lastMsgIndex = prev.length - 1;
        const lastMessage = prev[lastMsgIndex];
        if (lastMessage?.role === 'model') {
          const newHistory = [...prev];
          newHistory[lastMsgIndex] = { ...lastMessage, text: 'Sorry, I encountered an error.' };
          return newHistory;
        }
        return prev;
      });
    } finally {
      setIsAiReplying(false);
    }
  }, [userInput, isAiReplying, settings.aiCreativity, settings.advancedAi]);

  return {
    t,
    helpContent,
    activeCategory,
    selectedArticle,
    handleSelectCategory,
    handleSelectArticle,
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
