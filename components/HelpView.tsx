import DOMPurify from 'dompurify';
import type { FC } from 'react';
import React, { Fragment, useEffect, useRef } from 'react';
import { useAppSelector } from '../app/hooks';
import { ICONS } from '../constants';
import { useCommandExecutor } from '../contexts/CommandExecutorContext';
import { HelpViewContext, useHelpViewContext } from '../contexts/HelpViewContext';
import { useHelpView } from '../hooks/useHelpView';
import { startSpotlightTour } from '../services/spotlightTour';
import type { HelpCategory } from '../types';
import { HelpSearchInput, HelpSearchPanel } from './help/HelpSearchPanel';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Input } from './ui/Input';
import { SectionIcon } from './ui/SectionIcon';
import { Spinner } from './ui/Spinner';

// --- SUB-COMPONENTS ---

const iconMap: { [key: string]: React.ReactNode } = {
  DASHBOARD: ICONS.DASHBOARD,
  DOCUMENT_TEXT: ICONS.DOCUMENT_TEXT,
  SPARKLES: ICONS.SPARKLES,
  SETTINGS: ICONS.SETTINGS,
  HELP: ICONS.HELP,
  WORLD: ICONS.WORLD,
  LIGHTNING_BOLT: ICONS.LIGHTNING_BOLT,
  WRITER: ICONS.WRITER,
  TEMPLATES: ICONS.TEMPLATES,
  OUTLINE: ICONS.OUTLINE,
  CHARACTERS: ICONS.CHARACTERS,
  EXPORT: ICONS.EXPORT,
  CRITIC: ICONS.CRITIC,
};

