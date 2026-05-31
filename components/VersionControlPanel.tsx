import type { FC, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { partialStorySectionFromSnapshot } from '../features/project/sectionRestoreHelpers';
import {
  decompressManuscript,
  MAIN_BRANCH_ID,
  selectAllBranches,
  selectCurrentBranch,
  selectCurrentBranchSnapshots,
  selectIsPanelOpen,
  versionControlActions,
} from '../features/versionControl/versionControlSlice';
import { useTranslation } from '../hooks/useTranslation';
import {
  diffTokensToOps,
  MAX_CHARS_WORD_DIFF_LINE,
  tokenizeWordsAndSpaces,
} from '../services/wordDiff';
import type { StorySection, VersionBranch, VersionSnapshot } from '../types';

/** Schwache Hardware: zu viele DOM-Zeilen im Diff-Modal vermeiden. */
const MAX_DIFF_VIEW_LINES = 450;

import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';

// ─── Helper Components ────────────────────────────────────────────────────────

// QNBS-v3: Line diff without an external package — sufficient for author snapshot review.
function buildLineDiff(
  oldText: string,
  newText: string,
): { left: string; right: string; changed: boolean }[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => {
    const left = a[i] ?? '';
    const right = b[i] ?? '';
    return { left, right, changed: left !== right };
  });
}

// QNBS-v3: Word granularity on changed lines — extends the line diff from buildLineDiff.
function renderCompareLineWordCells(
  left: string,
  right: string,
  changed: boolean,
): { leftCell: ReactNode; rightCell: ReactNode } {
  if (!changed) {
    return {
      leftCell: left.length > 0 ? left : '\u00a0',
      rightCell: right.length > 0 ? right : '\u00a0',
    };
  }
  // QNBS-v3: No O(n·m) LCS on novel lines on low-end devices — line diff is sufficient.
  if (left.length > MAX_CHARS_WORD_DIFF_LINE || right.length > MAX_CHARS_WORD_DIFF_LINE) {
    return {
      leftCell: left.length > 0 ? left : '\u00a0',
      rightCell: right.length > 0 ? right : '\u00a0',
    };
  }
  const ops = diffTokensToOps(tokenizeWordsAndSpaces(left), tokenizeWordsAndSpaces(right));
  const leftParts: ReactNode[] = [];
  const rightParts: ReactNode[] = [];
  let tokSeq = 0;
  for (const op of ops) {
    tokSeq += 1;
    if (op.type === 'equal') {
      leftParts.push(<span key={`eq-l-${tokSeq}`}>{op.token}</span>);
      rightParts.push(<span key={`eq-r-${tokSeq}`}>{op.token}</span>);
    } else if (op.type === 'delete') {
      leftParts.push(
        <span key={`del-l-${tokSeq}`} className="bg-red-500/40 rounded px-0.5">
          {op.token}
        </span>,
      );
      rightParts.push(
        <span key={`del-r-${tokSeq}`} className="select-none text-transparent" aria-hidden="true">
          {'\u00a0'}
        </span>,
      );
    } else {
      leftParts.push(
        <span
          key={`ins-l-${tokSeq}`}
          className="text-[var(--sc-text-muted)] select-none"
          aria-hidden="true"
        >
          ·
        </span>,
      );
      rightParts.push(
        <span key={`ins-r-${tokSeq}`} className="bg-green-500/40 rounded px-0.5">
          {op.token}
        </span>,
      );
    }
  }
  return { leftCell: <>{leftParts}</>, rightCell: <>{rightParts}</> };
}

