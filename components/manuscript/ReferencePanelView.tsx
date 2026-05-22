import type { FC } from 'react';
import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import {
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../../features/project/projectSelectors';
import { projectActions } from '../../features/project/projectSlice';
import { selectCommentsBySection } from '../../features/sceneComments/sceneCommentsSlice';
import { statusActions } from '../../features/status/statusSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { rebuildHybridRagIndex } from '../../services/localRagService';
import type { StorySection } from '../../types';
import { CommentsPanel } from './CommentsPanel';
import { SceneRevisionPanel } from './SceneRevisionPanel';

type Tab = 'characters' | 'world' | 'notes' | 'binder' | 'comments' | 'revisions';

// ── Characters Tab ────────────────────────────────────────────────────────────

const CharactersTab: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const characters = useAppSelector(selectAllCharacters);
  const linked = characters.filter(
    (c) => section.characterIds?.includes(c.id) || section.povCharacterId === c.id,
  );

  if (linked.length === 0) {
    return (
      <p className="text-sm text-[var(--sc-text-secondary)] text-center py-4">
        {t('reference.characters.empty')}
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-2">
      {linked.map((c) => (
        <li
          key={c.id}
          className="flex items-start gap-3 p-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
        >
          {c.hasAvatar ? (
            <div
              className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--sc-accent)] text-white text-sm font-bold"
              aria-hidden="true"
            >
              {c.name.slice(0, 1).toUpperCase()}
            </div>
          ) : (
            <div
              className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center bg-[var(--sc-surface-overlay)] text-lg"
              aria-hidden="true"
            >
              👤
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--sc-text-primary)] truncate">{c.name}</p>
            {c.backstory && (
              <p className="text-xs text-[var(--sc-text-secondary)] line-clamp-2">
                {c.backstory.slice(0, 80)}
                {c.backstory.length > 80 ? '…' : ''}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
};

// ── World Tab ─────────────────────────────────────────────────────────────────

const WorldTab: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const worlds = useAppSelector(selectAllWorlds);
  const linked = worlds.filter(
    (w) => w.id === section.sceneLocationId || section.worldIds?.includes(w.id),
  );

  if (linked.length === 0) {
    return (
      <p className="text-sm text-[var(--sc-text-secondary)] text-center py-4">
        {t('reference.world.empty')}
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-2">
      {linked.map((w) => (
        <li
          key={w.id}
          className="p-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
        >
          <p className="text-sm font-semibold text-[var(--sc-text-primary)]">{w.name}</p>
          {w.description && (
            <p className="text-xs text-[var(--sc-text-secondary)] mt-1 line-clamp-3">
              {w.description.slice(0, 120)}
              {w.description.length > 120 ? '…' : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};

// ── Notes Tab ─────────────────────────────────────────────────────────────────

const NotesTab: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  return (
    <div className="p-2">
      <textarea
        value={section.notes ?? ''}
        onChange={(e) =>
          dispatch(
            projectActions.updateManuscriptSection({
              id: section.id,
              changes: { notes: e.target.value },
            }),
          )
        }
        placeholder={t('reference.notes.placeholder')}
        aria-label={t('reference.notes.ariaLabel')}
        rows={8}
        className="w-full px-2 py-1.5 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-sm resize-none"
      />
    </div>
  );
};

// ── Binder Tab ────────────────────────────────────────────────────────────────

const BinderTab: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const project = useAppSelector(selectProjectData);
  const linked = (project.binderNodes ?? []).filter((n) => n.linkedSectionId === section.id);

  if (linked.length === 0) {
    return (
      <p className="text-sm text-[var(--sc-text-secondary)] text-center py-4">
        {t('reference.binder.empty')}
      </p>
    );
  }

  return (
    <ul className="space-y-2 p-2">
      {linked.map((node) => (
        <li
          key={node.id}
          className="p-2 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]"
        >
          <p className="text-sm font-semibold text-[var(--sc-text-primary)]">{node.title}</p>
          {node.content && (
            <p className="text-xs text-[var(--sc-text-secondary)] mt-1 line-clamp-3">
              {node.content.slice(0, 160)}
              {node.content.length > 160 ? '…' : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
};

// ── Main Panel ────────────────────────────────────────────────────────────────

export const ReferencePanelView: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('characters');
  const [reindexBusy, setReindexBusy] = useState(false);
  const dispatch = useAppDispatch();
  const projectData = useAppSelector(selectProjectData);
  const duckDbEnabled = useAppSelector((s) => s.featureFlags.enableDuckDbAnalytics);
  const commentCount = useAppSelector(selectCommentsBySection(section.id)).filter(
    (c) => !c.resolved,
  ).length;

  const handleReindex = async () => {
    if (!projectData) return;
    setReindexBusy(true);
    try {
      // QNBS-v3: re-index from the panel so the AI context is fresh after heavy edits.
      const chunks = await rebuildHybridRagIndex(
        projectData.id ?? 'browser-project',
        projectData.manuscript,
        duckDbEnabled,
      );
      dispatch(
        statusActions.addNotification({
          type: 'success',
          title: t('reference.reindex.done'),
          description: t('reference.reindex.doneDetail', { count: String(chunks) }),
        }),
      );
    } catch {
      dispatch(
        statusActions.addNotification({ type: 'error', title: t('reference.reindex.error') }),
      );
    } finally {
      setReindexBusy(false);
    }
  };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'characters', label: t('reference.tabs.characters') },
    { id: 'world', label: t('reference.tabs.world') },
    { id: 'notes', label: t('reference.tabs.notes') },
    { id: 'binder', label: t('reference.tabs.binder') },
    {
      id: 'comments',
      label:
        commentCount > 0
          ? `${t('reference.tabs.comments')} (${commentCount})`
          : t('reference.tabs.comments'),
    },
    { id: 'revisions', label: t('reference.tabs.revisions') },
  ];

  return (
    <aside
      aria-label={t('reference.ariaLabel')}
      className="flex flex-col h-full border-l border-[var(--sc-border-subtle)]"
    >
      {/* Tab bar */}
      <div
        role="tablist"
        className="flex overflow-x-auto border-b border-[var(--sc-border-subtle)] flex-shrink-0 items-center"
      >
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`ref-tabpanel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--sc-accent)] text-[var(--sc-accent)]'
                : 'border-transparent text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div
        id={`ref-tabpanel-${activeTab}`}
        role="tabpanel"
        aria-label={TABS.find((t) => t.id === activeTab)?.label ?? ''}
        className="flex-1 overflow-y-auto"
      >
        {activeTab === 'characters' && <CharactersTab section={section} />}
        {activeTab === 'world' && <WorldTab section={section} />}
        {activeTab === 'notes' && <NotesTab section={section} />}
        {activeTab === 'binder' && <BinderTab section={section} />}
        {activeTab === 'comments' && <CommentsPanel sectionId={section.id} />}
        {activeTab === 'revisions' && <SceneRevisionPanel section={section} />}
      </div>

      {/* Re-index for AI — always visible footer action */}
      <div className="flex-shrink-0 border-t border-[var(--sc-border-subtle)] px-3 py-2">
        <button
          type="button"
          disabled={reindexBusy}
          onClick={() => void handleReindex()}
          aria-busy={reindexBusy}
          className="text-xs text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {reindexBusy ? t('reference.reindex.busy') : t('reference.reindex.action')}
        </button>
      </div>
    </aside>
  );
};
