// QNBS-v3: Desktop 3-pane layout for ManuscriptView (navigator · editor+research · inspector),
// extracted from ManuscriptViewUI so each file stays focused on one concern.
import type { FC } from 'react';
import { useTransientUiStore } from '../../app/transientUiStore';
import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import type { ProjectData } from '../../features/project/projectState';
import type { UseManuscriptLayoutReturn } from '../../hooks/useManuscriptLayout';
import { BinderPanel } from '../BinderPanel';
import { ManuscriptResearchSplit } from '../ManuscriptResearchSplit';
import { Button } from '../ui/Button';
import { Card, CardHeader } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { SectionIcon } from '../ui/SectionIcon';
import { InspectorPanel } from './InspectorPanel';
import { ManuscriptEditor } from './ManuscriptEditor';
import { StoryNavigator } from './NavigatorPanel';
import { Resizer } from './ResizeHandle';

interface ManuscriptDesktopLayoutProps {
  project: ProjectData;
  layout: UseManuscriptLayoutReturn;
  enableBinder: boolean;
}

export const ManuscriptDesktopLayout: FC<ManuscriptDesktopLayoutProps> = ({
  project,
  layout,
  enableBinder,
}) => {
  const { t } = useManuscriptViewContext();
  const manuscriptPinnedBinderNodeId = useTransientUiStore((s) => s.manuscriptPinnedBinderNodeId);
  const {
    leftNavTab,
    setLeftNavTab,
    isFocusMode,
    setIsFocusMode,
    leftPanelWidth,
    rightPanelWidth,
    startLeftResize,
    startRightResize,
    setLeftPanelWidth,
    setRightPanelWidth,
    manuscriptResearchSplitOpen,
    setManuscriptResearchSplitOpen,
  } = layout;

  const projectStorageId = project.id && project.id.length > 0 ? project.id : 'browser-project';
  const pinnedBinderNode = project.binderNodes?.find((n) => n.id === manuscriptPinnedBinderNodeId);

  return (
    <>
      {/* Desktop Toolbar - Focus Toggle */}
      <div className="hidden md:flex justify-end px-2 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsFocusMode((prev) => !prev)}
          className={`transition-colors ${isFocusMode ? 'text-[var(--sc-accent)] bg-[var(--sc-accent)]/10' : 'text-[var(--sc-text-muted)]'}`}
          title={isFocusMode ? t('manuscript.zenMode.exit') : t('manuscript.zenMode.enter')}
        >
          <Icon
            name={isFocusMode ? 'fullscreen-exit' : 'fullscreen-enter'}
            size="md"
            className="me-2"
          />
          {isFocusMode ? t('manuscript.zenMode.exit') : t('manuscript.zenMode.label')}
        </Button>
      </div>

      {/* Main Content Area */}
      <main className="flex-grow min-h-0 hidden md:flex md:flex-row relative">
        {/* Desktop Navigator */}
        {/* QNBS-v3: container-type enables @container queries inside NavigatorPanel for width-aware layout — LA-2. */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-r border-[var(--sc-border-subtle)]'}`}
          style={{ width: isFocusMode ? 0 : `${leftPanelWidth}%`, containerType: 'inline-size' }}
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
                        ? 'bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)]'
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
                        ? 'bg-[var(--sc-accent)] text-[var(--sc-text-on-accent)]'
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
            // QNBS-v3: combined constraint — cap so left + the (current) right panel never exceed 80%,
            // leaving the center editor at least 20%. Clamping each side to 50% independently let both
            // reach 50% and collapse the editor pane entirely.
            onKeyAdjust={(delta) =>
              setLeftPanelWidth((w) => Math.max(15, Math.min(50, 80 - rightPanelWidth, w + delta)))
            }
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
            // QNBS-v3: combined constraint — keep right + (current) left ≤ 80% so the center editor
            // retains at least 20% (see the left resizer above).
            onKeyAdjust={(delta) =>
              setRightPanelWidth((w) => Math.max(15, Math.min(50, 80 - leftPanelWidth, w + delta)))
            }
            label={t('manuscript.resizer.right')}
            value={rightPanelWidth}
          />
        )}

        {/* Desktop Inspector */}
        {/* QNBS-v3: container-type enables @container queries inside InspectorPanel for width-aware layout — LA-2. */}
        <div
          className={`h-full flex flex-col transition-all duration-500 ease-in-out overflow-hidden ${isFocusMode ? 'opacity-0 w-0 border-0 pointer-events-none' : 'opacity-100 border-l border-[var(--sc-border-subtle)]'}`}
          style={{ width: isFocusMode ? 0 : `${rightPanelWidth}%`, containerType: 'inline-size' }}
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
    </>
  );
};
