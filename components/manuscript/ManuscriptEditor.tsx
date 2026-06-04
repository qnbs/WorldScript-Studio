import type { FC, ReactNode } from 'react';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '../../app/hooks';
import { ICONS } from '../../constants';
import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import { useTranslation } from '../../hooks/useTranslation';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { DebouncedInput } from '../ui/DebouncedInput';
import { Textarea } from '../ui/Textarea';

// Mock Dictionary for simple spell check (English)
const TYPOS_EN: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  seperate: 'separate',
  occured: 'occurred',
  definately: 'definitely',
  wierd: 'weird',
  accommodate: 'accommodate',
  wich: 'which',
  thier: 'their',
  alot: 'a lot',
  wont: "won't",
  dont: "don't",
  cant: "can't",
  its: "it's",
  your: "you're",
  there: 'their',
  // biome-ignore lint/suspicious/noThenProperty: typo dictionary entry, not a thenable
  then: 'than',
};

// Mock Dictionary for simple spell check (German)
const TYPOS_DE: Record<string, string> = {
  dass: 'das',
  das: 'dass',
  warscheinlich: 'wahrscheinlich',
  nähmlich: 'nämlich',
  maschine: 'Maschine',
  wieder: 'wider',
  wider: 'wieder',
  seit: 'seid',
  seid: 'seit',
  standart: 'Standard',
  'im voraus': 'im Voraus',
  vorraus: 'Voraus',
  packet: 'Paket',
  entgültig: 'endgültig',
  rythmus: 'Rhythmus',
  haken: 'Haken',
};

// QNBS-v3: concrete editor font stacks — single source mirrored from components/ui/Textarea fontMap.
const EDITOR_FONT_STACKS: Record<string, string> = {
  serif: 'Merriweather, serif',
  'sans-serif': 'Inter, sans-serif',
  monospace: 'JetBrains Mono, monospace',
  custom: 'JetBrains Mono, monospace',
};