const NavButton: FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ icon, label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center flex-shrink-0 md:flex-shrink md:w-full px-3 py-2 text-left rounded-md transition-colors whitespace-nowrap md:whitespace-normal ${isActive ? 'bg-[var(--nav-background-active)] text-[var(--nav-text-active)]' : 'hover:bg-[var(--nav-background-hover)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'}`}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-5 h-5 mr-3"
    >
      {icon}
    </svg>
    <span>{label}</span>
  </button>
));
NavButton.displayName = 'NavButton';

const ArticleViewer: FC = () => {
  const { t, selectedArticle, handleBackToList } = useHelpViewContext();
  const executeCommand = useCommandExecutor();
  const theme = useAppSelector((state) => state.settings.theme);

  if (!selectedArticle) return null;

  const tryId = selectedArticle.tryActionId;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center flex-wrap gap-2 justify-between">
          <div className="flex items-center min-w-0">
            <Button variant="ghost" size="sm" onClick={handleBackToList} className="mr-2 -ml-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </Button>
            <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
              {t(selectedArticle.title)}
            </h2>
          </div>
          {tryId ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => executeCommand(tryId)}
            >
              {t('help.article.tryItNow')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {/* biome-ignore-start lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify */}
        <div
          className={`prose max-w-none prose-h2:text-2xl prose-h2:font-bold prose-h3:font-semibold prose-p:text-[var(--sc-text-secondary)] prose-strong:text-[var(--sc-text-primary)] prose-a:text-[var(--sc-accent)] prose-ul:list-disc prose-li:text-[var(--sc-text-secondary)] prose-ol:text-[var(--sc-text-secondary)] ${theme === 'dark' ? 'prose-invert' : ''}`}
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t(selectedArticle.content)) }}
        />
        {/* biome-ignore-end lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify */}
      </CardContent>
    </Card>
  );
};

const ArticleList: FC<{ category: HelpCategory }> = ({ category }) => {
  const { t, handleSelectArticle } = useHelpViewContext();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">{t(category.title)}</h2>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.isArray(category.articles) &&
            category.articles.map((article) => (
              <button
                type="button"
                key={article.title}
                onClick={() => handleSelectArticle(article)}
                className="w-full text-left p-3 rounded-md text-base transition-colors text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] hover:text-[var(--sc-text-primary)] font-medium"
              >
                {t(article.title)}
              </button>
            ))}
        </div>
      </CardContent>
    </Card>
  );
};

const ChatMessage: FC<{ role: 'user' | 'model'; text: string }> = React.memo(({ role, text }) => {
  const isUser = role === 'user';
  const theme = useAppSelector((state) => state.settings.theme);

  const parsedText = text.split(/```([\s\S]*?)```/g).map((part, index) => {
    if (index % 2 === 1) {
      return (
        <pre
          // biome-ignore lint/suspicious/noArrayIndexKey: deterministic regex split of immutable text
          key={`code-${index}`}
          className="bg-[var(--sc-surface-base)] p-3 rounded-md text-sm whitespace-pre-wrap"
        >
          <code>{part}</code>
        </pre>
      );
    }
    const bolded = part.split(/(\*\*[\s\S]*?\*\*)/g).map((subPart, subIndex) => {
      if (subIndex % 2 === 1) {
        // biome-ignore lint/suspicious/noArrayIndexKey: deterministic regex split of immutable text
        return <strong key={`b-${index}-${subIndex}`}>{subPart.slice(2, -2)}</strong>;
      }
      return subPart;
    });
    // biome-ignore lint/suspicious/noArrayIndexKey: deterministic regex split of immutable text
    return <Fragment key={`t-${index}`}>{bolded}</Fragment>;
  });

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 text-indigo-400"
          >
            {ICONS.SPARKLES}
          </svg>
        </div>
      )}
      <div
        className={`max-w-xl p-3 rounded-lg prose ${theme === 'dark' ? 'prose-invert' : ''} prose-p:my-0 ${isUser ? 'bg-[var(--sc-accent)] text-white shadow-lg' : 'bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)]'}`}
      >
        {parsedText}
      </div>
    </div>
  );
});
ChatMessage.displayName = 'ChatMessage';

const AiAssistant: FC = () => {
  const { t, chatHistory, userInput, setUserInput, isAiReplying, handleAskAi } =
    useHelpViewContext();
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const lastChatText = chatHistory[chatHistory.length - 1]?.text ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll chat pane when history or streaming updates
  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatHistory.length, lastChatText, isAiReplying]);

  const handleSuggestionClick = (suggestion: string) => {
    setUserInput(suggestion);
    void handleAskAi(suggestion);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex items-center gap-3">
          <SectionIcon section="help" size="sm" />
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('help.ai.title')}
          </h2>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex flex-col flex-grow min-h-0">
        <div ref={chatContainerRef} className="flex-grow p-4 space-y-4 overflow-y-auto">
          {chatHistory.map((msg, index) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat history
            return <ChatMessage key={`${msg.role}-${index}`} {...msg} />;
          })}
          {isAiReplying &&
            chatHistory.length > 0 &&
            chatHistory[chatHistory.length - 1]?.text === '' && (
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-5 h-5 text-indigo-400"
                  >
                    {ICONS.SPARKLES}
                  </svg>
                </div>
                <div
                  className={`max-w-xl p-3 rounded-lg bg-[var(--glass-bg)] border border-[var(--sc-border-subtle)] flex space-x-2 items-center`}
                >
                  <div
                    className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"
                    style={{ animationDelay: '0s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"
                    style={{ animationDelay: '0.4s' }}
                  ></div>
                </div>
              </div>
            )}
        </div>
        <div className="p-4 border-t border-[var(--sc-border-subtle)] space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSuggestionClick(t('help.ai.suggestion1'))}
            >
              {t('help.ai.suggestion1')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSuggestionClick(t('help.ai.suggestion2'))}
            >
              {t('help.ai.suggestion2')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSuggestionClick(t('help.ai.suggestion3'))}
            >
              {t('help.ai.suggestion3')}
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAskAi();
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="text"
              placeholder={t('help.ai.placeholder')}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isAiReplying}
              className="flex-grow"
            />
            <Button
              type="submit"
              disabled={isAiReplying || !userInput}
              aria-label={t('help.tabs.askAi')}
            >
              {isAiReplying ? (
                <Spinner />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                  />
                </svg>
              )}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};

const HelpViewUI: FC = () => {
  const {
    t,
    helpContent,
    activeCategory,
    selectedArticle,
    searchQuery,
    setSearchQuery,
    searchResults,
    handleSelectCategory,
    handleSearchSelect,
  } = useHelpViewContext();

  const handleStartTour = () => {
    startSpotlightTour((key) => t(key));
  };

  const renderContent = () => {
    if (selectedArticle) {
      return <ArticleViewer />;
    }

    if (activeCategory === 'ai') {
      return <AiAssistant />;
    }

    const category = helpContent.find((cat) => cat.id === activeCategory);
    if (category) {
      return <ArticleList category={category} />;
    }

    return null;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">{t('help.title')}</h1>
        <p className="mt-2 text-sm text-[var(--sc-text-secondary)] max-w-2xl">
          {t('help.description')}
        </p>
      </div>
      <HelpSearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={t('help.searchPlaceholder')}
      />
      <HelpSearchPanel
        query={searchQuery}
        onQueryChange={setSearchQuery}
        results={searchResults}
        translate={t}
        onSelect={handleSearchSelect}
        onClear={() => setSearchQuery('')}
      />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-8">
        <div className="md:col-span-1">
          {/* Mobile: horizontal scroll strip · Desktop: vertical sticky sidebar */}
          <div className="flex md:flex-col gap-2 md:space-y-2 md:gap-0 overflow-x-auto md:overflow-x-visible no-scrollbar pb-2 md:pb-0 sticky top-0 md:top-20 z-10 bg-[var(--sc-surface-base)] md:bg-transparent -mx-4 px-4 md:mx-0 md:px-0 pt-2 md:pt-0">
            {Array.isArray(helpContent) &&
              helpContent.map((cat) => (
                <NavButton
                  key={cat.id}
                  icon={iconMap[cat.icon] ?? ICONS.HELP}
                  label={t(cat.title)}
                  isActive={activeCategory === cat.id}
                  onClick={() => handleSelectCategory(cat.id)}
                />
              ))}
            <NavButton
              key="ai"
              icon={ICONS.SPARKLES}
              label={t('help.ai.title')}
              isActive={activeCategory === 'ai'}
              onClick={() => handleSelectCategory('ai')}
            />
            <Button
              type="button"
              variant="secondary"
              className="mt-2 w-full max-w-full shrink-0"
              onClick={handleStartTour}
            >
              {t('tour.help.startButton')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="mt-1 w-full max-w-full shrink-0 text-sm"
              onClick={() => startSpotlightTour((key) => t(key), 'navigation')}
            >
              {t('tour.navigationOnly.startButton')}
            </Button>
          </div>
        </div>
        <div className="md:col-span-3 min-h-0 md:min-h-[60vh]">
          {!searchQuery.trim() ? renderContent() : null}
        </div>
      </div>
    </div>
  );
};

export const HelpView: FC = () => {
  const contextValue = useHelpView();
  return (
    <HelpViewContext.Provider value={contextValue}>
      <HelpViewUI />
    </HelpViewContext.Provider>
  );
};
