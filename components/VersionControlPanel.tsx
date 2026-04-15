import type { FC } from 'react';
import React, { useState, useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import {
  versionControlActions,
  selectCurrentBranch,
  selectCurrentBranchSnapshots,
  selectAllBranches,
  selectIsPanelOpen,
  decompressManuscript,
  MAIN_BRANCH_ID,
} from '../features/versionControl/versionControlSlice';
import { projectActions } from '../features/project/projectSlice';
import { selectProjectData } from '../features/project/projectSelectors';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import type { VersionBranch, VersionSnapshot, StorySection } from '../types';

// ─── Helper Components ────────────────────────────────────────────────────────

const BranchBadge: FC<{ branch: VersionBranch; isActive?: boolean }> = ({ branch, isActive }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
      isActive
        ? 'bg-[var(--background-interactive)] text-white'
        : 'bg-[var(--background-tertiary)] text-[var(--foreground-secondary)]'
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
  isHead: boolean;
}> = ({ snapshot, branch, onRestore, onDelete, isHead }) => (
  <div
    className={`p-3 rounded-lg border transition-colors ${
      isHead
        ? 'border-[var(--border-interactive)] bg-[var(--background-interactive)]/5'
        : 'border-[var(--border-primary)] bg-[var(--background-secondary)]/50'
    }`}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[var(--foreground-primary)] truncate">
            {snapshot.label}
          </span>
          {isHead && (
            <span className="px-1.5 py-0.5 text-xs bg-[var(--background-interactive)] text-white rounded">
              HEAD
            </span>
          )}
          {branch && <BranchBadge branch={branch} />}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--foreground-muted)]">
          <time>{new Date(snapshot.timestamp).toLocaleString('de-DE')}</time>
          <span>{snapshot.wordCount.toLocaleString()} Wörter</span>
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRestore(snapshot)}
          aria-label={`Snapshot "${snapshot.label}" wiederherstellen`}
        >
          Wiederherstellen
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(snapshot.id)}
          aria-label={`Snapshot "${snapshot.label}" löschen`}
          className="text-red-400 hover:bg-red-500/10"
        >
          ✕
        </Button>
      </div>
    </div>
  </div>
);

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const VersionControlPanel: FC = () => {
  const dispatch = useAppDispatch();
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

  const manuscript = useMemo(
    () => (Array.isArray(project?.manuscript) ? (project.manuscript as StorySection[]) : []),
    [project?.manuscript]
  );

  const handleCreateSnapshot = useCallback(() => {
    if (!snapshotLabel.trim()) return;
    dispatch(
      versionControlActions.createSnapshot({
        label: snapshotLabel.trim(),
        sections: manuscript,
      })
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
    // Restore by setting all sections via Redux
    sections.forEach((section, idx) => {
      if (idx === 0) {
        // Update the first section to trigger re-render
        dispatch(
          projectActions.updateManuscriptSection({
            id: section.id,
            changes: { content: section.content },
          })
        );
      }
    });
    // Full manuscript restore
    dispatch(projectActions.setManuscript(sections));
    dispatch(versionControlActions.closePanel());
    setPendingRestore(null);
    setModal('none');
  }, [dispatch, pendingRestore]);

  const handleDeleteSnapshot = useCallback(
    (id: string) => {
      dispatch(versionControlActions.deleteSnapshot(id));
    },
    [dispatch]
  );

  const handleDeleteBranch = useCallback(
    (id: string) => {
      if (id === MAIN_BRANCH_ID) return;
      dispatch(versionControlActions.deleteBranch(id));
    },
    [dispatch]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={() => dispatch(versionControlActions.closePanel())}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--background-primary)] border-l border-[var(--border-primary)] shadow-2xl z-50 flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-control-heading"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-5 h-5 text-[var(--foreground-secondary)]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
              />
            </svg>
            <h2
              id="version-control-heading"
              className="text-lg font-bold text-[var(--foreground-primary)]"
            >
              Versionsverlauf
            </h2>
          </div>
          <button
            onClick={() => dispatch(versionControlActions.closePanel())}
            className="p-2 rounded-md hover:bg-[var(--background-secondary)] text-[var(--foreground-secondary)] transition-colors"
            aria-label="Versionsverlauf schließen"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Current branch */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Aktueller Branch
            </h3>
            {currentBranch && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-primary)]">
                <BranchBadge branch={currentBranch} isActive />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setModal('switchBranch')}
                    aria-label="Branch wechseln"
                  >
                    Wechseln
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFromSnapshotId(currentBranch.headSnapshotId);
                      setModal('createBranch');
                    }}
                    aria-label="Neuen Branch erstellen"
                  >
                    + Branch
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* Snapshots */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
                Snapshots ({currentSnapshots.length})
              </h3>
              <Button
                size="sm"
                onClick={() => setModal('createSnapshot')}
                aria-label="Neuen Snapshot erstellen"
              >
                + Snapshot
              </Button>
            </div>
            {currentSnapshots.length === 0 ? (
              <div className="text-center py-8 text-[var(--foreground-muted)] text-sm border-2 border-dashed border-[var(--border-primary)] rounded-lg">
                <p>Noch keine Snapshots.</p>
                <p className="text-xs mt-1">
                  Erstelle einen Snapshot, um den aktuellen Stand zu speichern.
                </p>
              </div>
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
                      isHead={isHead}
                    />
                  );
                })}
              </div>
            )}
          </section>

          {/* All branches */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)] mb-3">
              Alle Branches ({allBranches.length})
            </h3>
            <div className="space-y-2">
              {allBranches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-primary)]"
                >
                  <div>
                    <BranchBadge branch={branch} isActive={branch.id === currentBranch?.id} />
                    {branch.description && (
                      <p className="text-xs text-[var(--foreground-muted)] mt-1">
                        {branch.description}
                      </p>
                    )}
                    <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                      Erstellt: {new Date(branch.createdAt).toLocaleDateString('de-DE')}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {branch.id !== currentBranch?.id && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => dispatch(versionControlActions.switchBranch(branch.id))}
                      >
                        Wechseln
                      </Button>
                    )}
                    {branch.id !== MAIN_BRANCH_ID && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteBranch(branch.id)}
                        className="text-red-400 hover:bg-red-500/10"
                        aria-label={`Branch "${branch.name}" löschen`}
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
        title="Snapshot erstellen"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--foreground-secondary)]">
            Speichert den aktuellen Stand des Manuskripts als wiederherstellbaren Snapshot.
          </p>
          <Input
            placeholder="z.B. Vor dem großen Twist"
            value={snapshotLabel}
            onChange={(e) => setSnapshotLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateSnapshot()}
            autoFocus
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setModal('none')}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateSnapshot} disabled={!snapshotLabel.trim()}>
              Snapshot erstellen
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Create Branch */}
      <Modal
        isOpen={modal === 'createBranch'}
        onClose={() => setModal('none')}
        title="Neuen Branch erstellen"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--foreground-secondary)]">
            Branches erlauben alternative Handlungsverläufe (z.B. „Alternatives Ende").
          </p>
          <Input
            placeholder="Branch-Name, z.B. Alternatives Ende"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            autoFocus
          />
          <Input
            placeholder="Beschreibung (optional)"
            value={newBranchDesc}
            onChange={(e) => setNewBranchDesc(e.target.value)}
          />
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setModal('none')}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
              Branch erstellen
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
        title="Snapshot wiederherstellen"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--foreground-secondary)]">
            Das Manuskript wird auf den Snapshot{' '}
            <strong className="text-[var(--foreground-primary)]">„{pendingRestore?.label}"</strong>{' '}
            ({pendingRestore && new Date(pendingRestore.timestamp).toLocaleString('de-DE')})
            zurückgesetzt.
          </p>
          <p className="text-sm text-amber-400">
            ⚠️ Der aktuelle Stand geht verloren, sofern kein Snapshot existiert. Erstelle vorher
            einen Snapshot!
          </p>
          <div className="flex gap-3 justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setModal('none');
                setPendingRestore(null);
              }}
            >
              Abbrechen
            </Button>
            <Button variant="danger" onClick={confirmRestore}>
              Wiederherstellen
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Switch Branch */}
      <Modal
        isOpen={modal === 'switchBranch'}
        onClose={() => setModal('none')}
        title="Branch wechseln"
      >
        <div className="space-y-3">
          {allBranches.map((branch) => (
            <button
              key={branch.id}
              onClick={() => {
                dispatch(versionControlActions.switchBranch(branch.id));
                setModal('none');
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                branch.id === currentBranch?.id
                  ? 'border-[var(--border-interactive)] bg-[var(--background-interactive)]/5'
                  : 'border-[var(--border-primary)] hover:border-[var(--border-highlight)]'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: branch.color }}
              />
              <div>
                <p className="font-semibold text-sm text-[var(--foreground-primary)]">
                  {branch.name}
                </p>
                {branch.description && (
                  <p className="text-xs text-[var(--foreground-muted)]">{branch.description}</p>
                )}
              </div>
              {branch.id === currentBranch?.id && (
                <span className="ml-auto text-xs text-[var(--foreground-muted)]">Aktiv</span>
              )}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
};
