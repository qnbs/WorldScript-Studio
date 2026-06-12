import { useVirtualizer } from '@tanstack/react-virtual';
import type { FC } from 'react';
import React, { useCallback, useRef, useState } from 'react';

const LARGE_MANUSCRIPT_THRESHOLD = 500;

import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

interface NavigatorItemProps {
  section: { id: string; title: string };
  index: number;
  isActive: boolean;
  isDragging: boolean;
  isFirst: boolean;
  isLast: boolean;
  canDelete: boolean;
  onSelect: (id: string) => void;
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
    onMoveUp,
    onMoveDown,
    onDelete,
    t,
  }) => {
    // QNBS-v3: <li> removed — the virtualizer wrapper <li> in NavigatorPanel is the real list item.
    //          Rendering <li> inside a virtualizer <div> caused axe `list`+`listitem` violations.
    // QNBS-v3: Outer element is a div with role="button" to avoid nested <button> violation.
    return (
      // biome-ignore lint/a11y/useSemanticElements: intentional div+role=button to prevent nested button DOM violation; move/delete buttons must be separate interactive elements
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
        aria-label={t('outline.selectSection', { title: section.title })}
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
            <Icon name="chevron-up" size="sm" />
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
            <Icon name="chevron-down" size="sm" />
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(section.id);
              }}
              className="p-2 md:p-1 rounded-md hover:bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] focus-visible:ring-2 focus-visible:ring-[var(--sc-danger-fg)]"
              title={t('manuscript.deleteSection')}
              aria-label={t('manuscript.deleteSection')}
            >
              <Icon name="trash" size="sm" />
            </button>
          )}
          <div
            aria-hidden="true"
            className={`cursor-move p-1 ${isActive ? 'text-[var(--sc-accent)] group-hover:text-white' : 'text-[var(--sc-text-muted)] group-hover:text-[var(--sc-text-primary)]'}`}
          >
            <Icon name="grip-horizontal" size="sm" />
          </div>
        </div>
      </div>
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
              // QNBS-v3: <li> is the real list item; NavigatorItem renders a fragment to avoid <li>-in-<li>.
              //          Drag handlers live here so the <ul> only has <li> children (axe list rule).
              <li
                key={section.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
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
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onDelete={handleDeleteSection}
                  t={t}
                />
              </li>
            );
          })}
        </ul>
        <div className="p-3 border-t border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/50">
          <Button onClick={handleAddSection} variant="secondary" className="w-full justify-center">
            <Icon name="plus" size="sm" className="me-2" />
            {t('manuscript.addSection')}
          </Button>
        </div>
      </div>
    );
  },
);
StoryNavigator.displayName = 'StoryNavigator';
