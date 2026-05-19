// QNBS-v3: Floating toolbar for the currently selected plot connection.
//          Positioned at the bottom-left of the canvas wrapper (no midpoint math needed).
import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelectorShallow } from '../../app/hooks';
import {
  plotBoardActions,
  selectConnections,
  selectSelectedConnectionId,
} from '../../features/plotBoard/plotBoardSlice';
import type { PlotConnectionType } from '../../types';

const CONNECTION_TYPE_OPTIONS: { value: PlotConnectionType; icon: string }[] = [
  { value: 'cause-effect', icon: '→' },
  { value: 'parallel', icon: '∥' },
  { value: 'subplot', icon: '⊃' },
  { value: 'temporal', icon: '↔' },
  { value: 'character-arc', icon: '♡' },
];

interface ConnectionToolbarProps {
  t: (key: string) => string;
}

export const ConnectionToolbar: FC<ConnectionToolbarProps> = ({ t }) => {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelectorShallow(selectSelectedConnectionId);
  const connections = useAppSelectorShallow(selectConnections);
  const [labelDraft, setLabelDraft] = useState('');
  const [labelInit, setLabelInit] = useState<string | null>(null);

  const selected = selectedId ? (connections.find((c) => c.id === selectedId) ?? null) : null;

  // Keep labelDraft in sync when selection changes
  if (selected && selected.id !== labelInit) {
    setLabelDraft(selected.label ?? '');
    setLabelInit(selected.id);
  }
  if (!selected && labelInit !== null) {
    setLabelDraft('');
    setLabelInit(null);
  }

  const handleTypeChange = useCallback(
    (type: PlotConnectionType) => {
      if (!selectedId) return;
      dispatch(plotBoardActions.updateConnection({ id: selectedId, changes: { type } }));
    },
    [dispatch, selectedId],
  );

  const handleLabelCommit = useCallback(() => {
    if (!selectedId) return;
    // QNBS-v3: exactOptionalPropertyTypes requires spreading conditionally — can't pass undefined directly
    const changes = labelDraft ? { label: labelDraft } : {};
    dispatch(plotBoardActions.updateConnection({ id: selectedId, changes }));
  }, [dispatch, labelDraft, selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    dispatch(plotBoardActions.removeConnection(selectedId));
  }, [dispatch, selectedId]);

  const handleDeselect = useCallback(() => {
    dispatch(plotBoardActions.setSelectedConnection(null));
  }, [dispatch]);

  if (!selected) return null;

  return (
    <div
      className="absolute bottom-3 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--background-elevated)] border border-[var(--border-primary)] shadow-sc-lg"
      role="toolbar"
      aria-label={t('sceneboard.connectionToolbar.label')}
    >
      {/* Connection type buttons */}
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={t('sceneboard.connectionToolbar.typeLabel')}
      >
        {CONNECTION_TYPE_OPTIONS.map(({ value, icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleTypeChange(value)}
            className={`w-7 h-7 rounded text-sm transition-colors ${
              selected.type === value
                ? 'bg-[var(--sc-accent-primary,#6366f1)] text-white'
                : 'text-[var(--foreground-muted)] hover:bg-[var(--background-hover)]'
            }`}
            title={t(`sceneboard.connectionType.${value}`)}
            aria-pressed={selected.type === value}
            aria-label={t(`sceneboard.connectionType.${value}`)}
          >
            {icon}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-[var(--border-primary)]" aria-hidden="true" />

      {/* Label input */}
      <input
        type="text"
        value={labelDraft}
        onChange={(e) => setLabelDraft(e.target.value)}
        onBlur={handleLabelCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleLabelCommit();
          if (e.key === 'Escape') {
            setLabelDraft(selected.label ?? '');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={t('sceneboard.connectionToolbar.labelPlaceholder')}
        className="w-28 text-xs px-2 py-0.5 bg-[var(--background-primary)] border border-[var(--border-primary)] rounded text-[var(--foreground-primary)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--sc-accent-primary,#6366f1)]"
        aria-label={t('sceneboard.connectionToolbar.labelInput')}
      />

      <div className="w-px h-5 bg-[var(--border-primary)]" aria-hidden="true" />

      {/* Delete */}
      <button
        type="button"
        onClick={handleDelete}
        className="text-xs text-red-400 hover:text-red-300 px-1"
        aria-label={t('sceneboard.connectionToolbar.delete')}
        title={t('sceneboard.connectionToolbar.delete')}
      >
        🗑
      </button>

      {/* Deselect */}
      <button
        type="button"
        onClick={handleDeselect}
        className="text-xs text-[var(--foreground-muted)] hover:text-[var(--foreground-primary)] px-1"
        aria-label={t('sceneboard.connectionToolbar.close')}
      >
        ×
      </button>
    </div>
  );
};
