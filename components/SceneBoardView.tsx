import type { Announcements, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { FC } from 'react';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../app/hooks';
import { ICONS } from '../constants';
import { SceneBoardViewContext, useSceneBoardViewContext } from '../contexts/SceneBoardViewContext';
import {
  plotBoardActions,
  selectActiveMode,
  selectSnapToGrid,
} from '../features/plotBoard/plotBoardSlice';
import { usePlotBoardAi } from '../hooks/usePlotBoardAi';
import { useSceneBoardView } from '../hooks/useSceneBoardView';
import { SceneTimelinePanel } from './SceneTimelinePanel';
import { ActSwimlane } from './scene-board/ActSwimlane';
import { EmptyState } from './ui/EmptyState';
import { Spinner } from './ui/Spinner';

const PlotCanvas = lazy(() =>
  import('./scene-board/PlotCanvas').then((m) => ({ default: m.PlotCanvas })),
);
const SubplotPanel = lazy(() =>
  import('./scene-board/SubplotPanel').then((m) => ({ default: m.SubplotPanel })),
);
const TensionCurvePanel = lazy(() =>
  import('./scene-board/TensionCurvePanel').then((m) => ({ default: m.TensionCurvePanel })),
);

const SceneBoardChunkFallback: FC = () => (
  <div className="flex items-center justify-center p-8" role="status">
    <Spinner className="w-8 h-8" />
  </div>
);

import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { SectionIcon } from './ui/SectionIcon';

// --- SUB-COMPONENTS ---

const SceneBoardUI: FC = () => {
  const {
    t,
    project,
    sections,
    characters,
    locationOptions,
    handleUpdateSection,
    handleDeleteSection,
    handleMoveSectionWithinAct,
    handleAddSection,
  } = useSceneBoardViewContext();
  const dispatch = useAppDispatch();
  // QNBS-v3: activeMode is persisted in plotBoardSlice (localStorage) instead of local state
  //          so the user's last canvas/swimlane/timeline choice survives page refresh.
  const activeMode = useAppSelectorShallow(selectActiveMode);
  const snapGrid = useAppSelectorShallow(selectSnapToGrid);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // QNBS-v3: Track hovered act column during drag for drop-zone highlight (IX-2).
  const [dragOverActId, setDragOverActId] = useState<number | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Szenen nach Akt gruppieren (Standard: Akt 1)
  const sectionsByAct = useMemo(
    () => ({
      1: sections.filter((s) => !s.act || s.act === 1),
      2: sections.filter((s) => s.act === 2),
      3: sections.filter((s) => s.act === 3),
    }),
    [sections],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setDragOverActId(null);

      if (!over || active.id === over.id) return;

      // Wenn über einer anderen Karte, in denselben Akt verschieben
      const overSection = sections.find((s) => s.id === over.id);
      const activeSection = sections.find((s) => s.id === active.id);
      if (overSection && activeSection && overSection.act !== activeSection.act) {
        handleUpdateSection(active.id as string, { act: overSection.act || 1 });
      }
    },
    [sections, handleUpdateSection],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      // Akt-Wechsel beim Darüberfahren prüfen (Container-IDs: 'act-1', 'act-2', 'act-3')
      const { over } = event;
      if (over?.id && String(over.id).startsWith('act-')) {
        const act = parseInt(String(over.id).replace('act-', ''), 10) as 1 | 2 | 3;
        setDragOverActId(act);
        const activeSection = sections.find((s) => s.id === event.active.id);
        if (activeSection && activeSection.act !== act) {
          handleUpdateSection(event.active.id as string, { act });
        }
      } else {
        setDragOverActId(null);
      }
    },
    [sections, handleUpdateSection],
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
    [handleAddSection, sections, handleUpdateSection],
  );

  const activeSection = activeId ? sections.find((s) => s.id === activeId) : null;

  // QNBS-v3: WCAG 2.1 SC 4.1.3 — screen reader announcements for drag-and-drop via dnd-kit accessibility prop.
  const dndAnnouncements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const title = sections.find((s) => s.id === active.id)?.title ?? String(active.id);
        return t('sceneboard.dnd.start', { title });
      },
      onDragOver({ active, over }) {
        const title = sections.find((s) => s.id === active.id)?.title ?? String(active.id);
        if (!over) return t('sceneboard.dnd.cancelled');
        return t('sceneboard.dnd.over', { title, act: String(over.id) });
      },
      onDragEnd({ active, over }) {
        const title = sections.find((s) => s.id === active.id)?.title ?? String(active.id);
        if (!over) return t('sceneboard.dnd.cancelled');
        return t('sceneboard.dnd.dropped', { title, act: String(over.id) });
      },
      onDragCancel() {
        return t('sceneboard.dnd.cancelled');
      },
    }),
    [sections, t],
  );

  const plotSummary = sections
    .map((s) => `${s.title}: ${(s.content ?? '').slice(0, 200)}`)
    .join('\n')
    .slice(0, 2000);
  const selectedIds = activeId ? [activeId] : sections.slice(0, 3).map((s) => s.id);
  const plotAi = usePlotBoardAi(plotSummary, selectedIds);
  const [showAiPanel, setShowAiPanel] = useState(false);

  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  const totalWords = sections.reduce((s, sec) => s + (sec.wordCount || 0), 0);

  return (
    <div className="h-full flex flex-col">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-3">
            <SectionIcon section="sceneboard" size="lg" />
            <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">
              {t('sceneboard.title')}
            </h1>
          </div>
          <p className="text-xs text-[var(--sc-text-muted)] mt-0.5">
            {sections.length} {t('sceneboard.scenes')} · {totalWords} {t('sceneboard.words')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <div
            className="flex flex-wrap items-center gap-2"
            role="tablist"
            aria-label={t('sceneboard.timeline.modeTabs')}
          >
            <Button
              type="button"
              size="sm"
              variant={activeMode === 'swimlane' ? 'primary' : 'secondary'}
              aria-pressed={activeMode === 'swimlane'}
              onClick={() => dispatch(plotBoardActions.setActiveMode('swimlane'))}
            >
              {t('sceneboard.timeline.modeBoard')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeMode === 'canvas' ? 'primary' : 'secondary'}
              aria-pressed={activeMode === 'canvas'}
              onClick={() => dispatch(plotBoardActions.setActiveMode('canvas'))}
            >
              {t('sceneboard.canvas.modeLabel')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeMode === 'timeline' ? 'primary' : 'secondary'}
              aria-pressed={activeMode === 'timeline'}
              onClick={() => dispatch(plotBoardActions.setActiveMode('timeline'))}
            >
              {t('sceneboard.timeline.modeTimeline')}
            </Button>
          </div>
          {/* QNBS-v3: Snap-to-grid toggle shown only in canvas mode */}
          {activeMode === 'canvas' && (
            <button
              type="button"
              onClick={() => dispatch(plotBoardActions.setSnapToGrid(!snapGrid))}
              className={`text-xs px-3 py-2 min-h-[44px] rounded border transition-colors ${snapGrid ? 'bg-[var(--sc-accent)]/20 border-[var(--sc-ring-focus)]/40 text-[var(--sc-ring-focus)]' : 'border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)]'}`}
              aria-pressed={snapGrid}
              title={t('sceneboard.canvas.snapToGrid')}
            >
              ⊞
            </button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setShowAiPanel(true);
              void plotAi.suggestNextBeat();
            }}
            disabled={plotAi.isLoading || sections.length === 0}
            aria-busy={plotAi.isLoading}
          >
            {plotAi.isLoading ? t('sceneboard.ai.suggesting') : t('sceneboard.ai.suggestBeat')}
          </Button>
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
      </div>

      {activeMode === 'timeline' ? (
        <SceneTimelinePanel sections={sections} t={t} />
      ) : activeMode === 'canvas' ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-1 min-h-0 gap-0 overflow-hidden rounded-t-xl border border-b-0 border-[var(--sc-border-subtle)]">
            <Suspense fallback={<SceneBoardChunkFallback />}>
              <SubplotPanel sections={sections} t={t} />
            </Suspense>
            <div className="flex-1 relative min-w-0">
              <Suspense fallback={<SceneBoardChunkFallback />}>
                <PlotCanvas
                  sections={sections}
                  characters={characters}
                  layout={project.sceneBoardLayout ?? {}}
                  t={t}
                  onEditSection={(id) => {
                    void id;
                  }}
                />
              </Suspense>
            </div>
          </div>
          <Suspense fallback={<SceneBoardChunkFallback />}>
            <TensionCurvePanel sections={sections} t={t} />
          </Suspense>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements: dndAnnouncements }}
        >
          {/* X-3: authored empty state when no scenes exist yet */}
          {sections.length === 0 && (
            <div className="flex-grow flex items-start pt-6 px-2">
              <EmptyState
                title={t('sceneboard.emptyState.title')}
                description={t('sceneboard.emptyState.description')}
                compact
              />
            </div>
          )}
          {/* Kanban-Board mit 3 Swimlanes */}
          <div className="flex gap-4 overflow-x-auto pb-4 flex-grow">
            {([1, 2, 3] as const).map((act) => (
              <ActSwimlane
                key={act}
                act={act}
                sections={sectionsByAct[act]}
                characters={characters}
                locationOptions={locationOptions}
                t={t}
                onUpdate={handleUpdateSection}
                onDelete={setDeleteTargetId}
                onAddSection={handleAddForAct}
                onReorderInAct={handleMoveSectionWithinAct}
                isOver={dragOverActId === act}
              />
            ))}
          </div>

          <DragOverlay>
            {activeSection ? (
              <div className="bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-lg p-3 shadow-2xl opacity-90 w-72">
                <h4 className="text-sm font-semibold text-[var(--sc-text-primary)]">
                  {activeSection.title}
                </h4>
                {activeSection.summary && (
                  <p className="text-xs text-[var(--sc-text-muted)] mt-1 line-clamp-2">
                    {activeSection.summary}
                  </p>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <Modal
        isOpen={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        title={t('sceneboard.ai.panelTitle')}
      >
        {plotAi.ragChunkCount > 0 && (
          <p className="text-xs text-[var(--sc-text-muted)] mb-2">
            {t('sceneboard.ai.ragChunks', { count: String(plotAi.ragChunkCount) })}
          </p>
        )}
        {plotAi.error && (
          <p className="text-sm text-red-400 mb-2" role="alert">
            {plotAi.error}
          </p>
        )}
        <ul className="space-y-3 max-h-[50vh] overflow-y-auto">
          {plotAi.beats.map((beat) => (
            <li
              key={`${beat.title}-${beat.suggestedPosition}`}
              className="p-3 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
            >
              <p className="font-semibold text-[var(--sc-text-primary)]">{beat.title}</p>
              <p className="text-sm text-[var(--sc-text-secondary)] mt-1">{beat.description}</p>
              <p className="text-xs text-[var(--sc-text-muted)] mt-2">{beat.rationale}</p>
            </li>
          ))}
          {!plotAi.isLoading && plotAi.beats.length === 0 && (
            <p className="text-sm text-[var(--sc-text-muted)]">{t('sceneboard.ai.empty')}</p>
          )}
        </ul>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => setShowAiPanel(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void plotAi.suggestNextBeat()} disabled={plotAi.isLoading}>
            {t('sceneboard.ai.retry')}
          </Button>
        </div>
      </Modal>

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
