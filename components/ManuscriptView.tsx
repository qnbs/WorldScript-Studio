import type React from 'react';
import type { FC } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { ManuscriptViewContext, useManuscriptViewContext } from '../contexts/ManuscriptViewContext';
import { selectEnableBinderResearch } from '../features/featureFlags/featureFlagsSlice';
import { projectActions } from '../features/project/projectSlice';
import { useManuscriptLayout } from '../hooks/useManuscriptLayout';
import { useManuscriptView } from '../hooks/useManuscriptView';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ManuscriptDesktopLayout } from './manuscript/ManuscriptDesktopLayout';
import { ManuscriptMobileLayout } from './manuscript/ManuscriptMobileLayout';
import { EmptyState } from './ui/EmptyState';
import { Spinner } from './ui/Spinner';

// QNBS-v3: ManuscriptViewUI is now a thin orchestrator — layout state lives in useManuscriptLayout,
// and rendering is split into ManuscriptMobileLayout / ManuscriptDesktopLayout (responsive show/hide).
const ManuscriptViewUI: FC = () => {
  const dispatch = useAppDispatch();
  const { project, t } = useManuscriptViewContext();
  const enableBinder = useAppSelector(selectEnableBinderResearch);
  const layout = useManuscriptLayout();
  // QNBS-v3: `md` breakpoint (768px) — render one layout at a time so only one ManuscriptEditor mounts.
  const isDesktop = useMediaQuery('(min-width: 768px)');

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

  return (
    <div className="h-full flex flex-col">
      {/* QNBS-v3: render only the layout matching the breakpoint — mounting both ran two
          ManuscriptEditor trees (duplicate voice/window effects) and could leave a mobile drawer
          open over the desktop layout on resize. `md` = 768px, matching the layouts' own CSS. */}
      {isDesktop ? (
        <ManuscriptDesktopLayout project={project} layout={layout} enableBinder={enableBinder} />
      ) : (
        <ManuscriptMobileLayout project={project} layout={layout} enableBinder={enableBinder} />
      )}
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
