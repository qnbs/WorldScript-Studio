// QNBS-v3: Mobile layout for ManuscriptView (header + full-bleed editor + nav/inspector drawers),
// extracted from ManuscriptViewUI. Desktop equivalents live in ManuscriptDesktopLayout.
import type { FC } from 'react';
import { useManuscriptViewContext } from '../../contexts/ManuscriptViewContext';
import type { ProjectData } from '../../features/project/projectState';
import type { UseManuscriptLayoutReturn } from '../../hooks/useManuscriptLayout';
import { BinderPanel } from '../BinderPanel';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { Icon } from '../ui/Icon';
import { InspectorPanel } from './InspectorPanel';
import { ManuscriptEditor } from './ManuscriptEditor';
import { StoryNavigator } from './NavigatorPanel';

interface ManuscriptMobileLayoutProps {
  project: ProjectData;
  layout: UseManuscriptLayoutReturn;
  enableBinder: boolean;
}

export const ManuscriptMobileLayout: FC<ManuscriptMobileLayoutProps> = ({
  project,
  layout,
  enableBinder,
}) => {
  const { activeSection, t } = useManuscriptViewContext();
  const {
    leftNavTab,
    setLeftNavTab,
    isNavDrawerOpen,
    setIsNavDrawerOpen,
    isInspectorDrawerOpen,
    setIsInspectorDrawerOpen,
  } = layout;

  return (
    <>
      {/* Mobile Header */}
      {/* QNBS-v3: min-h-[52px] ensures header always meets 44px touch-target zone even on compact devices. */}
      <header className="md:hidden flex-shrink-0 flex justify-between items-center p-2 min-h-[52px] mb-2 bg-[var(--sc-surface-raised)]/80 backdrop-blur-md border-b border-[var(--sc-border-subtle)] sticky top-0 z-20">
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
            className="min-h-[44px] min-w-[44px]"
            aria-label={t('manuscript.leftPanel.openDrawer')}
          >
            <Icon name="menu" size="lg" />
          </Button>
        </div>
        <h1 className="text-sm font-bold truncate px-2 text-center flex-grow text-[var(--sc-text-primary)]">
          {activeSection?.title || project.title}
        </h1>
        <Button
          variant="ghost"
          onClick={() => setIsInspectorDrawerOpen(true)}
          size="sm"
          className="min-h-[44px] min-w-[44px]"
          aria-label={t('manuscript.inspector.title')}
        >
          <Icon name="info" size="lg" />
        </Button>
      </header>

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
    </>
  );
};
