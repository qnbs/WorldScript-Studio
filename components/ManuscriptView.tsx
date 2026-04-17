import type { FC, ReactNode } from 'react';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader } from './ui/Card';
import { ICONS } from '../constants';
import { Button } from './ui/Button';
import { Drawer } from './ui/Drawer';
import { Modal } from './ui/Modal';
import { Spinner } from './ui/Spinner';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { DebouncedInput } from './ui/DebouncedInput';
import { projectActions } from '../features/project/projectSlice';
import { useManuscriptView } from '../hooks/useManuscriptView';
import { ManuscriptViewContext, useManuscriptViewContext } from '../contexts/ManuscriptViewContext';
import { Textarea } from './ui/Textarea';
import { useAppSelector } from '../app/hooks';
import { useTranslation } from '../hooks/useTranslation';

// --- Custom Hook for Resizable Panels ---
const throttle = <A extends readonly unknown[]>(fn: (...args: A) => void, delay = 16) => {
  let lastCall = 0;
  return ((...args: A) => {
    const now = performance.now();
    if (now - lastCall < delay) return;
    lastCall = now;
    fn(...args);
  }) as typeof fn;
};

const useResizablePanels = (initialLeft = 20, initialRight = 20) => {
  const [leftPanelWidth, setLeftPanelWidth] = useState(initialLeft);
  const [rightPanelWidth, setRightPanelWidth] = useState(initialRight);
  const [activeResize, setActiveResize] = useState<'left' | 'right' | null>(null);
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);

  const handleLeftResize = useCallback((e: MouseEvent) => {
    if (!isResizingLeft.current) return;
    const newWidth = (e.clientX / window.innerWidth) * 100;
    if (newWidth > 15 && newWidth < 50) {
      setLeftPanelWidth(newWidth);
    }
  }, []);

  const handleRightResize = useCallback((e: MouseEvent) => {
    if (!isResizingRight.current) return;
    const newWidth = ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
    if (newWidth > 15 && newWidth < 50) {
      setRightPanelWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizingLeft.current = false;
    isResizingRight.current = false;
    setActiveResize(null);
    document.body.style.cursor = 'default';
  }, []);

  const startLeftResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingLeft.current = true;
    isResizingRight.current = false;
    setActiveResize('left');
    document.body.style.cursor = 'col-resize';
  }, []);

  const startRightResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRight.current = true;
    isResizingLeft.current = false;
    setActiveResize('right');
    document.body.style.cursor = 'col-resize';
  }, []);

  // Effect-managed resize listeners ensure cleanup on unmount and avoid stale
  // callback references that could leak when the component is removed.
  // Test hint: verify mousemove/mouseup listeners are removed on unmount,
  // and that AbortController is used to cancel outstanding listener registration.
  useEffect(() => {
    const controller = new AbortController();

    if (!activeResize) {
      return () => {
        controller.abort();
      };
    }

    const handleMove = (e: MouseEvent) => {
      if (activeResize === 'left') {
        handleLeftResize(e);
      }
      if (activeResize === 'right') {
        handleRightResize(e);
      }
    };

    const throttledMove = throttle(handleMove, 16);

    window.addEventListener('mousemove', throttledMove, { signal: controller.signal });
    window.addEventListener('mouseup', stopResizing, { signal: controller.signal });

    return () => {
      window.removeEventListener('mousemove', throttledMove);
      window.removeEventListener('mouseup', stopResizing);
      controller.abort();
    };
  }, [activeResize, handleLeftResize, handleRightResize, stopResizing]);

  return {
    leftPanelWidth,
    rightPanelWidth,
    startLeftResize,
    startRightResize,
    setLeftPanelWidth,
    setRightPanelWidth,
  };
};

