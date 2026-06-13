import type { FC } from 'react';
import { useState } from 'react';
import { ObjectsViewContext, useObjectsViewContext } from '../contexts/ObjectsViewContext';
import { useObjectsView } from '../hooks/useObjectsView';
import type { ObjectGroup, StoryObject, StoryObjectType } from '../types';
import { EmptyState } from './ui/EmptyState';
import { Icon } from './ui/Icon';
import { SectionIcon } from './ui/SectionIcon';
import { Select } from './ui/Select';

// ── Object Type Badge ─────────────────────────────────────────────────────────

// QNBS-v3: type badge colors use the design-system data-viz palette so they adapt to theme/sepia.
const TYPE_COLORS: Record<StoryObjectType, string> = {
  prop: 'bg-[var(--sc-data-2)]/15 text-[var(--sc-data-2)]',
  weapon: 'bg-[var(--sc-data-1)]/15 text-[var(--sc-data-1)]',
  vehicle: 'bg-[var(--sc-data-4)]/15 text-[var(--sc-data-4)]',
  artifact: 'bg-[var(--sc-data-6)]/15 text-[var(--sc-data-6)]',
  document: 'bg-[var(--sc-data-4)]/15 text-[var(--sc-data-4)]',
  'place-item': 'bg-[var(--sc-data-3)]/15 text-[var(--sc-data-3)]',
  other: 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)]',
};

