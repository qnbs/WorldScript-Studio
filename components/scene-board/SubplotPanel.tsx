// QNBS-v3: Subplot sidebar — reads subplots from projectSlice (undo-able), subplot filter
//          stays in plotBoardSlice (ephemeral viewport state).
import type { FC } from 'react';
import { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../../app/hooks';
import {
  plotBoardActions,
  selectActiveSubplotFilter,
} from '../../features/plotBoard/plotBoardSlice';
import { selectPlotSubplots } from '../../features/project/projectSelectors';
import { projectActions } from '../../features/project/projectSlice';
import type { StorySection, Subplot } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#6b7280',
];

// ── Section-assign popover ────────────────────────────────────────────────────

interface AssignPopoverProps {
  subplot: Subplot;
  sections: StorySection[];
  onClose: () => void;
  t: (key: string) => string;
}

const AssignPopover: FC<AssignPopoverProps> = ({ subplot, sections, onClose, t }) => {
  const dispatch = useAppDispatch();

  const toggle = useCallback(
    (sectionId: string) => {
      if (subplot.sectionIds.includes(sectionId)) {
        dispatch(projectActions.removeSectionFromPlotSubplot({ sectionId, subplotId: subplot.id }));
      } else {
        dispatch(projectActions.assignSectionToPlotSubplot({ sectionId, subplotId: subplot.id }));
      }
    },
    [dispatch, subplot],
  );

  return (
    <div
      className="absolute left-full top-0 ml-1 z-50 w-56 bg-[var(--background-elevated)] border border-[var(--sc-border-subtle)] rounded-lg shadow-sc-lg p-2"
      role="dialog"
      aria-label={t('sceneboard.subplot.assignScenes')}
    >
      <p className="text-xs font-medium text-[var(--sc-text-muted)] mb-2 px-1">
        {t('sceneboard.subplot.assignScenes')}
      </p>
      {sections.length === 0 ? (
        <p className="text-xs text-[var(--sc-text-muted)] px-1">
          {t('sceneboard.subplot.noScenes')}
        </p>
      ) : (
        <ul className="space-y-0.5 max-h-52 overflow-y-auto">
          {sections.map((s) => {
            const checked = subplot.sectionIds.includes(s.id);
            return (
              <li key={s.id}>
                <label className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-[var(--background-hover)] cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="accent-[var(--sc-accent-primary,#6366f1)]"
                    aria-label={s.title}
                  />
                  <span className="truncate text-[var(--sc-text-primary)]">{s.title}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        className="mt-2 w-full text-xs text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] text-right pr-1"
        onClick={onClose}
      >
        {t('common.close')}
      </button>
    </div>
  );
};

// ── Single subplot row ────────────────────────────────────────────────────────

interface SubplotRowProps {
  subplot: Subplot;
  isFiltered: boolean;
  sections: StorySection[];
  t: (key: string) => string;
  onFilterToggle: () => void;
  onDelete: () => void;
}

const SubplotRow: FC<SubplotRowProps> = ({
  subplot,
  isFiltered,
  sections,
  t,
  onFilterToggle,
  onDelete,
}) => {
  const dispatch = useAppDispatch();
  const [showAssign, setShowAssign] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(subplot.name);

  const commitName = useCallback(() => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== subplot.name) {
      dispatch(projectActions.updatePlotSubplot({ id: subplot.id, changes: { name: trimmed } }));
    } else {
      setDraftName(subplot.name);
    }
    setEditing(false);
  }, [dispatch, draftName, subplot.id, subplot.name]);

  return (
    <li className="relative group">
      <div
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors ${isFiltered ? 'bg-[var(--background-selected)]' : 'hover:bg-[var(--background-hover)]'}`}
      >
        {/* Color swatch */}
        <button
          type="button"
          className="w-3 h-3 rounded-full flex-shrink-0 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--sc-accent-primary,#6366f1)]"
          style={{ backgroundColor: subplot.color }}
          aria-label={t('sceneboard.subplot.changeColor')}
          onClick={onFilterToggle}
        />

        {/* Name */}
        {editing ? (
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setDraftName(subplot.name);
                setEditing(false);
              }
            }}
            className="flex-1 min-w-0 text-xs bg-transparent border-b border-[var(--sc-border-subtle)] text-[var(--sc-text-primary)] outline-none"
            aria-label={t('sceneboard.subplot.editName')}
          />
        ) : (
          <button
            type="button"
            className="flex-1 min-w-0 text-xs text-left text-[var(--sc-text-primary)] truncate"
            onDoubleClick={() => setEditing(true)}
            onClick={onFilterToggle}
            aria-pressed={isFiltered}
            aria-label={`${subplot.name} — ${t('sceneboard.subplot.filterToggle')}`}
          >
            {subplot.name}
          </button>
        )}

        {/* Scene count badge */}
        <span className="text-[10px] text-[var(--sc-text-muted)] tabular-nums">
          {subplot.sectionIds.length}
        </span>

        {/* Assign button */}
        <button
          type="button"
          onClick={() => setShowAssign((v) => !v)}
          className="opacity-0 group-hover:opacity-100 text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] text-xs px-0.5"
          aria-label={t('sceneboard.subplot.assignScenes')}
          aria-expanded={showAssign}
        >
          ⊕
        </button>

        {/* Delete button */}
        <button
          type="button"
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 text-[var(--sc-text-muted)] hover:text-red-400 text-xs px-0.5"
          aria-label={`${t('sceneboard.subplot.delete')} ${subplot.name}`}
        >
          ×
        </button>
      </div>

      {showAssign && (
        <AssignPopover
          subplot={subplot}
          sections={sections}
          onClose={() => setShowAssign(false)}
          t={t}
        />
      )}
    </li>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

interface SubplotPanelProps {
  sections: StorySection[];
  t: (key: string) => string;
}

export const SubplotPanel: FC<SubplotPanelProps> = ({ sections, t }) => {
  const dispatch = useAppDispatch();
  const subplots = useAppSelectorShallow(selectPlotSubplots);
  const activeFilter = useAppSelectorShallow(selectActiveSubplotFilter);
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PRESET_COLORS[0] ?? '#6366f1');
  const colorInputRef = useRef<HTMLInputElement>(null);

  const handleAddSubplot = useCallback(() => {
    const name = newName.trim() || t('sceneboard.subplot.defaultName');
    dispatch(
      projectActions.addPlotSubplot({
        id: generateId(),
        name,
        color: newColor,
        sectionIds: [],
      }),
    );
    setNewName('');
    setAdding(false);
  }, [dispatch, newColor, newName, t]);

  const handleFilterToggle = useCallback(
    (id: string) => {
      dispatch(plotBoardActions.setActiveSubplotFilter(activeFilter === id ? null : id));
    },
    [dispatch, activeFilter],
  );

  const handleDelete = useCallback(
    (id: string) => {
      dispatch(projectActions.deletePlotSubplot(id));
      // Clear viewport filter so deleted subplot doesn't stay highlighted
      dispatch(plotBoardActions.setActiveSubplotFilter(null));
    },
    [dispatch],
  );

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-2 px-1 gap-2 border-r border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] rounded-l-lg">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] text-sm"
          aria-label={t('sceneboard.subplot.expandPanel')}
          title={t('sceneboard.subplot.expandPanel')}
        >
          ▶
        </button>
        {subplots.map((sp) => (
          <div
            key={sp.id}
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: sp.color }}
            title={sp.name}
          />
        ))}
      </div>
    );
  }

  return (
    <aside
      className="flex flex-col w-44 flex-shrink-0 border-r border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] rounded-l-lg overflow-hidden"
      aria-label={t('sceneboard.subplot.panelLabel')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-[var(--sc-border-subtle)]">
        <span className="text-xs font-semibold text-[var(--sc-text-primary)] uppercase tracking-wide">
          {t('sceneboard.subplot.title')}
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] text-xs"
          aria-label={t('sceneboard.subplot.collapsePanel')}
        >
          ◀
        </button>
      </div>

      {/* Subplot list */}
      <ul className="flex-1 overflow-y-auto py-1 space-y-0.5 px-1">
        {subplots.length === 0 && (
          <li className="px-2 py-3 text-xs text-[var(--sc-text-muted)] text-center">
            {t('sceneboard.subplot.empty')}
          </li>
        )}
        {subplots.map((sp) => (
          <SubplotRow
            key={sp.id}
            subplot={sp}
            isFiltered={activeFilter === sp.id}
            sections={sections}
            t={t}
            onFilterToggle={() => handleFilterToggle(sp.id)}
            onDelete={() => handleDelete(sp.id)}
          />
        ))}
      </ul>

      {/* Add subplot */}
      <div className="border-t border-[var(--sc-border-subtle)] p-2">
        {adding ? (
          <div className="space-y-1.5">
            <input
              type="text"
              placeholder={t('sceneboard.subplot.namePlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSubplot();
                if (e.key === 'Escape') setAdding(false);
              }}
              className="w-full text-xs px-2 py-1 bg-[var(--sc-surface-base)] border border-[var(--sc-border-subtle)] rounded text-[var(--sc-text-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--sc-accent-primary,#6366f1)]"
              aria-label={t('sceneboard.subplot.editName')}
            />
            {/* Preset color swatches */}
            <div className="flex flex-wrap gap-1">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-4 h-4 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: newColor === c ? 'white' : 'transparent',
                  }}
                  onClick={() => setNewColor(c)}
                  aria-label={c}
                />
              ))}
              {/* Custom color picker */}
              <button
                type="button"
                className="w-4 h-4 rounded-full border border-dashed border-[var(--sc-border-subtle)] flex items-center justify-center text-[8px] text-[var(--sc-text-muted)]"
                onClick={() => colorInputRef.current?.click()}
                aria-label={t('sceneboard.subplot.customColor')}
              >
                +
              </button>
              <input
                ref={colorInputRef}
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="sr-only"
                aria-label={t('sceneboard.subplot.customColor')}
              />
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleAddSubplot}
                className="flex-1 text-xs py-0.5 rounded bg-[var(--sc-accent-primary,#6366f1)] text-white"
              >
                {t('common.add')}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="text-xs px-2 py-0.5 rounded text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)]"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full text-xs text-[var(--sc-text-muted)] hover:text-[var(--sc-text-primary)] flex items-center gap-1 px-1 py-0.5 rounded hover:bg-[var(--background-hover)] transition-colors"
            aria-label={t('sceneboard.subplot.addSubplot')}
          >
            <span aria-hidden="true">+</span>
            {t('sceneboard.subplot.addSubplot')}
          </button>
        )}
      </div>
    </aside>
  );
};
