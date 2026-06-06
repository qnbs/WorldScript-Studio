// QNBS-v3: Extracted from WriterView.tsx to keep each file ≤350 lines per architecture rules
import type { FC } from 'react';
import React, { useEffect, useRef } from 'react';
import type { Language } from '../../contexts/I18nContext';
import { useWriterViewContext } from '../../contexts/WriterViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useTTS } from '../../hooks/useTTS';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { Textarea } from '../ui/Textarea';

const TTS_LOCALE: Record<Language, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  ar: 'ar-SA',
  he: 'he-IL',
  // QNBS-v3: Phase 3 Beta — ja/zh/pt/el TTS locales
  ja: 'ja-JP',
  zh: 'zh-CN',
  pt: 'pt-BR',
  el: 'el-GR',
};

const AiScratchpad: FC = React.memo(() => {
  const { t, language } = useTranslation();
  const {
    writerState,
    handleAccept,
    handleGenerate,
    handleNavigateHistory,
    handleUpdateScratchpad,
  } = useWriterViewContext();
  const { generationHistory, activeHistoryIndex, isLoading, activeTool } = writerState;
  const currentResult = generationHistory[activeHistoryIndex] || '';
  const { speak, stop, isSpeaking, isSupported: ttsSupported } = useTTS();
  const ttsLang = TTS_LOCALE[language] ?? 'en-US';

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (isLoading && textareaRef.current) {
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [isLoading]);

  return (
    <div className="h-full flex flex-col">
      <Card className="h-full min-h-[400px] flex flex-col border-0 sm:border">
        <CardHeader className="hidden md:block">
          <h2 className="text-xl font-semibold text-[var(--sc-text-primary)]">
            {t('writer.studio.result.title')}
          </h2>
        </CardHeader>
        <CardContent className="flex flex-col flex-grow min-h-0 p-4 sm:p-6 overflow-hidden">
          <div
            className="relative flex-grow mb-4 overflow-hidden flex flex-col"
            aria-busy={isLoading}
          >
            <Textarea
              ref={textareaRef}
              value={currentResult}
              onChange={(e) => handleUpdateScratchpad(e.target.value)}
              className="flex-grow w-full resize-none whitespace-pre-wrap bg-[var(--glass-bg)] border-[var(--sc-border-subtle)] p-4 font-mono text-sm"
              placeholder={isLoading ? '' : t('writer.studio.result.placeholder')}
              disabled={isLoading}
            />
            {isLoading && currentResult === '' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--sc-text-muted)]">
                <Spinner className="mb-2" />
                <p className="text-sm animate-pulse">Writing...</p>
              </div>
            )}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
              {!isLoading && currentResult ? `KI-Antwort: ${currentResult.slice(0, 200)}` : ''}
            </div>
          </div>

          <div className="flex flex-col gap-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => handleNavigateHistory('prev')}
                  disabled={activeHistoryIndex <= 0}
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={t('writer.studio.result.prev')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 19.5L8.25 12l7.5-7.5"
                    />
                  </svg>
                </Button>
                <span className="text-xs font-mono text-[var(--sc-text-muted)]">
                  {generationHistory.length > 0 ? activeHistoryIndex + 1 : 0} /{' '}
                  {generationHistory.length}
                </span>
                <Button
                  onClick={() => handleNavigateHistory('next')}
                  disabled={activeHistoryIndex >= generationHistory.length - 1}
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={t('writer.studio.result.next')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.25 4.5l7.5 7.5-7.5 7.5"
                    />
                  </svg>
                </Button>
              </div>
              <div className="flex items-center space-x-2">
                {isLoading ? null : (
                  <Button
                    onClick={handleGenerate}
                    variant="secondary"
                    size="sm"
                    disabled={isLoading}
                  >
                    {t('writer.studio.result.retry')}
                  </Button>
                )}
                {ttsSupported && (
                  <Button
                    onClick={() => (isSpeaking ? stop() : speak(currentResult, ttsLang))}
                    variant="ghost"
                    size="sm"
                    aria-label={isSpeaking ? t('writer.tts.stop') : t('writer.tts.start')}
                    disabled={!currentResult || isLoading}
                  >
                    {isSpeaking ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-4 h-4"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z"
                        />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-4 h-4"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z"
                        />
                      </svg>
                    )}
                  </Button>
                )}
                <Button
                  onClick={() => navigator.clipboard.writeText(currentResult)}
                  variant="ghost"
                  size="sm"
                  aria-label={t('common.copyToClipboard')}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-4 h-4"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
                    />
                  </svg>
                </Button>
              </div>
            </div>
            {currentResult && !isLoading && activeTool !== 'synopsis' && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--sc-border-subtle)]">
                {(activeTool === 'continue' ||
                  activeTool === 'dialogue' ||
                  activeTool === 'brainstorm') && (
                  <Button onClick={() => handleAccept('insert')} className="w-full">
                    {t('writer.studio.result.insert')}
                  </Button>
                )}
                {(activeTool === 'improve' || activeTool === 'changeTone') && (
                  <Button onClick={() => handleAccept('replace')} className="w-full">
                    {t('writer.studio.result.replace')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
AiScratchpad.displayName = 'AiScratchpad';

export { AiScratchpad };
