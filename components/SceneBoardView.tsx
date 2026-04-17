import type { FC } from 'react';
import React, { useState, useCallback, useMemo } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';
import { Modal } from './ui/Modal';
import { ICONS } from '../constants';
import { useSceneBoardView } from '../hooks/useSceneBoardView';
import { SceneBoardViewContext, useSceneBoardViewContext } from '../contexts/SceneBoardViewContext';
import type { StorySection, Character } from '../types';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- Status-Farben ---
const STATUS_COLORS: Record<string, string> = {
  draft: '#6b7280',
  outline: '#f59e0b',
  'first-draft': '#3b82f6',
  revised: '#8b5cf6',
  final: '#10b981',
};

// --- Einzelne Szenen-Karte (sortierbar) ---
const SortableSceneCard: FC<{
  section: StorySection;
  characters: Character[];
  t: (key: string, replacements?: Record<string, string>) => string;
  onUpdate: (id: string, updates: Partial<StorySection>) => void;
  onDelete: (id: string) => void;
}> = React.memo(({ section, characters, t, onUpdate, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title: section.title,
    summary: section.summary || '',
    color: section.color || '#3b82f6',
    status: section.status || 'draft',
    act: section.act || 1,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleSave = () => {
    onUpdate(section.id, editData);
    setIsEditing(false);
  };

  const linkedChars = (characters || []).filter((c) => section.characterIds?.includes(c.id));
  const statusColor = STATUS_COLORS[section.status || 'draft'] || '#6b7280';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-[var(--background-secondary)] border border-[var(--border-primary)] rounded-lg p-3 mb-2 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      {...attributes}
      {...listeners}
    >
      {isEditing ? (
        <div
          role="group"
          className="space-y-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Input
            value={editData.title}
            onChange={(e) => setEditData((p) => ({ ...p, title: e.target.value }))}
            className="text-sm font-semibold"
          />
          <Textarea
            value={editData.summary}
            onChange={(e) => setEditData((p) => ({ ...p, summary: e.target.value }))}
            placeholder={t('sceneboard.summary.placeholder')}
            className="text-xs h-16 resize-none"
          />
          <div className="flex items-center gap-2">
            <Select
              value={editData.status}
              onChange={(e) =>
                setEditData((p) => ({
                  ...p,
                  status: e.target.value as
                    | 'outline'
                    | 'draft'
                    | 'first-draft'
                    | 'revised'
                    | 'final',
                }))
              }
              className="text-xs"
            >
              <option value="draft">{t('sceneboard.status.draft')}</option>
              <option value="outline">{t('sceneboard.status.outline')}</option>
              <option value="first-draft">{t('sceneboard.status.firstDraft')}</option>
              <option value="revised">{t('sceneboard.status.revised')}</option>
              <option value="final">{t('sceneboard.status.final')}</option>
            </Select>
            <Select
              value={editData.act}
              onChange={(e) =>
                setEditData((p) => ({
                  ...p,
                  act: parseInt(e.target.value) as 1 | 2 | 3,
                }))
              }
              className="text-xs"
            >
              <option value={1}>{t('sceneboard.act1')}</option>
              <option value={2}>{t('sceneboard.act2')}</option>
              <option value={3}>{t('sceneboard.act3')}</option>
            </Select>
            <input
              type="color"
              value={editData.color}
              onChange={(e) => setEditData((p) => ({ ...p, color: e.target.value }))}
              className="w-7 h-7 rounded border cursor-pointer"
            />
          </div>
          <div className="flex justify-between">
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDelete(section.id)}
            >
              {t('common.delete')}
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: section.color || '#3b82f6' }}
              />
              <h4 className="text-sm font-semibold text-[var(--foreground-primary)] line-clamp-1">
                {section.title}
              </h4>
            </div>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] p-0.5 rounded"
              aria-label={t('sceneboard.editScene', { title: section.title })}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
                />
              </svg>
            </button>
          </div>
          {section.summary && (
            <p className="text-xs text-[var(--foreground-muted)] line-clamp-2 mb-2">
              {section.summary}
            </p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-xs text-[var(--foreground-muted)] capitalize">
                {section.status || 'draft'}
              </span>
            </div>
            <span className="text-xs text-[var(--foreground-muted)]">
              {section.wordCount || 0} W.
            </span>
          </div>
          {linkedChars.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {linkedChars.slice(0, 3).map((c) => (
                <span
                  key={c.id}
                  className="text-xs bg-indigo-500/15 text-indigo-400 px-1.5 py-0.5 rounded"
                >
                  @{c.name}
                </span>
              ))}
              {linkedChars.length > 3 && (
                <span className="text-xs text-[var(--foreground-muted)]">
                  +{linkedChars.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
SortableSceneCard.displayName = 'SortableSceneCard';

// --- Swimlane-Spalte (ein Akt) ---
const ActSwimlane: FC<{
  act: 1 | 2 | 3;
  sections: StorySection[];
  characters: Character[];
  t: (key: string, replacements?: Record<string, string>) => string;
  onUpdate: (id: string, updates: Partial<StorySection>) => void;
  onDelete: (id: string) => void;
  onAddSection: (act: 1 | 2 | 3) => void;
}> = ({ act, sections, characters, t, onUpdate, onDelete, onAddSection }) => {
  const ACT_LABELS: Record<number, string> = {
    1: t('sceneboard.act1.label'),
    2: t('sceneboard.act2.label'),
    3: t('sceneboard.act3.label'),
  };
  const ACT_COLORS: Record<number, string> = {
    1: 'from-blue-500/10',
    2: 'from-purple-500/10',
    3: 'from-green-500/10',
  };

  const wordCount = sections.reduce((sum, s) => sum + (s.wordCount || 0), 0);

  return (
    <div
      className={`flex flex-col min-w-[280px] max-w-[320px] bg-gradient-to-b ${ACT_COLORS[act]} to-transparent rounded-xl border border-[var(--border-primary)] p-3`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[var(--foreground-primary)] text-sm">
            {ACT_LABELS[act]}
          </h3>
          <p className="text-xs text-[var(--foreground-muted)]">
            {sections.length} {t('sceneboard.scenes')} · {wordCount} {t('sceneboard.words')}
          </p>
        </div>
        <button
          onClick={() => onAddSection(act)}
          className="w-7 h-7 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-primary)] text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] hover:bg-[var(--background-tertiary)] flex items-center justify-center text-lg font-light"
          title={t('sceneboard.addSceneToAct')}
        >
          +
        </button>
      </div>

      <div
        className="flex-grow min-h-[200px] overflow-y-auto pr-1 space-y-0"
        role="list"
        aria-label={t('sceneboard.dragAriaLabel')}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sections.map((section) => (
            <SortableSceneCard
              key={section.id}
              section={section}
              characters={characters}
              t={t}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {sections.length === 0 && (
            <div className="text-center py-8 text-xs text-[var(--foreground-muted)] border-2 border-dashed border-[var(--border-primary)] rounded-lg">
              {t('sceneboard.dragEmptyHint')}
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const SceneBoardUI: FC = () => {
  const {
    t,
    project,
    sections,
    characters,
    handleUpdateSection,
    handleDeleteSection,
    handleAddSection,
  } = useSceneBoardViewContext();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Szenen nach Akt gruppieren (Standard: Akt 1)
  const sectionsByAct = useMemo(
    () => ({
      1: sections.filter((s) => !s.act || s.act === 1),
      2: sections.filter((s) => s.act === 2),
      3: sections.filter((s) => s.act === 3),
    }),
    [sections]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over || active.id === over.id) return;

      // Wenn über einer anderen Karte, in denselben Akt verschieben
      const overSection = sections.find((s) => s.id === over.id);
      const activeSection = sections.find((s) => s.id === active.id);
      if (overSection && activeSection && overSection.act !== activeSection.act) {
        handleUpdateSection(active.id as string, { act: overSection.act || 1 });
      }
    },
    [sections, handleUpdateSection]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      // Akt-Wechsel beim Darüberfahren prüfen (Container-IDs: 'act-1', 'act-2', 'act-3')
      const { over } = event;
      if (over?.id && String(over.id).startsWith('act-')) {
        const act = parseInt(String(over.id).replace('act-', '')) as 1 | 2 | 3;
        const activeSection = sections.find((s) => s.id === event.active.id);
        if (activeSection && activeSection.act !== act) {
          handleUpdateSection(event.active.id as string, { act });
        }
      }
    },
    [sections, handleUpdateSection]
  );

  const handleAddForAct = useCallback(
    (act: 1 | 2 | 3) => {
      handleAddSection();
      // Nach dem Hinzufügen den Akt setzen – via kurzes Timeout (nach Redux-Update)
      setTimeout(() => {
        const last = sections[sections.length - 1];
        if (last) handleUpdateSection(last.id, { act });
      }, 100);
    },
    [handleAddSection, sections, handleUpdateSection]
  );

  const activeSection = activeId ? sections.find((s) => s.id === activeId) : null;

  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  const totalWords = sections.reduce((s, sec) => s + (sec.wordCount || 0), 0);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground-primary)]">
            {t('sceneboard.title')}
          </h1>
          <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
            {sections.length} {t('sceneboard.scenes')} · {totalWords} {t('sceneboard.words')}
          </p>
        </div>
        <Button onClick={() => handleAddForAct(1)} size="sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-4 h-4 mr-1"
          >
            {ICONS.ADD}
          </svg>
          {t('sceneboard.addScene')}
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Kanban-Board mit 3 Swimlanes */}
        <div className="flex gap-4 overflow-x-auto pb-4 flex-grow">
          {([1, 2, 3] as const).map((act) => (
            <ActSwimlane
              key={act}
              act={act}
              sections={sectionsByAct[act]}
              characters={characters}
              t={t}
              onUpdate={handleUpdateSection}
              onDelete={setDeleteTargetId}
              onAddSection={handleAddForAct}
            />
          ))}
        </div>

        <DragOverlay>
          {activeSection ? (
            <div className="bg-[var(--background-secondary)] border border-[var(--border-primary)] rounded-lg p-3 shadow-2xl opacity-90 w-72">
              <h4 className="text-sm font-semibold text-[var(--foreground-primary)]">
                {activeSection.title}
              </h4>
              {activeSection.summary && (
                <p className="text-xs text-[var(--foreground-muted)] mt-1 line-clamp-2">
                  {activeSection.summary}
                </p>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title={t('sceneboard.confirmDelete')}
      >
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setDeleteTargetId(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (deleteTargetId) handleDeleteSection(deleteTargetId);
              setDeleteTargetId(null);
            }}
          >
            {t('common.delete')}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export const SceneBoardView: FC = () => {
  const contextValue = useSceneBoardView();
  return (
    <SceneBoardViewContext.Provider value={contextValue}>
      <SceneBoardUI />
    </SceneBoardViewContext.Provider>
  );
};
