import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { FC } from 'react';
import type { Character, StorySection } from '../../types';
import { SceneCard } from './SceneCard';

interface ActSwimlaneProps {
  act: 1 | 2 | 3;
  sections: StorySection[];
  characters: Character[];
  locationOptions: { id: string; label: string }[];
  t: (key: string, replacements?: Record<string, string>) => string;
  onUpdate: (id: string, updates: Partial<StorySection>) => void;
  onDelete: (id: string) => void;
  onAddSection: (act: 1 | 2 | 3) => void;
  onReorderInAct: (id: string, direction: 'up' | 'down') => void;
  isOver?: boolean;
}

const ACT_GRADIENT_CLASSES: Record<number, string> = {
  1: 'from-blue-500/10',
  2: 'from-purple-500/10',
  3: 'from-green-500/10',
};

export const ActSwimlane: FC<ActSwimlaneProps> = ({
  act,
  sections,
  characters,
  locationOptions,
  t,
  onUpdate,
  onDelete,
  onAddSection,
  onReorderInAct,
  isOver = false,
}) => {
  const actLabels: Record<number, string> = {
    1: t('sceneboard.act1.label'),
    2: t('sceneboard.act2.label'),
    3: t('sceneboard.act3.label'),
  };

  const wordCount = sections.reduce((sum, s) => sum + (s.wordCount || 0), 0);

  // QNBS-v3: register the lane as an explicit droppable with a stable `act-N` id so dropping a
  // scene into an EMPTY swimlane (where there are no card droppables) commits the act change, and
  // so the drag-over highlight has a target. Without this the `act-*` branches in SceneBoardView's
  // drag handlers are unreachable.
  const { setNodeRef } = useDroppable({ id: `act-${act}` });

  return (
    <div
      className={`flex flex-col min-w-[280px] max-w-[320px] bg-gradient-to-b ${ACT_GRADIENT_CLASSES[act]} to-transparent rounded-xl border p-3 transition-colors duration-sc-fast ${isOver ? 'border-[var(--sc-border-focus)] bg-[var(--sc-accent-subtle)]' : 'border-[var(--sc-border-subtle)]'}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[var(--sc-text-primary)] text-sm">{actLabels[act]}</h3>
          <p className="text-xs text-[var(--sc-text-muted)]">
            {sections.length} {t('sceneboard.scenes')} · {wordCount} {t('sceneboard.words')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAddSection(act)}
          className="w-7 h-7 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] hover:bg-[var(--sc-surface-overlay)] flex items-center justify-center text-lg font-light"
          title={t('sceneboard.addSceneToAct')}
          aria-label={t('sceneboard.addSceneToAct')}
        >
          +
        </button>
      </div>

      <ul
        ref={setNodeRef}
        className="flex-grow min-h-[200px] overflow-y-auto pr-1 space-y-0 list-none"
        aria-label={t('sceneboard.dragAriaLabel')}
      >
        {/* QNBS-v3: <ul> must only contain <li> children (axe list rule); each SceneCard (div[role=button]
            from DnD kit) is wrapped in a <li> so the semantic list structure is valid */}
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sections.map((section, indexInLane) => (
            <li key={section.id} style={{ listStyle: 'none' }}>
              <SceneCard
                section={section}
                characters={characters}
                locationOptions={locationOptions}
                t={t}
                onUpdate={onUpdate}
                onDelete={onDelete}
                sceneIndexInAct={indexInLane}
                actLaneLength={sections.length}
                onReorderInAct={onReorderInAct}
              />
            </li>
          ))}
          {sections.length === 0 && (
            <li style={{ listStyle: 'none' }}>
              <div className="text-center py-6 text-xs text-[var(--sc-text-muted)] border-2 border-dashed border-[var(--sc-border-subtle)] rounded-lg transition-colors">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mx-auto mb-1 opacity-40"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                {t('sceneboard.dragEmptyHint')}
              </div>
            </li>
          )}
        </SortableContext>
      </ul>
    </div>
  );
};