export const ManuscriptEditor: FC<{ isFocusMode: boolean }> = React.memo(({ isFocusMode }) => {
  const {
    t,
    activeSection,
    handleContentChange,
    handleTitleChange,
    mentions,
    handleMentionSelect,
    mentionPosition,
    editorRef,
    activeSectionStats,
    characters,
    worlds,
  } = useManuscriptViewContext();
  const settings = useAppSelector((state) => state.settings);
  const { language, dir } = useTranslation();
  const [spellCheckPopover, setSpellCheckPopover] = useState<{
    x: number;
    y: number;
    word: string;
    suggestion: string;
  } | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  // QNBS-v3: Voice dictation — append transcript to active section content when dictation mode is on.
  useVoiceDictation(
    () => activeSection?.content ?? '',
    (text) => {
      if (activeSection) {
        handleContentChange(activeSection.id, text);
      }
    },
  );

  // QNBS-v3: Defer highlight computation so keystroke → textarea updates stay synchronous even for long scenes.
  const deferredContent = useDeferredValue(activeSection?.content ?? '');
  const isHighlightPending = deferredContent !== (activeSection?.content ?? '');

  // QNBS-v3: map the editorFont enum to a concrete CSS stack (mirrors components/ui/Textarea
  // fontMap) — the raw enum value (e.g. 'custom') is not a valid font-family, and the highlight
  // overlay must render the exact same stack as the textarea so glyphs stay aligned.
  const ltrEditorStack = EDITOR_FONT_STACKS[settings.editorFont] ?? 'Inter, sans-serif';
  // QNBS-v3: RTL prose needs Noto glyphs — generic serif/sans/mono lack reliable Arabic/Hebrew
  // coverage; prefer Naskh (book face) for serif/custom, Noto Sans otherwise, Latin stack as tail.
  const editorFontFamily =
    dir === 'rtl'
      ? settings.editorFont === 'sans-serif' || settings.editorFont === 'monospace'
        ? `"Noto Sans Arabic", "Noto Sans Hebrew", ${ltrEditorStack}`
        : `"Noto Naskh Arabic", "Noto Sans Hebrew", ${ltrEditorStack}`
      : ltrEditorStack;
  const editorStyles: React.CSSProperties = {
    fontFamily: editorFontFamily,
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineSpacing,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  };

  const currentTypos = language === 'de' ? TYPOS_DE : TYPOS_EN;

  const handleSpellErrorClick = useCallback(
    (e: React.MouseEvent, word: string) => {
      e.stopPropagation();
      const suggestion = currentTypos[word.toLowerCase()] || '';
      if (suggestion) {
        setSpellCheckPopover({ x: e.clientX, y: e.clientY, word, suggestion });
      }
    },
    [currentTypos],
  );

  const applyCorrection = () => {
    if (spellCheckPopover && activeSection) {
      const regex = new RegExp(`\\b${spellCheckPopover.word}\\b`);
      const newContent = activeSection.content.replace(regex, spellCheckPopover.suggestion);
      handleContentChange(activeSection.id, newContent);
      setSpellCheckPopover(null);
    }
  };

  useEffect(() => {
    const closePopover = () => setSpellCheckPopover(null);
    window.addEventListener('click', closePopover);
    return () => window.removeEventListener('click', closePopover);
  }, []);

  useEffect(() => {
    setSelectedMentionIndex(0);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.length > 0 && mentionPosition) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev + 1) % mentions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev - 1 + mentions.length) % mentions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selectedMention = mentions[selectedMentionIndex];
        if (selectedMention) handleMentionSelect(selectedMention);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleContentChange(activeSection?.id || '', activeSection?.content || '');
      }
    }
  };

  const renderedContent = useMemo(() => {
    if (!deferredContent) return '';

    const text = deferredContent;
    const characterMap = new Map(characters.map((c) => [c.name.toLowerCase(), c]));
    const worldMap = new Map(worlds.map((w) => [w.name.toLowerCase(), w]));
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    const regex = /([@#][\w\s]+?)(?=[.,:;!?\s]|$)|(\b[\wÀ-ſ']+\b)/g;

    text.replace(regex, (match, mention, word, offset) => {
      if (offset > lastIndex) parts.push(text.substring(lastIndex, offset));

      if (mention) {
        const symbol = mention[0];
        const name = mention.substring(1).toLowerCase();
        let found = false;
        if (symbol === '@' && characterMap.has(name)) found = true;
        else if (symbol === '#' && worldMap.has(name)) found = true;

        if (found) {
          const className =
            symbol === '@'
              ? 'mention-pill mention-pill-character'
              : 'mention-pill mention-pill-world';
          parts.push(
            <span key={offset} className={className}>
              {mention}
            </span>,
          );
        } else {
          parts.push(mention);
        }
      } else if (word) {
        const lowerWord = word.toLowerCase();
        if (Object.hasOwn(currentTypos, lowerWord)) {
          parts.push(
            // QNBS-v3: button replaces span[role=button] for native semantics; keyboard path derives position from bounding rect since no clientX/Y on KeyboardEvent.
            <button
              key={offset}
              type="button"
              className="spell-error bg-transparent border-0 p-0 font-[inherit] text-[inherit]"
              onClick={(e) => handleSpellErrorClick(e, word)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const synthetic = {
                    clientX: rect.left,
                    clientY: rect.bottom,
                    stopPropagation: () => {},
                  } as React.MouseEvent;
                  handleSpellErrorClick(synthetic, word);
                }
              }}
            >
              {word}
            </button>,
          );
        } else {
          parts.push(word);
        }
      }

      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < text.length) parts.push(text.substring(lastIndex));
    return <>{parts}</>;
  }, [deferredContent, characters, worlds, currentTypos, handleSpellErrorClick]);

  if (!activeSection) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center text-[var(--sc-text-muted)] p-4">
        <p>{t('manuscript.select')}</p>
      </div>
    );
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const mentionStyle: React.CSSProperties = isMobile
    ? {
        bottom: '0',
        left: '0',
        right: '0',
        width: '100%',
        maxHeight: '50vh',
        borderTop: '1px solid var(--sc-border-subtle)',
        borderRadius: '16px 16px 0 0',
      }
    : { top: mentionPosition?.top, left: mentionPosition?.left };

  const handleSelectionEvents = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    handleContentChange(activeSection.id, e.currentTarget.value);
  };

  return (
    <div className="relative h-full flex flex-col">
      <div
        className={`transition-all duration-500 ease-in-out px-4 sm:px-6 md:px-12 pt-6 pb-2 ${isFocusMode ? 'opacity-0 h-0 overflow-hidden py-0' : 'opacity-100'}`}
      >
        <DebouncedInput
          value={activeSection.title}
          onDebouncedChange={(val) => handleTitleChange(activeSection.id, val)}
          className="text-2xl sm:text-3xl font-bold bg-transparent border-0 px-0 h-auto text-[var(--sc-text-primary)] placeholder:text-[var(--sc-text-muted)] focus:ring-0"
          placeholder={t('manuscript.titlePlaceholder')}
        />
      </div>
      <div className="relative flex-grow">
        <Textarea
          ref={editorRef}
          value={activeSection.content}
          onChange={(e) => handleContentChange(activeSection.id, e.target.value)}
          onSelect={handleSelectionEvents}
          onKeyUp={handleSelectionEvents}
          onClick={handleSelectionEvents}
          onKeyDown={handleKeyDown}
          className={`h-full w-full leading-relaxed resize-none p-4 sm:p-6 md:p-12 pt-2 bg-transparent border-0 focus:ring-0 flex-grow caret-[var(--sc-text-primary)] text-transparent max-w-3xl mx-auto selection:bg-[var(--sc-accent)]/30 transition-all duration-500 ${isFocusMode ? 'max-w-4xl pt-12' : ''}`}
          placeholder={
            activeSection.prompt ||
            t('manuscript.contentPlaceholder', { title: activeSection.title })
          }
          style={{
            fontSize: `${settings.fontSize}px`,
            // QNBS-v3: must match the highlight overlay's editorFontFamily so glyphs align in RTL.
            fontFamily: editorFontFamily,
            lineHeight: settings.lineSpacing,
          }}
          spellCheck={false}
        />
        <div
          className={`absolute inset-0 p-4 sm:p-6 md:p-12 pt-2 leading-relaxed pointer-events-none overflow-auto max-w-3xl mx-auto transition-all duration-500 ${isFocusMode ? 'max-w-4xl pt-12' : ''} ${isHighlightPending ? 'opacity-70' : 'opacity-100'}`}
          style={editorStyles}
          aria-hidden="true"
        >
          {renderedContent}
        </div>
      </div>
      <div className="absolute bottom-4 right-6 text-xs text-[var(--sc-text-muted)] bg-[var(--sc-surface-raised)]/90 border border-[var(--sc-border-subtle)] px-3 py-1 rounded-full pointer-events-none backdrop-blur-sm shadow-sm transition-opacity duration-300">
        {activeSectionStats.wordCount} {t('common.words')}
      </div>
      {mentions.length > 0 && (mentionPosition !== null || isMobile) && (
        <div
          className={`absolute z-20 bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] shadow-2xl overflow-hidden flex flex-col ${!isMobile ? 'rounded-md w-64' : ''}`}
          style={mentionStyle}
        >
          {isMobile && (
            <div className="flex justify-center p-3 bg-[var(--sc-surface-raised)] cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-[var(--sc-border-subtle)] rounded-full" />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-2">
            <p className="text-xs font-semibold text-[var(--sc-text-muted)] px-2 mb-2 uppercase tracking-wider">
              {t('manuscript.mention.suggestions')}
            </p>
            <ul className="space-y-1">
              {mentions.map((item, index) => (
                <li
                  key={item.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleMentionSelect(item);
                  }}
                  className={`px-3 py-3 rounded-md text-sm cursor-pointer flex items-center space-x-3 transition-colors ${index === selectedMentionIndex ? 'bg-[var(--sc-accent)] text-white' : 'text-[var(--sc-text-primary)] hover:bg-[var(--sc-accent)] hover:text-white'}`}
                >
                  {item.type === 'character' ? (
                    <div
                      className={`p-1 rounded flex-shrink-0 ${index === selectedMentionIndex ? 'bg-[var(--glass-bg-hover)]' : 'bg-[var(--sc-info-bg)]'}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className={`w-4 h-4 ${index === selectedMentionIndex ? 'text-white' : 'text-[var(--sc-info-fg)]'}`}
                      >
                        {ICONS.CHARACTERS}
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={`p-1 rounded flex-shrink-0 ${index === selectedMentionIndex ? 'bg-[var(--glass-bg-hover)]' : 'bg-[var(--sc-success-bg)]'}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className={`w-4 h-4 ${index === selectedMentionIndex ? 'text-white' : 'text-[var(--sc-success-fg)]'}`}
                      >
                        {ICONS.WORLD}
                      </svg>
                    </div>
                  )}
                  <span className="font-medium truncate">{item.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {spellCheckPopover && (
        <div
          role="dialog"
          className="absolute z-50 bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] shadow-xl rounded-md p-2 animate-in fade-in zoom-in-95"
          style={{
            // QNBS-v3: clamp left so popover stays on-screen on narrow mobile viewports.
            top: Math.min(spellCheckPopover.y + 10, window.innerHeight - 100),
            left: Math.max(8, Math.min(spellCheckPopover.x - 20, window.innerWidth - 180)),
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-[var(--sc-text-muted)] mb-1 uppercase tracking-wide px-2">
            {t('manuscript.spellcheck.didYouMean')}
          </p>
          <button
            type="button"
            onClick={applyCorrection}
            className="block w-full text-left px-3 py-2 min-h-[44px] rounded hover:bg-[var(--sc-accent)] hover:text-white text-[var(--sc-text-primary)] font-medium flex items-center"
          >
            {spellCheckPopover.suggestion}
          </button>
        </div>
      )}
    </div>
  );
});
ManuscriptEditor.displayName = 'ManuscriptEditor';