const BranchBadge: FC<{ branch: VersionBranch; isActive?: boolean }> = ({ branch, isActive }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
      isActive
        ? 'bg-[var(--sc-accent)] text-white'
        : 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-secondary)]'
    }`}
  >
    <span
      aria-hidden="true"
      className="w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: branch.color }}
    />
    {branch.name}
  </span>
);

const SnapshotCard: FC<{
  snapshot: VersionSnapshot;
  branch: VersionBranch | undefined;
  onRestore: (snapshot: VersionSnapshot) => void;
  onDelete: (id: string) => void;
  onCompare?: (snapshot: VersionSnapshot) => void;
  isHead: boolean;
}> = ({ snapshot, branch, onRestore, onDelete, onCompare, isHead }) => {
  const { t } = useTranslation();
  return (
    <div
      className={`p-3 rounded-lg border transition-colors ${
        isHead
          ? 'border-[var(--border-interactive)] bg-[var(--sc-accent)]/5'
          : 'border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-[var(--sc-text-primary)] truncate">
              {snapshot.label}
            </span>
            {isHead && (
              <span className="px-1.5 py-0.5 text-xs bg-[var(--sc-accent)] text-white rounded">
                HEAD
              </span>
            )}
            {snapshot.sectionId ? (
              <span className="px-1.5 py-0.5 text-xs rounded-sc-sm bg-[var(--sc-warning-bg)] text-[var(--sc-warning-fg)]">
                {t('vc.scopeSection')}
              </span>
            ) : null}
            {branch && <BranchBadge branch={branch} />}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--sc-text-muted)]">
            <time>{new Date(snapshot.timestamp).toLocaleString()}</time>
            <span>
              {snapshot.wordCount.toLocaleString()} {t('vc.words')}
            </span>
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
          {onCompare ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCompare(snapshot)}
              aria-label={t('vc.compare')}
            >
              {t('vc.compare')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRestore(snapshot)}
            aria-label={t('vc.restoreSnapshot', { label: snapshot.label })}
          >
            {t('vc.restore')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(snapshot.id)}
            aria-label={t('vc.deleteSnapshot', { label: snapshot.label })}
            className="text-red-400 hover:bg-red-500/10"
          >
            ✕
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const VersionControlPanel: FC = () => {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const isOpen = useAppSelector(selectIsPanelOpen);
  const currentBranch = useAppSelector(selectCurrentBranch);
  const currentSnapshots = useAppSelector(selectCurrentBranchSnapshots);
  const allBranches = useAppSelector(selectAllBranches);
  const project = useAppSelector(selectProjectData);

  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchDesc, setNewBranchDesc] = useState('');
  const [fromSnapshotId, setFromSnapshotId] = useState<string | undefined>();
  const [modal, setModal] = useState<
    'none' | 'createSnapshot' | 'createBranch' | 'restore' | 'switchBranch'
  >('none');
  const [pendingRestore, setPendingRestore] = useState<VersionSnapshot | null>(null);
  const [compareTarget, setCompareTarget] = useState<VersionSnapshot | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modal !== 'none') return;
      dispatch(versionControlActions.closePanel());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, isOpen, modal]);

  const manuscript = useMemo(
    () => (Array.isArray(project?.manuscript) ? (project.manuscript as StorySection[]) : []),
    [project?.manuscript],
  );

  const compareBodies = useMemo(() => {
    if (!compareTarget) return { oldText: '', newText: '' };
    const sections = decompressManuscript(compareTarget.manuscriptSnapshot);
    if (compareTarget.sectionId) {
      const oldText = sections[0]?.content ?? '';
      const cur = manuscript.find((s) => s.id === compareTarget.sectionId);
      return { oldText, newText: cur?.content ?? '' };
    }
    const oldText = sections.map((s) => `## ${s.title}\n${s.content ?? ''}`).join('\n\n');
    const newText = manuscript.map((s) => `## ${s.title}\n${s.content ?? ''}`).join('\n\n');
    return { oldText, newText };
  }, [compareTarget, manuscript]);

  const diffLinesFull = useMemo(
    () => buildLineDiff(compareBodies.oldText, compareBodies.newText),
    [compareBodies.oldText, compareBodies.newText],
  );

  const diffViewTruncated = diffLinesFull.length > MAX_DIFF_VIEW_LINES;

  const diffLines = useMemo(
    () => (diffViewTruncated ? diffLinesFull.slice(0, MAX_DIFF_VIEW_LINES) : diffLinesFull),
    [diffLinesFull, diffViewTruncated],
  );

  const compareRenderedLines = useMemo(() => {
    const sid = compareTarget?.id ?? 'diff';
    let seq = 0;
    return diffLines.map((row) => {
      seq += 1;
      return {
        ...row,
        ...renderCompareLineWordCells(row.left, row.right, row.changed),
        rowDomKey: `${sid}-ln-${seq}`,
      };
    });
  }, [diffLines, compareTarget?.id]);

  const handleCompareSnapshot = useCallback((snapshot: VersionSnapshot) => {
    setCompareTarget(snapshot);
  }, []);

  const handleCreateSnapshot = useCallback(() => {
    if (!snapshotLabel.trim()) return;
    dispatch(
      versionControlActions.createSnapshot({
        label: snapshotLabel.trim(),
        sections: manuscript,
      }),
    );
    setSnapshotLabel('');
    setModal('none');
  }, [dispatch, snapshotLabel, manuscript]);

  const handleCreateBranch = useCallback(() => {
    if (!newBranchName.trim()) return;
    const payload: { name: string; description: string; fromSnapshotId?: string; switchTo: true } =
      {
        name: newBranchName.trim(),
        description: newBranchDesc.trim(),
        switchTo: true,
      };
    if (fromSnapshotId) {
      payload.fromSnapshotId = fromSnapshotId;
    }
    dispatch(versionControlActions.createBranch(payload));
    setNewBranchName('');
    setNewBranchDesc('');
    setFromSnapshotId(undefined);
    setModal('none');
  }, [dispatch, newBranchName, newBranchDesc, fromSnapshotId]);

  const handleRestore = useCallback((snapshot: VersionSnapshot) => {
    setPendingRestore(snapshot);
    setModal('restore');
  }, []);

  const confirmRestore = useCallback(() => {
    if (!pendingRestore) return;
    const sections = decompressManuscript(pendingRestore.manuscriptSnapshot);
    if (pendingRestore.sectionId) {
      const patch = sections[0];
      if (patch) {
        dispatch(
          projectActions.updateManuscriptSection({
            id: pendingRestore.sectionId,
            changes: partialStorySectionFromSnapshot(patch),
          }),
        );
      }
    } else {
      dispatch(projectActions.setManuscript(sections));
    }
    dispatch(versionControlActions.closePanel());
    setPendingRestore(null);
    setModal('none');
  }, [dispatch, pendingRestore]);

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      dispatch(versionControlActions.deleteSnapshot(id));
    },
    [dispatch],
  );

  const handleDeleteBranch = useCallback(
    (id: string) => {
      if (id === MAIN_BRANCH_ID) return;
      dispatch(versionControlActions.deleteBranch(id));
    },
    [dispatch],
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[var(--sc-backdrop-strong)] z-40"
        onClick={() => dispatch(versionControlActions.closePanel())}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--sc-surface-base)] border-l border-[var(--sc-border-subtle)] shadow-2xl z-50 flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-control-heading"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--sc-border-subtle)]">
          <div className="flex items-center gap-3">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-[var(--sc-text-secondary)]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
              />
            </svg>
            <h2
              id="version-control-heading"
              className="text-lg font-bold text-[var(--sc-text-primary)]"
            >
              {t('vc.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dispatch(versionControlActions.closePanel())}
            className="p-2 rounded-md hover:bg-[var(--sc-surface-raised)] text-[var(--sc-text-secondary)] transition-colors"
            aria-label={t('vc.close')}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Current branch */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)] mb-3">
              {t('vc.currentBranch')}
            </h3>
            {currentBranch && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)]">
                <BranchBadge branch={currentBranch} isActive />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal('switchBranch')}
                    aria-label={t('vc.switchBranch')}
                  >
                    {t('vc.switch')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFromSnapshotId(currentBranch.headSnapshotId);
                      setModal('createBranch');
                    }}
                    aria-label={t('vc.createBranch')}
                  >
                    {t('vc.newBranch')}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Snapshots */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)]">
                {t('vc.snapshots')} ({currentSnapshots.length})
              </h3>
              <Button
                size="sm"
                onClick={() => setModal('createSnapshot')}
                aria-label={t('vc.createSnapshot')}
              >
                {t('vc.newSnapshot')}
              </Button>
            </div>
            {currentSnapshots.length === 0 ? (
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
                      d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                    />
                  </svg>
                }
                title={t('vc.noSnapshots')}
                description={t('vc.noSnapshotsHint')}
              />
            ) : (
              <div className="space-y-2">
                {currentSnapshots.map((snap) => {
                  const branch = allBranches.find((b) => b.id === snap.branchId);
                  const isHead = currentBranch?.headSnapshotId === snap.id;
                  return (
                    <SnapshotCard
                      key={snap.id}
                      snapshot={snap}
                      branch={branch}
                      onRestore={handleRestore}
                      onDelete={handleDeleteSnapshot}
                      onCompare={handleCompareSnapshot}
                      isHead={isHead}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* All branches */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)] mb-3">
              {t('vc.allBranches')} ({allBranches.length})
            </h3>
            <div className="space-y-2">
              {allBranches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--sc-surface-raised)] border border-[var(--sc-border-subtle)]"
                >
                  <div>
                    <BranchBadge branch={branch} isActive={branch.id === currentBranch?.id} />
                    {branch.description && (
                      <p className="text-xs text-[var(--sc-text-muted)] mt-1">
                        {branch.description}
                      </p>
                    )}
                    <p className="text-xs text-[var(--sc-text-muted)] mt-0.5">
                      {t('vc.created')}: {new Date(branch.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {branch.id !== currentBranch?.id && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => dispatch(versionControlActions.switchBranch(branch.id))}
                      >
                        {t('vc.switch')}
                      </Button>
                    )}
                    {branch.id !== MAIN_BRANCH_ID && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteBranch(branch.id)}
                        className="text-red-400 hover:bg-red-500/10"
                        aria-label={t('vc.deleteBranch', { name: branch.name })}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>

      {/* Modal: Create Snapshot */}
      <Modal
        isOpen={modal === 'createSnapshot'}
        onClose={() => setModal('none')}
        title={t('vc.createSnapshotTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('vc.createSnapshotDescription')}
          </p>
          {/* QNBS-v3: data-testid lets Playwright target this input without relying on translatable placeholder text */}
          <Input
            data-testid="snapshot-label-input"
            placeholder={t('vc.snapshotPlaceholder')}
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateSnapshot()}
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setModal('none')}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateSnapshot} disabled={!snapshotLabel.trim()}>
              {t('vc.createSnapshotTitle')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Create Branch */}
      <Modal
        isOpen={modal === 'createBranch'}
        onClose={() => setModal('none')}
        title={t('vc.createBranchTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('vc.createBranchDescription')}
          </p>
          <Input
            placeholder={t('vc.branchNamePlaceholder')}
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            autoFocus
          />
          <Input
            placeholder={t('vc.branchDescPlaceholder')}
            value={newBranchDesc}
            onChange={(e) => setNewBranchDesc(e.target.value)}
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setModal('none')}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
              {t('vc.createBranchTitle')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Restore Snapshot */}
      <Modal
        isOpen={modal === 'restore'}
        onClose={() => {
          setModal('none');
          setPendingRestore(null);
        }}
        title={t('vc.restoreTitle')}
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--sc-text-secondary)]">
            {t('vc.restoreDescription')}{' '}
            <strong className="text-[var(--sc-text-primary)]">„{pendingRestore?.label}“</strong> (
            {pendingRestore && new Date(pendingRestore.timestamp).toLocaleString()})
          </p>
          <p className="text-sm text-amber-400">⚠️ {t('vc.restoreWarning')}</p>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setModal('none');
                setPendingRestore(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={confirmRestore}>
              {t('vc.restore')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Switch Branch */}
      <Modal
        isOpen={modal === 'switchBranch'}
        onClose={() => setModal('none')}
        title={t('vc.switchBranchTitle')}
      >
        <div className="space-y-3">
          {allBranches.map((branch) => (
            <button
              type="button"
              key={branch.id}
              onClick={() => {
                dispatch(versionControlActions.switchBranch(branch.id));
                setModal('none');
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                branch.id === currentBranch?.id
                  ? 'border-[var(--border-interactive)] bg-[var(--sc-accent)]/5'
                  : 'border-[var(--sc-border-subtle)] hover:border-[var(--sc-border-strong)]'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: branch.color }}
              />
              <div>
                <p className="font-semibold text-sm text-[var(--sc-text-primary)]">{branch.name}</p>
                {branch.description && (
                  <p className="text-xs text-[var(--sc-text-muted)]">{branch.description}</p>
                )}
              </div>
              {branch.id === currentBranch?.id && (
                <span className="ml-auto text-xs text-[var(--sc-text-muted)]">
                  {t('vc.active')}
                </span>
              )}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        isOpen={compareTarget !== null}
        onClose={() => setCompareTarget(null)}
        title={t('vc.compareTitle')}
      >
        <p className="text-xs text-[var(--sc-text-muted)] mb-2">
          {t('vc.compareHint')} {t('vc.compareWordHint')}
        </p>
        {diffViewTruncated ? (
          <p className="text-xs text-[var(--sc-warning-fg)] mb-2" role="status">
            {t('vc.compareTruncated', {
              shown: String(MAX_DIFF_VIEW_LINES),
              total: String(diffLinesFull.length),
            })}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 max-h-[min(70vh,520px)] overflow-auto rounded border border-[var(--sc-border-subtle)] p-2 contain-content">
          <div>
            <div className="font-semibold text-xs mb-1 text-[var(--sc-text-secondary)]">
              {t('vc.compareSnapshotColumn')}
            </div>
            <div className="font-mono text-xs whitespace-pre-wrap break-words space-y-px">
              {compareRenderedLines.map((row) => (
                <div
                  key={`${row.rowDomKey}-L`}
                  className={row.changed ? 'bg-red-500/15 px-0.5 rounded-sm' : undefined}
                >
                  {row.leftCell}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="font-semibold text-xs mb-1 text-[var(--sc-text-secondary)]">
              {t('vc.compareCurrentColumn')}
            </div>
            <div className="font-mono text-xs whitespace-pre-wrap break-words space-y-px">
              {compareRenderedLines.map((row) => (
                <div
                  key={`${row.rowDomKey}-R`}
                  className={row.changed ? 'bg-green-500/15 px-0.5 rounded-sm' : undefined}
                >
                  {row.rightCell}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};
