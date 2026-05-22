import React from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { ICONS } from '../../constants';
import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import { projectActions } from '../../features/project/projectSlice';
import { partialStorySectionFromSnapshot } from '../../features/project/sectionRestoreHelpers';
import {
  decompressManuscript,
  selectCurrentBranchSnapshots,
  versionControlActions,
} from '../../features/versionControl/versionControlSlice';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { DebouncedInput } from '../ui/DebouncedInput';
import { DebouncedTextarea } from '../ui/DebouncedTextarea';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

// QNBS-v3: Extracted from ManuscriptView.tsx to keep that file under 700-line limit.
export const InspectorPanel = React.memo(() => {
  const dispatch = useAppDispatch();
  const {
    t,
    project,
    manuscript,
    activeSectionId,
    activeSection,
    activeSectionStats,
    isLoglineModalOpen,
    setIsLoglineModalOpen,
    loglineSuggestions,
    isAiLoading,
    handleGenerateLoglines,
    selectLogline,
    isProofreading,
    handleProofread,
    proofreadSuggestions,
    applyProofreadSuggestion,
    isSceneVisualizing,
    handleVisualizeScene,
    sceneImagePreviewUrl,
  } = useManuscriptViewContext();
  const sectionSnapshots = useAppSelector((state) =>
    activeSectionId
      ? selectCurrentBranchSnapshots(state).filter((s) => s.sectionId === activeSectionId)
      : [],
  );
  const inspectorAiBusy = isAiLoading || isProofreading || isSceneVisualizing;

  return (
    <>
      {/* QNBS-v3: Inspector-KI-Zustände für SR mit aria-busy + kurzer Live-Status (Abschluss nur bei verbose/normal über announce). */}
      <section
        className="space-y-4 p-4"
        aria-label={t('manuscript.inspector.regionAriaLabel')}
        aria-busy={inspectorAiBusy}
      >
        {inspectorAiBusy ? (
          <p className="sr-only" aria-live="polite">
            {t('manuscript.inspector.aiWorkingStatus')}
          </p>
        ) : null}
        <div>
          <label
            htmlFor="projectTitle"
            className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-2"
          >
            {t('dashboard.details.projectTitle')}
          </label>
          <DebouncedInput
            id="projectTitle"
            value={project.title}
            onDebouncedChange={(value) => dispatch(projectActions.updateTitle(value))}
            placeholder={t('dashboard.details.projectTitlePlaceholder')}
          />
        </div>
        <div>
          <label
            htmlFor="projectLogline"
            className="block text-sm font-medium text-[var(--sc-text-secondary)] mb-2"
          >
            {t('dashboard.details.logline')}
          </label>
          <DebouncedTextarea
            id="projectLogline"
            value={project.logline}
            onDebouncedChange={(value) => dispatch(projectActions.updateLogline(value))}
            placeholder={t('dashboard.details.loglinePlaceholder')}
            rows={3}
          />
          {/* QNBS-v3: Use sc-accent token — dark: prefix bypasses body-class theming and breaks appearance presets. */}
          <Button
            onClick={handleGenerateLoglines}
            disabled={isAiLoading}
            variant="ghost"
            className="text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/10 mt-2 p-2 w-full justify-start"
          >
            {isAiLoading ? (
              <Spinner className="mr-2" />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-5 h-5 mr-2"
                aria-hidden="true"
              >
                {ICONS.SPARKLES}
              </svg>
            )}
            {t('dashboard.details.aiLoglineButton')}
          </Button>
        </div>
        <Card>
          <CardHeader className="flex justify-between items-center">
            <h3 className="text-base font-semibold">{t('manuscript.inspector.statsTitle')}</h3>
          </CardHeader>
          <CardContent className="text-sm space-y-3">
            <div className="flex justify-between border-b border-[var(--sc-border-subtle)]/50 pb-2">
              <span>{t('dashboard.stats.totalWordCount')}</span>
              <span className="font-bold">{activeSectionStats.wordCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between border-b border-[var(--sc-border-subtle)]/50 pb-2">
              <span>{t('manuscript.inspector.charCount')}</span>
              <span className="font-bold">{activeSectionStats.charCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('manuscript.inspector.readTime')}</span>
              <span className="font-bold">
                {t('manuscript.inspector.readTimeValue', {
                  time: String(activeSectionStats.readTime),
                })}
              </span>
            </div>
          </CardContent>
        </Card>
        {activeSection ? (
          <Card>
            <CardHeader className="flex justify-between items-center pb-2">
              <h3 className="text-base font-semibold">{t('manuscript.sectionHistory.title')}</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() =>
                  dispatch(
                    versionControlActions.createSnapshot({
                      label: t('manuscript.sectionHistory.snapshotLabel', {
                        title: activeSection.title,
                      }),
                      sections: manuscript,
                      sectionId: activeSection.id,
                    }),
                  )
                }
              >
                {t('manuscript.sectionHistory.saveSnapshot')}
              </Button>
              {sectionSnapshots.length === 0 ? (
                <p className="text-xs text-[var(--sc-text-muted)]">
                  {t('manuscript.sectionHistory.empty')}
                </p>
              ) : (
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {sectionSnapshots.map((snap) => (
                    <li
                      key={snap.id}
                      className="flex flex-col gap-1 rounded border border-[var(--sc-border-subtle)] p-2"
                    >
                      <span className="font-medium truncate">{snap.label}</span>
                      <time className="text-xs text-[var(--sc-text-muted)]">
                        {new Date(snap.timestamp).toLocaleString()}
                      </time>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="self-start h-7 text-xs"
                        onClick={() => {
                          const sections = decompressManuscript(snap.manuscriptSnapshot);
                          const patch = sections[0];
                          if (patch && activeSectionId) {
                            dispatch(
                              projectActions.updateManuscriptSection({
                                id: activeSectionId,
                                changes: partialStorySectionFromSnapshot(patch),
                              }),
                            );
                          }
                        }}
                      >
                        {t('manuscript.sectionHistory.restore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader className="flex justify-between items-center pb-2">
            <h3 className="text-base font-semibold">{t('manuscript.visualize.title')}</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* QNBS-v3: Use sc-accent token — dark: prefix bypasses body-class theming. */}
            <Button
              type="button"
              onClick={handleVisualizeScene}
              disabled={isSceneVisualizing || !activeSection?.content?.trim()}
              variant="ghost"
              className="w-full justify-start text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/10 p-2"
            >
              {isSceneVisualizing ? (
                <Spinner className="mr-2" />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3A1.5 1.5 0 001.5 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008H15V10.5z"
                  />
                </svg>
              )}
              {t('manuscript.visualize.button')}
            </Button>
            <p className="text-xs text-[var(--sc-text-muted)]">{t('manuscript.visualize.hint')}</p>
            {sceneImagePreviewUrl ? (
              <img
                src={sceneImagePreviewUrl}
                alt=""
                className="w-full rounded-lg border border-[var(--sc-border-subtle)] max-h-64 object-contain bg-black/20"
              />
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex justify-between items-center pb-2">
            <h3 className="text-base font-semibold">AI Proofreader</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleProofread} disabled={isProofreading} className="w-full">
              {isProofreading ? (
                <Spinner />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-5 h-5 mr-2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
              {t('manuscript.grammar.checkButton')}
            </Button>
            {proofreadSuggestions.length > 0 && (
              <div className="space-y-2 mt-4 max-h-60 overflow-y-auto pr-1">
                {proofreadSuggestions.map((suggestion, idx) => (
                  <div
                    key={`${suggestion.original}-${suggestion.suggestion}`}
                    className="p-3 bg-[var(--sc-surface-raised)] rounded-md border border-[var(--sc-border-subtle)] text-sm"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-red-400 line-through mr-2 opacity-70">
                        {suggestion.original}
                      </span>
                      <span className="text-green-400 font-semibold">{suggestion.suggestion}</span>
                    </div>
                    <p className="text-[var(--sc-text-muted)] text-xs mb-2">
                      {suggestion.explanation}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => applyProofreadSuggestion(idx)}
                      className="w-full text-xs h-7"
                    >
                      {t('manuscript.spellcheck.applyFix')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      <Modal
        isOpen={isLoglineModalOpen}
        onClose={() => setIsLoglineModalOpen(false)}
        title={t('dashboard.loglineModal.title')}
      >
        {isAiLoading && (
          <div className="flex flex-col items-center justify-center min-h-[200px]">
            <Spinner className="w-8 h-8" />
            <p className="mt-4 text-[var(--sc-text-secondary)]">
              {t('dashboard.loglineModal.loading')}
            </p>
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length > 0 && (
          <div className="space-y-3">
            {loglineSuggestions.map((line) => (
              <Card
                as="button"
                key={line}
                className="hover:bg-[var(--sc-surface-overlay)] transition-colors cursor-pointer w-full text-left"
                onClick={() => selectLogline(line)}
              >
                <CardContent className="p-4">
                  <p className="text-[var(--sc-text-secondary)]">{line}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length === 0 && (
          <div className="text-center text-red-400 min-h-[200px] flex items-center justify-center">
            <p>{t('outline.error.generationFailed')}</p>
          </div>
        )}
      </Modal>
    </>
  );
});
InspectorPanel.displayName = 'InspectorPanel';
