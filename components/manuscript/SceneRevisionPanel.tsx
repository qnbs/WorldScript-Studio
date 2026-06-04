import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch } from '../../app/hooks';
import { projectActions } from '../../features/project/projectSlice';
import { useTranslation } from '../../hooks/useTranslation';
import { deleteRevision, listRevisions, saveRevision } from '../../services/sceneRevisionService';
import { diffTokensToOps, tokenizeWordsAndSpaces } from '../../services/wordDiff';
import type { SceneRevision, StorySection } from '../../types';

// ── Word-level diff view ──────────────────────────────────────────────────────

const DiffView: FC<{ oldText: string; newText: string }> = ({ oldText, newText }) => {
  const { t } = useTranslation();
  const aToks = tokenizeWordsAndSpaces(oldText);
  const bToks = tokenizeWordsAndSpaces(newText);
  const ops = diffTokensToOps(aToks, bToks);

  return (
    <div className="text-sm font-mono leading-relaxed break-words p-3 bg-[var(--sc-surface-raised)] rounded border border-[var(--sc-border-subtle)] max-h-48 overflow-y-auto">
      {ops.length === 0 && (
        <span className="text-[var(--sc-text-secondary)]">{t('revisions.diff.identical')}</span>
      )}
      {ops.map((op, i) => {
        // QNBS-v3: Composite key from token+type ensures uniqueness for diff ops
        const key = `${op.type}-${op.token}-${i}`;
        if (op.type === 'equal') return <span key={key}>{op.token}</span>;
        if (op.type === 'delete')
          return (
            <span
              key={key}
              className="bg-[var(--sc-danger-bg)] text-[var(--sc-danger-fg)] line-through"
            >
              {op.token}
            </span>
          );
        return (
          <span key={key} className="bg-[var(--sc-success-bg)] text-[var(--sc-success-fg)]">
            {op.token}
          </span>
        );
      })}
    </div>
  );
};

// ── Revision Item ─────────────────────────────────────────────────────────────

const RevisionItem: FC<{
  revision: SceneRevision;
  currentContent: string;
  onDeleted: () => void;
  onRestored: () => void;
}> = ({ revision, currentContent, onDeleted, onRestored }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [showDiff, setShowDiff] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const handleDelete = useCallback(async () => {
    await deleteRevision(revision.id);
    onDeleted();
  }, [revision.id, onDeleted]);

  const handleRestore = useCallback(() => {
    dispatch(
      projectActions.updateManuscriptSection({
        id: revision.sectionId,
        changes: { title: revision.title, content: revision.content },
      }),
    );
    setConfirmRestore(false);
    onRestored();
  }, [dispatch, revision, onRestored]);

  return (
    <li className="border border-[var(--sc-border-subtle)] rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--sc-text-primary)]">
            {revision.label ?? new Date(revision.createdAt).toLocaleString()}
          </p>
          {revision.label && (
            <p className="text-xs text-[var(--sc-text-secondary)]">
              {new Date(revision.createdAt).toLocaleString()}
            </p>
          )}
          <p className="text-xs text-[var(--sc-text-secondary)]">
            {t('revisions.wordCount', { n: String(revision.wordCount) })}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
          >
            {showDiff ? t('revisions.hideDiff') : t('revisions.showDiff')}
          </button>
          {confirmRestore ? (
            <>
              <button
                type="button"
                onClick={handleRestore}
                className="text-xs px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600"
              >
                {t('revisions.confirmRestore')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRestore(false)}
                className="text-xs px-2 py-1 rounded border border-[var(--sc-border-subtle)] hover:bg-[var(--sc-surface-overlay)]"
              >
                {t('revisions.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRestore(true)}
              className="text-xs px-2 py-1 rounded bg-[var(--sc-accent)] text-[white] hover:opacity-90"
            >
              {t('revisions.restore')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="text-xs px-2 py-1 rounded text-[var(--sc-danger-fg)] hover:text-[var(--sc-danger-fg)]/80"
            aria-label={t('revisions.delete')}
          >
            ✕
          </button>
        </div>
      </div>
      {showDiff && <DiffView oldText={revision.content} newText={currentContent} />}
    </li>
  );
};

// ── Main Panel ────────────────────────────────────────────────────────────────

export const SceneRevisionPanel: FC<{ section: StorySection }> = ({ section }) => {
  const { t } = useTranslation();
  const [revisions, setRevisions] = useState<SceneRevision[]>([]);
  const [labelDraft, setLabelDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reload = useCallback(() => {
    listRevisions(section.id)
      .then(setRevisions)
      .catch(() => undefined);
  }, [section.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSaveNamed = useCallback(async () => {
    setIsSaving(true);
    await saveRevision(
      section.id,
      { title: section.title, content: section.content ?? '' },
      labelDraft || undefined,
    );
    setLabelDraft('');
    reload();
    setIsSaving(false);
  }, [section, labelDraft, reload]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--sc-text-primary)]">
          {t('revisions.title')}
        </span>
        <span className="text-xs text-[var(--sc-text-secondary)]">
          {t('revisions.count', { n: String(revisions.length) })}
        </span>
      </div>

      {/* Save named revision */}
      <div className="flex gap-2">
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          placeholder={t('revisions.labelPlaceholder')}
          aria-label={t('revisions.labelAriaLabel')}
          className="flex-1 px-2 py-1 rounded border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)] text-sm"
        />
        <button
          type="button"
          onClick={() => void handleSaveNamed()}
          disabled={isSaving}
          className="px-2 py-1 rounded bg-[var(--sc-accent)] text-[white] text-xs disabled:opacity-50"
        >
          {isSaving ? '…' : t('revisions.saveNamed')}
        </button>
      </div>

      {/* List */}
      {revisions.length === 0 ? (
        <p className="text-sm text-[var(--sc-text-secondary)] text-center py-4">
          {t('revisions.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {revisions.map((r) => (
            <RevisionItem
              key={r.id}
              revision={r}
              currentContent={section.content ?? ''}
              onDeleted={reload}
              onRestored={reload}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
