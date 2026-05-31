import { useVirtualizer } from '@tanstack/react-virtual';
import type { FC } from 'react';
import React, { useCallback, useRef, useState } from 'react';

const LARGE_MANUSCRIPT_THRESHOLD = 500;

import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import { Button } from '../ui/Button';

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
      <li
        draggable
        onDragStart={() => onDragStart(index)}
        onDragEnter={() => onDragEnter(index)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => e.preventDefault()}
      >
        <button
          type="button"
          onClick={() => onSelect(section.id)}
          className={`group relative rounded-md cursor-pointer py-1.5 pr-2 min-h-[44px] md:min-h-0 flex items-center justify-between text-left transition-all duration-200 w-full before:absolute before:left-0 before:inset-y-1 before:w-0.5 before:rounded-full before:bg-[var(--sc-accent)] before:transition-opacity before:duration-200 ${isActive ? 'pl-3 bg-[var(--nav-background-active)] text-[var(--nav-text-active)] before:opacity-100' : 'pl-2 hover:bg-[var(--nav-background-hover)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] before:opacity-0'} ${isDragging ? 'opacity-60 scale-[1.02] shadow-sc-xl' : ''}`}
        >
          <span
            className={`text-sm flex-grow truncate mr-2 ${isActive ? 'font-semibold tracking-tight' : 'font-medium'}`}
          >
            {section.title}
          </span>
          {/* QNBS-v3: Always visible on touch devices (no hover); hidden until hover on pointer devices. */}
          <div className="flex-shrink-0 flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(index);
              }}
              disabled={isFirst}
              className="p-2 md:p-1 rounded-md hover:bg-[var(--sc-surface-raised)] disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-indigo-500"
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
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(index);
              }}
              disabled={isLast}
              className="p-2 md:p-1 rounded-md hover:bg-[var(--sc-surface-raised)] disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(section.id);
                }}
                className="p-2 md:p-1 rounded-md hover:bg-red-500/20 text-red-400 focus-visible:ring-2 focus-visible:ring-red-500"
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
              className={`cursor-move p-1 ${isActive ? 'text-indigo-200 group-hover:text-white' : 'text-[var(--sc-text-muted)] group-hover:text-[var(--sc-text-primary)]'}`}
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
                  d="M3.75 9h16.5m-16.5 6.25h16.5"
                />
              </svg>
            </div>
          </div>
        </button>
      </li>
    );
  },
);
NavigatorItem.displayName = 'NavigatorItem';

export const StoryNavigator: FC<{ onSectionSelect?: () => void }> = React.memo(
  ({ onSectionSelect }) => {
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
      [setActiveSectionId, onSectionSelect],
    );

    const handleDragStart = useCallback(
      (index: number) => {
        draggedItem.current = index;
        setDraggingIndex(index);
      },
      [setDraggingIndex, draggedItem],
    );

    const handleDragEnter = useCallback(
      (index: number) => {
        dragOverItem.current = index;
      },
      [dragOverItem],
    );

    const handleDragEnd = useCallback(() => {
      handleDragSort();
      setDraggingIndex(null);
    }, [handleDragSort, setDraggingIndex]);

    const handleMoveUp = useCallback(
      (index: number) => {
        handleMoveSection(index, 'up');
      },
      [handleMoveSection],
    );

    const handleMoveDown = useCallback(
      (index: number) => {
        handleMoveSection(index, 'down');
      },
      [handleMoveSection],
    );

    // QNBS-v3: Virtual scrolling via @tanstack/react-virtual — renders only visible items; critical for manuscripts with 100+ sections.
    const sections = Array.isArray(manuscript) ? manuscript : [];
    const scrollRef = useRef<HTMLUListElement>(null);
    const [isLargeNoticeVisible, setIsLargeNoticeVisible] = useState(true);
    const isLargeManuscript = sections.length >= LARGE_MANUSCRIPT_THRESHOLD;
    const virtualizer = useVirtualizer({
      count: sections.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => 40,
      overscan: 3,
    });

    return (
      <div className="flex flex-col h-full">
        {isLargeManuscript && isLargeNoticeVisible && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--sc-surface-raised)] border-b border-[var(--sc-border-subtle)] text-xs text-[var(--sc-text-muted)]">
            <span className="flex-1">
              {t('manuscript.navigator.largeManuscript', { count: String(sections.length) })}
            </span>
            <button
              type="button"
              onClick={() => setIsLargeNoticeVisible(false)}
              aria-label={t('manuscript.navigator.largeManuscriptDismiss')}
              className="shrink-0 hover:text-[var(--sc-text-primary)] transition-colors"
            >
              ×
            </button>
          </div>
        )}
        <ul
          ref={scrollRef}
          className="flex-grow overflow-y-auto p-2 no-scrollbar list-none"
          style={{ position: 'relative' }}
        >
          <li
            style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            aria-hidden="true"
          />
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const section = sections[virtualRow.index];
            if (!section) return null;
            const index = virtualRow.index;
            return (
              // QNBS-v3: div wrapper avoids <li> inside <li> (axe listitem violation) — NavigatorItem renders its own <li>
              <div
                key={section.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                data-index={index}
                ref={virtualizer.measureElement}
              >
                <NavigatorItem
                  section={section}
                  index={index}
                  isActive={activeSectionId === section.id}
                  isDragging={draggingIndex === index}
                  isFirst={index === 0}
                  isLast={index === sections.length - 1}
                  canDelete={sections.length > 1}
                  onSelect={handleSelect}
                  onDragStart={handleDragStart}
                  onDragEnter={handleDragEnter}
                  onDragEnd={handleDragEnd}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onDelete={handleDeleteSection}
                  t={t}
                />
              </div>
            );
          })}
        </ul>
        <div className="p-3 border-t border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/50">
          <Button onClick={handleAddSection} variant="secondary" className="w-full justify-center">
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
  },
);
StoryNavigator.displayName = 'StoryNavigator';