// --- Resizer Component ---
interface ResizerProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onKeyAdjust: (delta: number) => void;
  label: string;
}
const Resizer: FC<ResizerProps> = React.memo(({ onMouseDown, onKeyAdjust, label }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onKeyAdjust(-2);
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onKeyAdjust(2);
    }
  };
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={handleKeyDown}
      className="w-2 h-full cursor-col-resize flex items-center justify-center group -ml-1 z-10 hover:scale-x-110 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div
        className="w-0.5 h-8 bg-[var(--border-primary)] group-hover:bg-indigo-400 group-hover:h-full transition-all duration-300 rounded-full"
        aria-hidden="true"
      />
    </div>
  );
});
Resizer.displayName = 'Resizer';

// --- SUB-COMPONENTS ---

// Memoized Item Component for Performance
interface NavigatorItemProps {
  section: { id: string; title: string };
  index: number;
  isActive: boolean;
  isDragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onDelete: (id: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

const NavigatorItem: FC<NavigatorItemProps> = React.memo(
  ({
    section,
    index,
    isActive,
    isDragging,
    isFirst,
    isLast,
    canDelete,
    onSelect,
    onDragStart,
    onDragEnter,
    onDragEnd,
    onMoveUp,
    onMoveDown,
    onDelete,
    t,
  }) => {
    return (
      <div
        role="listitem"
        draggable
        onDragStart={() => onDragStart(index)}
        onDragEnter={() => onDragEnter(index)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => e.preventDefault()}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect(section.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(section.id);
            }
          }}
          className={`group rounded-md cursor-pointer p-2 flex items-center justify-between text-left transition-all duration-200 w-full ${isActive ? 'bg-[var(--nav-background-active)] text-[var(--nav-text-active)]' : 'hover:bg-[var(--nav-background-hover)] text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)]'} ${isDragging ? 'opacity-60 scale-[1.02] shadow-2xl shadow-indigo-500/50' : ''}`}
        >
          <span className="font-medium text-sm flex-grow truncate mr-2">{section.title}</span>
          <div className="flex-shrink-0 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(index);
              }}
              disabled={isFirst}
              className="p-1 rounded-md hover:bg-[var(--background-secondary)] disabled:opacity-20 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
              title={t('common.moveUp')}
              aria-label={t('outline.moveUp', { title: section.title })}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(index);
              }}
              disabled={isLast}
              className="p-1 rounded-md hover:bg-[var(--background-secondary)] disabled:opacity-20 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
              title={t('common.moveDown')}
              aria-label={t('outline.moveDown', { title: section.title })}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            {canDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(section.id);
                }}
                className="p-1 rounded-md hover:bg-red-500/20 text-red-400 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-red-500"
                title={t('manuscript.deleteSection')}
                aria-label={t('manuscript.deleteSection')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            )}
            <div
              aria-hidden="true"
              className={`cursor-move p-1 ${isActive ? 'text-indigo-200 group-hover:text-white' : 'text-[var(--foreground-muted)] group-hover:text-[var(--foreground-primary)]'}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-4 h-4 "
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 9h16.5m-16.5 6.25h16.5"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
NavigatorItem.displayName = 'NavigatorItem';

const StoryNavigator: FC<{ onSectionSelect?: () => void }> = React.memo(({ onSectionSelect }) => {
  const {
    t,
    manuscript,
    activeSectionId,
    setActiveSectionId,
    draggedItem,
    dragOverItem,
    handleDragSort,
    handleMoveSection,
    draggingIndex,
    setDraggingIndex,
    handleAddSection,
    handleDeleteSection,
  } = useManuscriptViewContext();

  const handleSelect = useCallback(
    (id: string) => {
      setActiveSectionId(id);
      onSectionSelect?.();
    },
    [setActiveSectionId, onSectionSelect]
  );

  const handleDragStart = useCallback(
    (index: number) => {
      draggedItem.current = index;
      setDraggingIndex(index);
    },
    [setDraggingIndex, draggedItem]
  );

  const handleDragEnter = useCallback(
    (index: number) => {
      dragOverItem.current = index;
    },
    [dragOverItem]
  );

  const handleDragEnd = useCallback(() => {
    handleDragSort();
    setDraggingIndex(null);
  }, [handleDragSort, setDraggingIndex]);

  const handleMoveUp = useCallback(
    (index: number) => {
      handleMoveSection(index, 'up');
    },
    [handleMoveSection]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      handleMoveSection(index, 'down');
    },
    [handleMoveSection]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow space-y-1 overflow-y-auto p-2 no-scrollbar">
        {(Array.isArray(manuscript) ? manuscript : []).map((section, index) => (
          <NavigatorItem
            key={section.id}
            section={section}
            index={index}
            isActive={activeSectionId === section.id}
            isDragging={draggingIndex === index}
            isFirst={index === 0}
            isLast={index === manuscript.length - 1}
            canDelete={manuscript.length > 1}
            onSelect={handleSelect}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onDelete={handleDeleteSection}
            t={t}
          />
        ))}
      </div>
      <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--background-secondary)]/50">
        <Button
          onClick={handleAddSection}
          variant="secondary"
          size="sm"
          className="w-full justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-4 h-4 mr-2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('manuscript.addSection')}
        </Button>
      </div>
    </div>
  );
});
StoryNavigator.displayName = 'StoryNavigator';

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

const ManuscriptEditor: FC<{ isFocusMode: boolean }> = React.memo(({ isFocusMode }) => {
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
  const { language } = useTranslation();
  const [spellCheckPopover, setSpellCheckPopover] = useState<{
    x: number;
    y: number;
    word: string;
    suggestion: string;
  } | null>(null);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);

  const editorStyles: React.CSSProperties = {
    fontFamily: settings.editorFont,
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineSpacing,
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
  };

  // Determine active dictionary based on language
  const currentTypos = language === 'de' ? TYPOS_DE : TYPOS_EN;

  const handleSpellErrorClick = useCallback(
    (e: React.MouseEvent, word: string) => {
      e.stopPropagation();
      const suggestion = currentTypos[word.toLowerCase()] || '';
      if (suggestion) {
        setSpellCheckPopover({
          x: e.clientX,
          y: e.clientY,
          word,
          suggestion,
        });
      }
    },
    [currentTypos]
  );

  const applyCorrection = () => {
    if (spellCheckPopover && activeSection) {
      // Case-insensitive regex replacement for the specific word bound by whitespace/punctuation logic
      const regex = new RegExp(`\\b${spellCheckPopover.word}\\b`);
      const newContent = activeSection.content.replace(regex, spellCheckPopover.suggestion);
      handleContentChange(activeSection.id, newContent);
      setSpellCheckPopover(null);
    }
  };

  // Close popover when clicking elsewhere
  useEffect(() => {
    const closePopover = () => setSpellCheckPopover(null);
    window.addEventListener('click', closePopover);
    return () => window.removeEventListener('click', closePopover);
  }, []);

  // Reset mention selection index when suggestions change
  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [mentions]);

  // Keyboard handling for mention popup navigation
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
        if (selectedMention) {
          handleMentionSelect(selectedMention);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // We need a way to clear mentions from parent, passing empty list for now is handled by parent state
        handleContentChange(activeSection?.id || '', activeSection?.content || ''); // This triggers a re-eval and clears mentions
      }
    }
  };

  // Memoize the parsed content to prevent recalculation on every render/keystroke
  const renderedContent = useMemo(() => {
    if (!activeSection?.content) return '';

    const text = activeSection.content;
    const characterMap = new Map(characters.map((c) => [c.name.toLowerCase(), c]));
    const worldMap = new Map(worlds.map((w) => [w.name.toLowerCase(), w]));

    const parts: ReactNode[] = [];

    let lastIndex = 0;
    // Regex matching: Mentions (@Word, #Word) OR Words (for spellcheck)
    const regex = /([@#][\w\s]+?)(?=[.,:;!?\s]|$)|(\b[\w\u00C0-\u017F']+\b)/g;

    text.replace(regex, (match, mention, word, offset) => {
      // Push any text between matches (whitespace, punctuation)
      if (offset > lastIndex) {
        parts.push(text.substring(lastIndex, offset));
      }

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
            </span>
          );
        } else {
          parts.push(mention);
        }
      } else if (word) {
        const lowerWord = word.toLowerCase();
        if (Object.hasOwn(currentTypos, lowerWord)) {
          parts.push(
            <span
              key={offset}
              role="button"
              tabIndex={0}
              className="spell-error"
              onClick={(e) => handleSpellErrorClick(e, word)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSpellErrorClick(e as unknown as React.MouseEvent<HTMLSpanElement>, word);
                }
              }}
            >
              {word}
            </span>
          );
        } else {
          parts.push(word);
        }
      }

      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return <>{parts}</>;
  }, [activeSection?.content, characters, worlds, currentTypos, handleSpellErrorClick]);

  if (!activeSection) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center text-[var(--foreground-muted)] p-4">
        <p>{t('manuscript.select')}</p>
      </div>
    );
  }

  // Handle mobile specific logic for mentions (docking to bottom as sheet)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const mentionStyle: React.CSSProperties = isMobile
    ? {
        bottom: '0',
        left: '0',
        right: '0',
        width: '100%',
        maxHeight: '50vh',
        borderTop: '1px solid var(--border-primary)',
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
          className="text-2xl sm:text-3xl font-bold bg-transparent border-0 px-0 h-auto text-[var(--foreground-primary)] placeholder:text-[var(--foreground-muted)] focus:ring-0"
          placeholder={t('manuscript.titlePlaceholder')}
        />
      </div>
      <div className="relative flex-grow">
        <Textarea
          ref={editorRef}
          value={activeSection.content}
          onChange={(e) => handleContentChange(activeSection.id, e.target.value)}
          onSelect={handleSelectionEvents} // Trigger mention check on select
          onKeyUp={handleSelectionEvents} // and keyup
          onClick={handleSelectionEvents} // and click
          onKeyDown={handleKeyDown} // Intercept keys for mention nav
          className={`h-full w-full leading-relaxed resize-none p-4 sm:p-6 md:p-12 pt-2 bg-transparent border-0 focus:ring-0 flex-grow caret-[var(--foreground-primary)] text-transparent max-w-3xl mx-auto selection:bg-indigo-500/30 transition-all duration-500 ${isFocusMode ? 'max-w-4xl pt-12' : ''}`}
          placeholder={
            activeSection.prompt ||
            t('manuscript.contentPlaceholder', { title: activeSection.title })
          }
          style={{
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.editorFont,
            lineHeight: settings.lineSpacing,
          }}
          spellCheck={false} // We are implementing our own simple highlight
        />
        <div
          className={`absolute inset-0 p-4 sm:p-6 md:p-12 pt-2 leading-relaxed pointer-events-none overflow-auto max-w-3xl mx-auto transition-all duration-500 ${isFocusMode ? 'max-w-4xl pt-12' : ''}`}
          style={editorStyles}
          aria-hidden="true"
        >
          {renderedContent}
        </div>
      </div>
      <div className="absolute bottom-4 right-6 text-xs text-[var(--foreground-muted)] bg-[var(--background-secondary)]/90 border border-[var(--border-primary)] px-3 py-1 rounded-full pointer-events-none backdrop-blur-sm shadow-sm transition-opacity duration-300">
        {activeSectionStats.wordCount} {t('common.words')}
      </div>
      {mentions.length > 0 && (mentionPosition !== null || isMobile) && (
        <div
          className={`absolute z-20 bg-[var(--background-secondary)] border border-[var(--border-primary)] shadow-2xl overflow-hidden flex flex-col ${!isMobile ? 'rounded-md w-64' : ''}`}
          style={mentionStyle}
        >
          {isMobile && (
            <div className="flex justify-center p-3 bg-[var(--background-secondary)] cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1.5 bg-[var(--border-primary)] rounded-full"></div>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-2">
            <p className="text-xs font-semibold text-[var(--foreground-muted)] px-2 mb-2 uppercase tracking-wider">
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
                  className={`px-3 py-3 rounded-md text-sm cursor-pointer flex items-center space-x-3 transition-colors ${index === selectedMentionIndex ? 'bg-[var(--background-interactive)] text-white' : 'text-[var(--foreground-primary)] hover:bg-[var(--background-interactive)] hover:text-white'}`}
                >
                  {item.type === 'character' ? (
                    <div
                      className={`p-1 rounded flex-shrink-0 ${index === selectedMentionIndex ? 'bg-[var(--glass-bg-hover)]' : 'bg-blue-500/20'}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className={`w-4 h-4 ${index === selectedMentionIndex ? 'text-white' : 'text-blue-400'}`}
                      >
                        {ICONS.CHARACTERS}
                      </svg>
                    </div>
                  ) : (
                    <div
                      className={`p-1 rounded flex-shrink-0 ${index === selectedMentionIndex ? 'bg-[var(--glass-bg-hover)]' : 'bg-emerald-500/20'}`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className={`w-4 h-4 ${index === selectedMentionIndex ? 'text-white' : 'text-emerald-400'}`}
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
      {/* Spell Check Popover */}
      {spellCheckPopover && (
        <div
          role="dialog"
          className="absolute z-50 bg-[var(--background-secondary)] border border-[var(--border-primary)] shadow-xl rounded-md p-2 animate-in fade-in zoom-in-95"
          style={{
            top: spellCheckPopover.y + 10,
            left: spellCheckPopover.x - 20,
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-[var(--foreground-muted)] mb-1 uppercase tracking-wide px-2">
            Did you mean?
          </p>
          <button
            onClick={applyCorrection}
            className="block w-full text-left px-3 py-1.5 rounded hover:bg-[var(--background-interactive)] hover:text-white text-[var(--foreground-primary)] font-medium"
          >
            {spellCheckPopover.suggestion}
          </button>
        </div>
      )}
    </div>
  );
});
ManuscriptEditor.displayName = 'ManuscriptEditor';

const InspectorPanel: FC = React.memo(() => {
  const {
    t,
    project,
    dispatch,
    activeSectionStats,
    isLoglineModalOpen,
    setIsLoglineModalOpen,
    loglineSuggestions,
    isAiLoading,
    handleGenerateLoglines,
    selectLogline,
    isProofreading,
    handleProofread,
    proofreadSuggestions,
    applyProofreadSuggestion,
  } = useManuscriptViewContext();
  return (
    <>
      <div className="space-y-4 p-4">
        <div>
          <label
            htmlFor="projectTitle"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('dashboard.details.projectTitle')}
          </label>
          <DebouncedInput
            id="projectTitle"
            value={project.title}
            onDebouncedChange={(value) => dispatch(projectActions.updateTitle(value))}
            placeholder={t('dashboard.details.projectTitlePlaceholder')}
          />
        </div>
        <div>
          <label
            htmlFor="projectLogline"
            className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
          >
            {t('dashboard.details.logline')}
          </label>
          <DebouncedTextarea
            id="projectLogline"
            value={project.logline}
            onDebouncedChange={(value) => dispatch(projectActions.updateLogline(value))}
            placeholder={t('dashboard.details.loglinePlaceholder')}
            rows={3}
          />
          <Button
            onClick={handleGenerateLoglines}
            disabled={isAiLoading}
            variant="ghost"
            className="text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 dark:hover:bg-indigo-900/80 mt-2 p-2 w-full justify-start"
          >
            {isAiLoading ? (
              <Spinner className="mr-2" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 mr-2"
                aria-hidden="true"
              >
                {ICONS.SPARKLES}
              </svg>
            )}
            {t('dashboard.details.aiLoglineButton')}
          </Button>
        </div>
        <Card>
          <CardHeader className="flex justify-between items-center">
            <h3 className="text-base font-semibold">{t('manuscript.inspector.statsTitle')}</h3>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="flex justify-between border-b border-[var(--border-primary)]/50 pb-2">
              <span>{t('dashboard.stats.totalWordCount')}</span>
              <span className="font-bold">{activeSectionStats.wordCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-[var(--border-primary)]/50 pb-2">
              <span>{t('manuscript.inspector.charCount')}</span>
              <span className="font-bold">{activeSectionStats.charCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('manuscript.inspector.readTime')}</span>
              <span className="font-bold">
                {t('manuscript.inspector.readTimeValue', {
                  time: String(activeSectionStats.readTime),
                })}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex justify-between items-center pb-2">
            <h3 className="text-base font-semibold">AI Proofreader</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleProofread} disabled={isProofreading} className="w-full">
              {isProofreading ? (
                <Spinner />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
              Check Grammar & Style
            </Button>
            {proofreadSuggestions.length > 0 && (
              <div className="space-y-2 mt-4 max-h-60 overflow-y-auto pr-1">
                {proofreadSuggestions.map((suggestion, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-[var(--background-secondary)] rounded-md border border-[var(--border-primary)] text-sm"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-red-400 line-through mr-2 opacity-70">
                        {suggestion.original}
                      </span>
                      <span className="text-green-400 font-semibold">{suggestion.suggestion}</span>
                    </div>
                    <p className="text-[var(--foreground-muted)] text-xs mb-2">
                      {suggestion.explanation}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => applyProofreadSuggestion(idx)}
                      className="w-full text-xs h-7"
                    >
                      Apply Fix
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Modal
        isOpen={isLoglineModalOpen}
        onClose={() => setIsLoglineModalOpen(false)}
        title={t('dashboard.loglineModal.title')}
      >
        {isAiLoading && (
          <div className="flex flex-col items-center justify-center min-h-[200px]">
            <Spinner className="w-8 h-8" />
            <p className="mt-4 text-[var(--foreground-secondary)]">
              {t('dashboard.loglineModal.loading')}
            </p>
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length > 0 && (
          <div className="space-y-3">
            {loglineSuggestions.map((line, idx) => (
              <Card
                as="button"
                key={idx}
                className="hover:bg-[var(--background-tertiary)] transition-colors cursor-pointer w-full text-left"
                onClick={() => selectLogline(line)}
              >
                <CardContent className="p-4">
                  <p className="text-[var(--foreground-secondary)]">{line}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length === 0 && (
          <div className="text-center text-red-400 min-h-[200px] flex items-center justify-center">
            <p>{t('outline.error.generationFailed')}</p>
          </div>
        )}
      </Modal>
    </>
  );
});
InspectorPanel.displayName = 'InspectorPanel';

const ManuscriptViewUI: FC = () => {
  const { project, activeSection, t } = useManuscriptViewContext();
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isInspectorDrawerOpen, setIsInspectorDrawerOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const {
    leftPanelWidth,
    rightPanelWidth,
    startLeftResize,
    startRightResize,
    setLeftPanelWidth,
    setRightPanelWidth,
  } = useResizablePanels(20, 20);

  if (!project) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Mobile Header */}
      <header className="md:hidden flex-shrink-0 flex justify-between items-center p-2 mb-2 bg-[var(--background-secondary)]/80 backdrop-blur-md border-b border-[var(--border-primary)] sticky top-0 z-20">
        <Button
          variant="ghost"
          onClick={() => setIsNavDrawerOpen(true)}
          size="sm"
          className="-ml-1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </Button>
        <h1 className="text-sm font-bold truncate px-2 text-center flex-grow text-[var(--foreground-primary)]">
          {activeSection?.title || project.title}
        </h1>
        <Button
          variant="ghost"
          onClick={() => setIsInspectorDrawerOpen(true)}
          size="sm"
          className="-mr-1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
            />
          </svg>
        </Button>
      </header>

      {/* Desktop Toolbar - Focus Toggle */}
      <div className="hidden md:flex justify-end px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsFocusMode(!isFocusMode)}
          className={`transition-colors ${isFocusMode ? 'text-[var(--background-interactive)] bg-[var(--background-interactive)]/10' : 'text-[var(--foreground-muted)]'}`}
          title={isFocusMode ? 'Exit Zen Mode' : 'Enter Zen Mode'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 mr-2"
          >
            {isFocusMode ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
              />
            )}
          </svg>
          {isFocusMode ? 'Exit Zen Mode' : 'Zen Mode'}
        </Button>
      </div>

      {/* Main Content Area */}
      <main className="flex-grow min-h-0 hidden md:flex md:flex-row relative">
        {/* Desktop Navigator */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-r border-[var(--border-primary)]'}`}
          style={{ width: isFocusMode ? 0 : `${leftPanelWidth}%` }}
        >
          <Card className="h-full flex flex-col rounded-none border-0 shadow-none">
            <CardHeader className="py-3 min-h-[50px]">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--foreground-muted)]">
                {t('manuscript.navigator.title')}
              </h2>
            </CardHeader>
            <div className="flex-grow overflow-y-auto">
              <StoryNavigator />
            </div>
          </Card>
        </div>

        {!isFocusMode && (
          <Resizer
            onMouseDown={startLeftResize}
            onKeyAdjust={(delta) => setLeftPanelWidth((w) => Math.max(15, Math.min(50, w + delta)))}
            label="Linkes Panel anpassen"
          />
        )}

        {/* Editor */}
        <Card
          className={`h-full flex-grow p-0 rounded-none border-0 shadow-none z-0 bg-[var(--background-primary)] transition-all duration-500`}
        >
          <ManuscriptEditor isFocusMode={isFocusMode} />
        </Card>

        {!isFocusMode && (
          <Resizer
            onMouseDown={startRightResize}
            onKeyAdjust={(delta) =>
              setRightPanelWidth((w) => Math.max(15, Math.min(50, w + delta)))
            }
            label="Rechtes Panel anpassen"
          />
        )}

        {/* Desktop Inspector */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-l border-[var(--border-primary)]'}`}
          style={{ width: isFocusMode ? 0 : `${rightPanelWidth}%` }}
        >
          <Card className="h-full flex flex-col rounded-none border-0 shadow-none">
            <CardHeader className="py-3 min-h-[50px]">
              <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--foreground-muted)]">
                {t('manuscript.inspector.title')}
              </h2>
            </CardHeader>
            <div className="flex-grow overflow-y-auto">
              <InspectorPanel />
            </div>
          </Card>
        </div>
      </main>

      {/* Mobile Editor (takes full space) */}
      <main className="flex-grow min-h-0 md:hidden bg-[var(--background-secondary)] overflow-hidden relative">
        <ManuscriptEditor isFocusMode={false} />
      </main>

      {/* Mobile Drawers */}
      <Drawer
        isOpen={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        title={t('manuscript.navigator.title')}
        position="left"
      >
        <StoryNavigator onSectionSelect={() => setIsNavDrawerOpen(false)} />
      </Drawer>
      <Drawer
        isOpen={isInspectorDrawerOpen}
        onClose={() => setIsInspectorDrawerOpen(false)}
        title={t('manuscript.inspector.title')}
        position="right"
      >
        <InspectorPanel />
      </Drawer>
    </div>
  );
};

export const ManuscriptView: React.FC = () => {
  // The useManuscriptView hook requires an onNavigate prop. Since this view does not navigate, passing an empty function.
  const contextValue = useManuscriptView({ onNavigate: () => {} });
  return (
    <ManuscriptViewContext.Provider value={contextValue}>
      <ManuscriptViewUI />
    </ManuscriptViewContext.Provider>
  );
};
