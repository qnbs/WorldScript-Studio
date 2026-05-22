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
        className="flex-grow min-h-[200px] overflow-y-auto pr-1 space-y-0 list-none"
        aria-label={t('sceneboard.dragAriaLabel')}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sections.map((section, indexInLane) => (
            <SceneCard
              key={section.id}
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
          ))}
          {sections.length === 0 && (
            <div className="text-center py-8 text-xs text-[var(--sc-text-muted)] border-2 border-dashed border-[var(--sc-border-subtle)] rounded-lg">
              {t('sceneboard.dragEmptyHint')}
            </div>
          )}
        </SortableContext>
      </ul>
    </div>
  );
};
