import { useState } from 'react';
import { useMindMapViewContext } from '../../contexts/MindMapViewContext';
import type { NewMindMapDraft } from '../../hooks/useMindMapView';
import { useTranslation } from '../../hooks/useTranslation';
import { Icon } from '../ui/Icon';

// QNBS-v3: All dark: stone/violet prefixes replaced with --sc-* tokens — appearance presets now work.
const inputClass =
  'w-full text-sm px-2 py-1.5 rounded-sc-sm border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] outline-none';

function MapForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: NewMindMapDraft;
  onSave: (d: NewMindMapDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        // QNBS-v3: exactOptionalPropertyTypes — conditional spread avoids string|undefined vs optional string mismatch
        onSave({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        });
      }}
      className="p-3 space-y-3 border-b border-[var(--sc-border-subtle)] bg-[var(--sc-surface-overlay)]"
    >
      <div>
        <label
          htmlFor="mm-map-name"
          className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('mindmap.mapName')}
        </label>
        <input
          id="mm-map-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('mindmap.mapNamePlaceholder')}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label
          htmlFor="mm-map-desc"
          className="block text-xs font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('mindmap.mapDescription')}
        </label>
        <textarea
          id="mm-map-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('mindmap.mapDescriptionPlaceholder')}
          rows={2}
          className={`${inputClass} resize-none`}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded-sc-sm border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)]"
        >
          {t('mindmap.cancel')}
        </button>
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-sc-sm bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-[var(--sc-text-on-accent)]"
        >
          {t('mindmap.save')}
        </button>
      </div>
    </form>
  );
}

export function MindMapListPanel() {
  const { t } = useTranslation();
  const {
    mindMaps,
    activeMindMapId,
    isMapFormOpen,
    editingMapId,
    handleSelectMap,
    handleOpenNewMapForm,
    handleOpenEditMapForm,
    handleCloseMapForm,
    handleSaveMap,
    handleDeleteMap,
    handleAddNode,
  } = useMindMapViewContext();

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const editingMap = mindMaps.find((m) => m.id === editingMapId);

  return (
    // QNBS-v3: w-full on mobile (stacks below toolbar); md:w-56 on desktop — sidebar must not eat the canvas.
    <aside
      className="w-full md:w-56 md:flex-shrink-0 max-h-[35vh] md:max-h-none border-b md:border-b-0 md:border-r border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] flex flex-col"
      aria-label={t('mindmap.title')}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--sc-border-subtle)]">
        <span className="text-xs font-semibold text-[var(--sc-text-primary)] uppercase tracking-wide">
          {t('mindmap.title')}
        </span>
        <button
          type="button"
          onClick={handleOpenNewMapForm}
          aria-label={t('mindmap.addMap')}
          title={t('mindmap.addMap')}
          className="p-1 rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)]"
        >
          <Icon name="plus" size="sm" aria-hidden="true" />
        </button>
      </div>

      {isMapFormOpen && (
        <MapForm
          {...(editingMap
            ? {
                initial: {
                  name: editingMap.name,
                  ...(editingMap.description !== undefined
                    ? { description: editingMap.description }
                    : {}),
                },
              }
            : {})}
          onSave={handleSaveMap}
          onCancel={handleCloseMapForm}
        />
      )}

      {/* QNBS-v3: div used instead of ul so role="listbox" passes a11y (ul is non-interactive) */}
      <div className="flex-1 overflow-y-auto" role="listbox" aria-label={t('mindmap.title')}>
        {mindMaps.length === 0 && !isMapFormOpen && (
          <div className="p-4 text-xs text-[var(--sc-text-muted)] text-center">
            {t('mindmap.emptyState')}
          </div>
        )}
        {mindMaps.map((map) => {
          const isActive = map.id === activeMindMapId;
          return (
            <div key={map.id} role="option" aria-selected={isActive} tabIndex={-1}>
              {confirmDeleteId === map.id ? (
                <div className="px-3 py-2 space-y-1">
                  <p className="text-xs text-[var(--sc-danger-fg)]">
                    {t('mindmap.deleteMapConfirm')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleDeleteMap(map.id);
                        setConfirmDeleteId(null);
                      }}
                      className="text-xs px-2 py-1 rounded-sc-sm bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] hover:opacity-80"
                    >
                      {t('mindmap.deleteMap')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs px-2 py-1 rounded-sc-sm border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)]"
                    >
                      {t('mindmap.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`group flex items-center gap-1 px-3 py-2 cursor-pointer ${
                    isActive
                      ? 'bg-[var(--sc-accent)]/10 text-[var(--sc-accent)]'
                      : 'hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-primary)]'
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 text-left text-sm truncate"
                    onClick={() => handleSelectMap(map.id)}
                  >
                    {map.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditMapForm(map.id)}
                    aria-label={t('mindmap.editMap')}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-sc-sm hover:bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)] transition-opacity"
                  >
                    <Icon name="settings" size="sm" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(map.id)}
                    aria-label={t('mindmap.deleteMap')}
                    className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 rounded-sc-sm hover:bg-[var(--sc-danger-bg)] text-[var(--sc-text-muted)] hover:text-[var(--sc-danger-fg)] transition-opacity"
                  >
                    <Icon name="trash" size="sm" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeMindMapId && (
        <div className="p-2 border-t border-[var(--sc-border-subtle)]">
          <button
            type="button"
            onClick={() =>
              handleAddNode({
                label: 'New node',
                position: { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 },
                type: 'free',
                shape: 'rectangle',
                color: 'var(--sc-data-2)',
              })
            }
            className="w-full text-xs py-1.5 rounded-sc-sm bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-[var(--sc-text-on-accent)]"
          >
            {t('mindmap.addNode')}
          </button>
        </div>
      )}
    </aside>
  );
}