const TypeBadge: FC<{ type: StoryObjectType; label: string }> = ({ type, label }) => (
  <span
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[type]}`}
  >
    {label}
  </span>
);

// ── Object Form ───────────────────────────────────────────────────────────────

const OBJECT_TYPES: StoryObjectType[] = [
  'prop',
  'weapon',
  'vehicle',
  'artifact',
  'document',
  'place-item',
  'other',
];

const ObjectForm: FC = () => {
  const { t, editingObject, handleSaveObject, handleCancelForm } = useObjectsViewContext();

  const [name, setName] = useState(editingObject?.name ?? '');
  const [description, setDescription] = useState(editingObject?.description ?? '');
  const [type, setType] = useState<StoryObjectType>(editingObject?.type ?? 'prop');
  const [significance, setSignificance] = useState(editingObject?.significance ?? '');
  const [notes, setNotes] = useState(editingObject?.notes ?? '');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    handleSaveObject({ name: name.trim(), description, type, significance, notes });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="obj-name"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.name')}
        </label>
        <input
          id="obj-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('objects.namePlaceholder')}
          required
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div>
        <label
          htmlFor="obj-type"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.type')}
        </label>
        <Select
          id="obj-type"
          value={type}
          onChange={(v) => setType(v as StoryObjectType)}
          options={OBJECT_TYPES.map((ot) => ({
            value: ot,
            label: t(`objects.typeLabel.${ot}`),
          }))}
        />
      </div>
      <div>
        <label
          htmlFor="obj-description"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.description')}
        </label>
        <textarea
          id="obj-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('objects.descriptionPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div>
        <label
          htmlFor="obj-significance"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.significance')}
        </label>
        <textarea
          id="obj-significance"
          value={significance}
          onChange={(e) => setSignificance(e.target.value)}
          placeholder={t('objects.significancePlaceholder')}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div>
        <label
          htmlFor="obj-notes"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.notes')}
        </label>
        <textarea
          id="obj-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('objects.notesPlaceholder')}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={handleCancelForm}
          className="px-4 py-2 text-sm rounded-lg border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        >
          {t('objects.cancel')}
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] hover:bg-[var(--sc-accent-hover)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        >
          {t('objects.save')}
        </button>
      </div>
    </form>
  );
};

// ── Group Form ────────────────────────────────────────────────────────────────

// QNBS-v3: group color presets use the design-system data-viz palette so they adapt to theme/sepia.
const GROUP_COLORS = [
  'var(--sc-text-muted)',
  'var(--sc-data-2)',
  'var(--sc-data-3)',
  'var(--sc-data-4)',
  'var(--sc-data-1)',
  'var(--sc-data-6)',
  'var(--sc-data-5)',
  'var(--sc-data-7)',
];

const GroupForm: FC = () => {
  const { t, editingGroup, handleSaveGroup, handleCancelForm } = useObjectsViewContext();

  const [name, setName] = useState(editingGroup?.name ?? '');
  const [description, setDescription] = useState(editingGroup?.description ?? '');
  const [color, setColor] = useState(editingGroup?.color ?? GROUP_COLORS[0]!);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    handleSaveGroup({ name: name.trim(), description, color });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="grp-name"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.groupName')}
        </label>
        <input
          id="grp-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('objects.groupNamePlaceholder')}
          required
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div>
        <label
          htmlFor="grp-description"
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
        >
          {t('objects.groupDescription')}
        </label>
        <textarea
          id="grp-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('objects.groupDescriptionPlaceholder')}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] text-sm resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        />
      </div>
      <div>
        {/* QNBS-v3: colour picker has no single associated input — label is purely descriptive */}
        <p
          className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-1"
          aria-hidden="true"
        >
          {t('objects.groupColor')}
        </p>
        <div className="flex gap-2 flex-wrap">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className="w-7 h-7 rounded-full focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-stone-500"
              style={{
                backgroundColor: c,
                outline: color === c ? `3px solid ${c}` : undefined,
                outlineOffset: color === c ? '2px' : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button
          type="button"
          onClick={handleCancelForm}
          className="px-4 py-2 text-sm rounded-lg border border-[var(--sc-border-subtle)] text-[var(--sc-text-secondary)] hover:bg-[var(--sc-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        >
          {t('objects.cancel')}
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)] hover:bg-[var(--sc-accent-hover)] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
        >
          {t('objects.save')}
        </button>
      </div>
    </form>
  );
};

// ── Object Card ───────────────────────────────────────────────────────────────

const ObjectCard: FC<{ obj: StoryObject }> = ({ obj }) => {
  const { t, groups, handleEditObject, handleDeleteObject } = useObjectsViewContext();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const objGroups = groups.filter((g) => obj.groupIds.includes(g.id));

  const onDelete = () => {
    if (confirmDelete) {
      handleDeleteObject(obj.id);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div className="bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-xl p-4 flex flex-col gap-2 hover:border-[var(--sc-border-strong)] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--sc-text-primary)] truncate">{obj.name}</h3>
          {obj.description && (
            <p className="text-sm text-[var(--sc-text-secondary)] line-clamp-2 mt-0.5">
              {obj.description}
            </p>
          )}
        </div>
        <TypeBadge type={obj.type} label={t(`objects.typeLabel.${obj.type}`)} />
      </div>
      {objGroups.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {objGroups.map((g) => (
            <span
              key={g.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              // QNBS-v3: color-mix keeps CSS variable group colors valid (hex-alpha suffix only worked for literal hex).
              style={{
                backgroundColor: `color-mix(in srgb, ${g.color} 13%, transparent)`,
                color: g.color,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: g.color }}
                aria-hidden="true"
              />
              {g.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1 pt-2 border-t border-[var(--sc-border-subtle)]">
        <button
          type="button"
          onClick={() => handleEditObject(obj)}
          className="text-xs px-2 py-2 min-h-[44px] flex items-center text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] rounded"
        >
          {t('objects.editObject')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          onBlur={() => setConfirmDelete(false)}
          className={`text-xs px-2 py-2 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-[var(--sc-danger-fg)] rounded ${
            confirmDelete
              ? 'text-[var(--sc-danger-fg)] font-medium'
              : 'text-[var(--sc-text-secondary)] hover:text-[var(--sc-danger-fg)]'
          }`}
        >
          {confirmDelete ? t('objects.deleteObjectConfirm') : t('objects.deleteObject')}
        </button>
      </div>
    </div>
  );
};

// ── Group Card ────────────────────────────────────────────────────────────────

const GroupCard: FC<{ group: ObjectGroup }> = ({ group }) => {
  const { t, objects, handleEditGroup, handleDeleteGroup } = useObjectsViewContext();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = objects.filter((o) => o.groupIds.includes(group.id)).length;

  const onDelete = () => {
    if (confirmDelete) {
      handleDeleteGroup(group.id);
    } else {
      setConfirmDelete(true);
    }
  };

  return (
    <div
      className="bg-[var(--sc-surface-raised)] border rounded-xl p-4 flex flex-col gap-2"
      // QNBS-v3: color-mix keeps CSS variable group colors valid (hex-alpha suffix only worked for literal hex).
      style={{ borderColor: `color-mix(in srgb, ${group.color} 40%, transparent)` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: group.color }}
          aria-hidden="true"
        />
        <h3 className="font-semibold text-[var(--sc-text-primary)]">{group.name}</h3>
        <span className="ml-auto text-xs text-[var(--sc-text-secondary)]">
          {count === 1
            ? t('objects.objectCount').replace('{count}', '1')
            : t('objects.objectCountPlural').replace('{count}', String(count))}
        </span>
      </div>
      {group.description && (
        <p className="text-sm text-[var(--sc-text-secondary)]">{group.description}</p>
      )}
      <div className="flex items-center gap-2 mt-1 pt-2 border-t border-[var(--sc-border-subtle)]">
        <button
          type="button"
          onClick={() => handleEditGroup(group)}
          className="text-xs px-2 py-2 min-h-[44px] flex items-center text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] rounded"
        >
          {t('objects.editGroup')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          onBlur={() => setConfirmDelete(false)}
          className={`text-xs px-2 py-2 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-[var(--sc-danger-fg)] rounded ${
            confirmDelete
              ? 'text-[var(--sc-danger-fg)] font-medium'
              : 'text-[var(--sc-text-secondary)] hover:text-[var(--sc-danger-fg)]'
          }`}
        >
          {confirmDelete ? t('objects.deleteGroupConfirm') : t('objects.deleteGroup')}
        </button>
      </div>
    </div>
  );
};

// ── Main View ─────────────────────────────────────────────────────────────────

const ObjectsViewContent: FC = () => {
  const {
    t,
    groups,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedGroupFilter,
    setSelectedGroupFilter,
    filteredObjects,
    isObjectFormOpen,
    isGroupFormOpen,
    handleAddObject,
    handleAddGroup,
  } = useObjectsViewContext();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--sc-border-subtle)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <SectionIcon section="objects" size="sm" />
          <div>
            <h1 className="text-lg font-bold text-[var(--sc-text-muted)]">{t('objects.title')}</h1>
            <p className="text-xs text-[var(--sc-text-secondary)] hidden sm:block">
              {t('objects.subtitle')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={activeTab === 'objects' ? handleAddObject : handleAddGroup}
          className="flex items-center gap-1.5 px-3 py-2 bg-[var(--sc-accent)] hover:bg-[var(--sc-accent-hover)] text-[var(--sc-text-on-accent)] text-sm font-medium rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] transition-colors"
        >
          <Icon name="plus" size="sm" aria-hidden="true" />
          {activeTab === 'objects' ? t('objects.addObject') : t('objects.addGroup')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--sc-border-subtle)] flex-shrink-0 px-4">
        {(['objects', 'groups'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)] -mb-px ${
              activeTab === tab
                ? 'border-[var(--sc-border-strong)] text-[var(--sc-text-secondary)]'
                : 'border-transparent text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
            }`}
          >
            {tab === 'objects' ? t('objects.tabObjects') : t('objects.tabGroups')}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'objects' && (
          <>
            {/* Filters */}
            <div className="flex gap-2 mb-4 flex-wrap">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('objects.search')}
                className="flex-1 min-w-[160px] px-3 py-2 text-sm rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-[var(--sc-text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              />
              <Select
                value={selectedGroupFilter ?? ''}
                onChange={(v) => setSelectedGroupFilter(v || null)}
                ariaLabel={t('objects.filterByGroup')}
                options={[
                  { value: '', label: t('objects.allGroups') },
                  { value: 'ungrouped', label: t('objects.ungrouped') },
                  ...groups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>

            {/* Object form (inline) */}
            {isObjectFormOpen && (
              <div className="mb-4 bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-xl p-4">
                <ObjectForm />
              </div>
            )}

            {/* Object list */}
            {filteredObjects.length === 0 ? (
              <EmptyState
                compact
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-8 h-8"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
                    />
                  </svg>
                }
                title={t('objects.emptyState')}
                primaryAction={{ label: t('objects.addObject'), onClick: handleAddObject }}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredObjects.map((obj) => (
                  // QNBS-v3: content-visibility skips off-screen object cards — benefit grows with large prop collections.
                  <div
                    key={obj.id}
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 120px' }}
                  >
                    <ObjectCard obj={obj} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'groups' && (
          <>
            {/* Group form (inline) */}
            {isGroupFormOpen && (
              <div className="mb-4 bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)] rounded-xl p-4">
                <GroupForm />
              </div>
            )}

            {/* Group list */}
            {groups.length === 0 ? (
              <p className="text-center text-[var(--sc-text-secondary)] text-sm mt-12">
                {t('objects.emptyGroupsState')}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((g) => (
                  // QNBS-v3: content-visibility skips off-screen group cards.
                  <div
                    key={g.id}
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 120px' }}
                  >
                    <GroupCard group={g} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const ObjectsView: FC = () => {
  const ctx = useObjectsView();
  return (
    <ObjectsViewContext.Provider value={ctx}>
      <ObjectsViewContent />
    </ObjectsViewContext.Provider>
  );
};
