import type { FC } from 'react';
import React, { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { ICONS } from '../constants';
import { ManuscriptViewContext, useManuscriptViewContext } from '../contexts/ManuscriptViewContext';
import { selectEnableBinderResearch } from '../features/featureFlags/featureFlagsSlice';
import { projectActions } from '../features/project/projectSlice';
import { partialStorySectionFromSnapshot } from '../features/project/sectionRestoreHelpers';
import {
  decompressManuscript,
  selectCurrentBranchSnapshots,
  versionControlActions,
} from '../features/versionControl/versionControlSlice';
import { useManuscriptView } from '../hooks/useManuscriptView';
import { useResizablePanels } from '../hooks/useResizablePanels';
import { BinderPanel } from './BinderPanel';
import { ManuscriptResearchSplit } from './ManuscriptResearchSplit';
import { ManuscriptEditor } from './manuscript/ManuscriptEditor';
import { StoryNavigator } from './manuscript/NavigatorPanel';
import { Resizer } from './manuscript/ResizeHandle';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { DebouncedInput } from './ui/DebouncedInput';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Modal } from './ui/Modal';
import { SectionIcon } from './ui/SectionIcon';
import { Spinner } from './ui/Spinner';

const InspectorPanel: FC = React.memo(() => {
  const {
    t,
    project,
    dispatch,
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
          <Button
            onClick={handleGenerateLoglines}
            disabled={isAiLoading}
            variant="ghost"
            className="text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 dark:hover:bg-indigo-900/80 mt-2 p-2 w-full justify-start"
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
            <Button
              type="button"
              onClick={handleVisualizeScene}
              disabled={isSceneVisualizing || !activeSection?.content?.trim()}
              variant="ghost"
              className="w-full justify-start text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10 dark:hover:bg-indigo-900/80 p-2"
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

const ManuscriptViewUI: FC = () => {
  const dispatch = useAppDispatch();
  const { project, activeSection, t } = useManuscriptViewContext();
  const enableBinder = useAppSelector(selectEnableBinderResearch);
  const manuscriptResearchSplitOpen = useTransientUiStore((s) => s.manuscriptResearchSplitOpen);
  const manuscriptPinnedBinderNodeId = useTransientUiStore((s) => s.manuscriptPinnedBinderNodeId);
  const setManuscriptResearchSplitOpen = useTransientUiStore(
    (s) => s.setManuscriptResearchSplitOpen,
  );
  const [leftNavTab, setLeftNavTab] = useState<'chapters' | 'binder'>('chapters');
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isInspectorDrawerOpen, setIsInspectorDrawerOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const {
    leftPanelWidth,
    rightPanelWidth,
    startLeftResize,
    startRightResize,
    setLeftPanelWidth,
    setRightPanelWidth,
  } = useResizablePanels(20, 20);

  useEffect(() => {
    if (!manuscriptResearchSplitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManuscriptResearchSplitOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manuscriptResearchSplitOpen, setManuscriptResearchSplitOpen]);

  if (!project) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );
  }

  if (project.manuscript.length === 0) {
    return (
      <EmptyState
        title={t('empty.manuscript.title')}
        description={t('empty.manuscript.description')}
        primaryAction={{
          label: t('manuscript.addSection'),
          onClick: () =>
            dispatch(
              projectActions.addManuscriptSection({ title: t('outline.result.newSectionTitle') }),
            ),
        }}
      />
    );
  }

  const projectStorageId = project.id && project.id.length > 0 ? project.id : 'browser-project';
  const pinnedBinderNode = project.binderNodes?.find((n) => n.id === manuscriptPinnedBinderNodeId);

  return (
    <div className="h-full flex flex-col">
      {/* Mobile Header */}
      <header className="md:hidden flex-shrink-0 flex justify-between items-center p-2 mb-2 bg-[var(--sc-surface-raised)]/80 backdrop-blur-md border-b border-[var(--sc-border-subtle)] sticky top-0 z-20">
        <div className="flex items-center gap-1 flex-shrink-0">
          {enableBinder ? (
            <>
              <Button
                type="button"
                variant={leftNavTab === 'chapters' ? 'secondary' : 'ghost'}
                onClick={() => setLeftNavTab('chapters')}
                size="sm"
                className="px-2 min-w-[2.5rem]"
                aria-pressed={leftNavTab === 'chapters'}
                aria-label={t('manuscript.navigator.title')}
              >
                {t('manuscript.leftPanel.mobileChapters')}
              </Button>
              <Button
                type="button"
                variant={leftNavTab === 'binder' ? 'secondary' : 'ghost'}
                onClick={() => setLeftNavTab('binder')}
                size="sm"
                className="px-2 min-w-[2.5rem]"
                aria-pressed={leftNavTab === 'binder'}
                aria-label={t('manuscript.binder.tab')}
              >
                {t('manuscript.leftPanel.mobileBinder')}
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => setIsNavDrawerOpen(true)}
            size="sm"
            className="-ml-1"
            aria-label={t('manuscript.leftPanel.openDrawer')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
              />
            </svg>
          </Button>
        </div>
        <h1 className="text-sm font-bold truncate px-2 text-center flex-grow text-[var(--sc-text-primary)]">
          {activeSection?.title || project.title}
        </h1>
        <Button
          variant="ghost"
          onClick={() => setIsInspectorDrawerOpen(true)}
          size="sm"
          className="-mr-1"
          aria-label={t('manuscript.inspector.title')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
            />
          </svg>
        </Button>
      </header>

      {/* Desktop Toolbar - Focus Toggle */}
      <div className="hidden md:flex justify-end px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsFocusMode(!isFocusMode)}
          className={`transition-colors ${isFocusMode ? 'text-[var(--sc-accent)] bg-[var(--sc-accent)]/10' : 'text-[var(--sc-text-muted)]'}`}
          title={isFocusMode ? t('manuscript.zenMode.exit') : t('manuscript.zenMode.enter')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 mr-2"
          >
            {isFocusMode ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
              />
            )}
          </svg>
          {isFocusMode ? t('manuscript.zenMode.exit') : t('manuscript.zenMode.label')}
        </Button>
      </div>

      {/* Main Content Area */}
      <main className="flex-grow min-h-0 hidden md:flex md:flex-row relative">
        {/* Desktop Navigator */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-r border-[var(--sc-border-subtle)]'}`}
          style={{ width: isFocusMode ? 0 : `${leftPanelWidth}%` }}
        >
          <Card className="h-full flex flex-col rounded-none border-0 shadow-none">
            <CardHeader className="py-3 min-h-[50px]">
              {enableBinder ? (
                <div
                  className="flex rounded-lg border border-[var(--sc-border-subtle)] p-0.5 gap-0.5"
                  role="tablist"
                  aria-label={t('manuscript.leftPanel.tabsAria')}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftNavTab === 'chapters'}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                      leftNavTab === 'chapters'
                        ? 'bg-[var(--sc-accent)] text-white'
                        : 'text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-overlay)]'
                    }`}
                    onClick={() => setLeftNavTab('chapters')}
                  >
                    {t('manuscript.navigator.title')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftNavTab === 'binder'}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                      leftNavTab === 'binder'
                        ? 'bg-[var(--sc-accent)] text-white'
                        : 'text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-overlay)]'
                    }`}
                    onClick={() => setLeftNavTab('binder')}
                  >
                    {t('manuscript.binder.tab')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* QNBS-v3: manuscript section icon from SSOT */}
                  <SectionIcon section="manuscript" size="xs" />
                  <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--sc-text-muted)]">
                    {t('manuscript.navigator.title')}
                  </h2>
                </div>
              )}
            </CardHeader>
            <div className="flex-grow overflow-y-auto min-h-0">
              {enableBinder && leftNavTab === 'binder' ? <BinderPanel /> : <StoryNavigator />}
            </div>
          </Card>
        </div>

        {!isFocusMode && (
          <Resizer
            onPointerDown={startLeftResize}
            onKeyAdjust={(delta) => setLeftPanelWidth((w) => Math.max(15, Math.min(50, w + delta)))}
            label={t('manuscript.resizer.left')}
            value={leftPanelWidth}
          />
        )}

        {/* Editor + optional research split */}
        <Card
          className={`h-full flex-grow p-0 rounded-none border-0 shadow-none z-0 bg-[var(--sc-surface-base)] transition-all duration-500 ease-sc-emphasized flex flex-col min-w-0 ${
            isFocusMode
              ? 'manuscript-zen-active rounded-sc-lg shadow-sc-lg ring-1 ring-[var(--sc-border-subtle)]'
              : ''
          }`}
        >
          <div className="flex h-full min-h-0 w-full flex-1">
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              <ManuscriptEditor isFocusMode={isFocusMode} />
            </div>
            {manuscriptResearchSplitOpen && enableBinder ? (
              <ManuscriptResearchSplit
                projectId={projectStorageId}
                node={pinnedBinderNode}
                onClose={() => setManuscriptResearchSplitOpen(false)}
              />
            ) : null}
          </div>
        </Card>

        {!isFocusMode && (
          <Resizer
            onPointerDown={startRightResize}
            onKeyAdjust={(delta) =>
              setRightPanelWidth((w) => Math.max(15, Math.min(50, w + delta)))
            }
            label={t('manuscript.resizer.right')}
            value={rightPanelWidth}
          />
        )}

        {/* Desktop Inspector */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-l border-[var(--sc-border-subtle)]'}`}
          style={{ width: isFocusMode ? 0 : `${rightPanelWidth}%` }}
        >
          <Card className="h-full flex flex-col rounded-none border-0 shadow-none">
            <CardHeader className="py-3 min-h-[50px]">
              <div className="flex items-center gap-2">
                <SectionIcon section="manuscript" size="xs" />
                <h2 className="font-semibold text-sm uppercase tracking-wide text-[var(--sc-text-muted)]">
                  {t('manuscript.inspector.title')}
                </h2>
              </div>
            </CardHeader>
            <div className="flex-grow overflow-y-auto">
              <InspectorPanel />
            </div>
          </Card>
        </div>
      </main>

      {/* Mobile Editor (takes full space) */}
      <main className="flex-grow min-h-0 md:hidden bg-[var(--sc-surface-raised)] overflow-hidden relative">
        <ManuscriptEditor isFocusMode={false} />
      </main>

      {/* Mobile Drawers */}
      <Drawer
        isOpen={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        title={
          enableBinder && leftNavTab === 'binder'
            ? t('manuscript.binder.tab')
            : t('manuscript.navigator.title')
        }
        position="left"
      >
        {enableBinder && leftNavTab === 'binder' ? (
          <BinderPanel />
        ) : (
          <StoryNavigator onSectionSelect={() => setIsNavDrawerOpen(false)} />
        )}
      </Drawer>
      <Drawer
        isOpen={isInspectorDrawerOpen}
        onClose={() => setIsInspectorDrawerOpen(false)}
        title={t('manuscript.inspector.title')}
        position="right"
      >
        <InspectorPanel />
      </Drawer>
    </div>
  );
};

export const ManuscriptView: React.FC = () => {
  // The useManuscriptView hook requires an onNavigate prop. Since this view does not navigate, passing an empty function.
  const contextValue = useManuscriptView({ onNavigate: () => {} });
  return (
    <ManuscriptViewContext.Provider value={contextValue}>
      <ManuscriptViewUI />
    </ManuscriptViewContext.Provider>
  );
};
