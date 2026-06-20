import type { FC } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { ICONS } from '../constants';
import { APP_SECTIONS } from '../constants/sections';
import { DashboardContext, useDashboardContext } from '../contexts/DashboardContext';
import { useDashboard } from '../hooks/useDashboard';
import { useTranslation } from '../hooks/useTranslation';
import { startSpotlightTour } from '../services/spotlightTour';
import type { View } from '../types';
import { BackupQuickActionsCard } from './dashboard/BackupQuickActionsCard';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { GoalTrackerCard } from './dashboard/GoalTrackerCard';
import { ManuscriptCompositionCard } from './dashboard/ManuscriptCompositionCard';
import { ProjectHealthCard } from './dashboard/ProjectHealthCard';
import { WritingMomentumCard } from './dashboard/WritingMomentumCard';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { DebouncedInput } from './ui/DebouncedInput';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { PageContainer } from './ui/PageContainer';
import { SectionIcon } from './ui/SectionIcon';
import { Skeleton } from './ui/Skeleton';
import { Spinner } from './ui/Spinner';
import { Tooltip } from './ui/Tooltip';

// --- Generic Components ---

const StatCard: FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  animationIndex: number;
  colorClass?: string;
}> = React.memo(
  ({
    title,
    value,
    icon,
    animationIndex,
    colorClass = 'text-[var(--sc-accent)] bg-[var(--sc-accent-subtle)]',
  }) => (
    <Card
      className="animate-in flex items-center p-5 h-auto hover:border-[var(--sc-border-strong)] transition-colors group"
      style={{ '--index': animationIndex } as React.CSSProperties}
    >
      <div
        className={`p-4 rounded-2xl mr-5 flex-shrink-0 border border-[var(--glass-border)] group-hover:scale-110 transition-transform duration-300 shadow-sm ${colorClass}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-7 h-7"
        >
          {icon}
        </svg>
      </div>
      {/* QNBS-v3: min-w-0 lets the text column shrink inside the flex row; break-words + hyphens
          wrap long German compounds (e.g. "Gliederungsabschnitte") instead of overflowing the card */}
      <div className="min-w-0">
        <p className="text-xs text-[var(--sc-text-muted)] uppercase tracking-wider font-bold mb-1 break-words hyphens-auto">
          {title}
        </p>
        <p className="text-3xl font-black text-[var(--sc-text-primary)] tracking-tight tabular-nums">
          {value}
        </p>
      </div>
    </Card>
  ),
);
StatCard.displayName = 'StatCard';

const AuthorInsightsCard: FC = () => {
  const { t, readability, sceneTimelineHints } = useDashboardContext();
  const warnCount = useMemo(
    () => sceneTimelineHints.filter((h) => h.severity === 'warn').length,
    [sceneTimelineHints],
  );
  return (
    <Card
      className="animate-in p-6 border-[var(--sc-border-subtle)]"
      style={{ '--index': 5 } as React.CSSProperties}
    >
      <CardHeader className="border-b border-[var(--sc-border-subtle)] pb-4 px-0 pt-0">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--sc-text-muted)]">
          {t('dashboard.authorInsights.title')}
        </h2>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2 px-0 pb-0 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--sc-text-primary)] mb-2">
            {t('dashboard.authorInsights.readability')}
          </h3>
          {readability.score === null ? (
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('dashboard.authorInsights.readabilityNeedMore')}
            </p>
          ) : (
            // QNBS-v3: show the /100 scale + an interpretation tooltip so the bare number isn't
            // mistaken for a normative grade (Flesch 0–100, higher = easier). Trigger is a
            // <button> so the tooltip is reachable by keyboard, with the full scale explanation
            // exposed to screen readers via aria-label.
            <Tooltip label={t('dashboard.authorInsights.readabilityTooltip')}>
              <button
                type="button"
                aria-label={`${readability.score}${t('dashboard.authorInsights.readabilityScaleSuffix')} — ${t('dashboard.authorInsights.readabilityTooltip')}`}
                className="inline-flex items-baseline rounded text-4xl font-black tabular-nums text-[var(--sc-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-ring-focus)]"
              >
                <span aria-hidden="true">{readability.score}</span>
                <span
                  aria-hidden="true"
                  className="text-lg font-semibold text-[var(--sc-text-muted)]"
                >
                  {t('dashboard.authorInsights.readabilityScaleSuffix')}
                </span>
              </button>
            </Tooltip>
          )}
          <p className="text-xs text-[var(--sc-text-muted)] mt-2">
            {t('dashboard.authorInsights.readabilityFootnote')}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--sc-text-primary)] mb-2">
            {t('dashboard.authorInsights.timeline')}
          </h3>
          {sceneTimelineHints.length === 0 ? (
            <p className="text-sm text-[var(--sc-text-muted)]">
              {t('dashboard.authorInsights.timelineClear')}
            </p>
          ) : (
            <ul className="space-y-2 text-xs text-[var(--sc-text-secondary)] max-h-40 overflow-y-auto pr-1">
              {sceneTimelineHints.slice(0, 8).map((h) => (
                <li
                  key={h.id}
                  className={h.severity === 'warn' ? 'text-[var(--sc-warning-fg)]' : undefined}
                >
                  {t(h.messageKey, h.params)}
                </li>
              ))}
            </ul>
          )}
          {warnCount > 0 ? (
            <p className="text-xs text-[var(--sc-warning-fg)] mt-2">
              {t('dashboard.authorInsights.timelineWarnBadge', { count: String(warnCount) })}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

const QuickAccessCard: FC<{
  title: string;
  description: string;
  view: View;
  onClick: () => void;
  animationIndex: number;
}> = React.memo(({ title, description, view, onClick, animationIndex }) => (
  // QNBS-v3: SectionIcon replaces generic icon — derives color from APP_SECTIONS SSOT
  <Card
    as="button"
    onClick={onClick}
    className="text-left p-5 sm:p-6 h-full w-full sm:min-w-[260px] sm:max-w-[260px] md:max-w-none md:min-w-0 group animate-in snap-center flex flex-col justify-between hover:border-[var(--border-interactive)] transition-all duration-300"
    style={{ '--index': animationIndex } as React.CSSProperties}
  >
    <div>
      <div className="flex items-center mb-4">
        <SectionIcon
          section={view}
          size="lg"
          className="group-hover:scale-110 transition-transform duration-300 shadow-sm"
        />
      </div>
      <h3 className="font-bold text-lg text-[var(--sc-text-primary)] mb-2 group-hover:text-[var(--sc-accent)] transition-colors">
        {title}
      </h3>
      <p className="text-sm text-[var(--sc-text-secondary)] leading-relaxed line-clamp-2">
        {description}
      </p>
    </div>
    <div className="mt-6 flex items-center text-xs font-bold text-[var(--sc-accent)] opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-[-10px] group-hover:translate-x-0">
      OPEN{' '}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-3 h-3 ml-1"
      >
        <path
          fillRule="evenodd"
          d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  </Card>
));
QuickAccessCard.displayName = 'QuickAccessCard';

// --- Sub-Components Consuming Context ---

const ProjectDetails: FC = () => {
  const {
    t,
    project,
    handleTitleChange,
    handleLoglineChange,
    isAiLoading,
    handleGenerateLoglines,
  } = useDashboardContext();
  return (
    <Card
      className="animate-in lg:col-span-2 h-full flex flex-col"
      style={{ '--index': 0 } as React.CSSProperties}
    >
      <CardHeader className="border-b-0 pb-0 pt-6">
        <h1 className="text-base font-semibold text-[var(--sc-text-primary)] flex items-center gap-2">
          {/* QNBS-v3: dashboard section icon from SSOT */}
          <SectionIcon section="dashboard" size="xs" />
          {t('dashboard.details.title')}
        </h1>
      </CardHeader>
      <CardContent className="space-y-5 flex-grow pt-4">
        <div className="space-y-2">
          <label
            htmlFor="projectTitle"
            className="text-sm font-medium text-[var(--sc-text-secondary)]"
          >
            {t('dashboard.details.projectTitle')}
          </label>
          <DebouncedInput
            id="projectTitle"
            value={project.title}
            onDebouncedChange={handleTitleChange}
            placeholder={t('dashboard.details.projectTitlePlaceholder')}
          />
        </div>
        <div className="space-y-2 flex-grow flex flex-col">
          <div className="flex justify-between items-center">
            <label
              htmlFor="projectLogline"
              className="text-sm font-medium text-[var(--sc-text-secondary)]"
            >
              {t('dashboard.details.logline')}
            </label>
            <Button
              onClick={handleGenerateLoglines}
              disabled={isAiLoading}
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2 text-[var(--sc-accent)] hover:bg-[var(--sc-accent)]/10"
            >
              {isAiLoading ? (
                <Spinner className="w-3 h-3" />
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-3 h-3 mr-1"
                >
                  {ICONS.SPARKLES}
                </svg>
              )}
              {t('dashboard.details.aiLoglineButton')}
            </Button>
          </div>
          <div className="relative group flex-grow">
            <DebouncedTextarea
              id="projectLogline"
              value={project.logline}
              onDebouncedChange={handleLoglineChange}
              placeholder={t('dashboard.details.loglinePlaceholder')}
              className="min-h-[120px] h-full resize-none"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const StatsGrid: FC = () => {
  const { t, wordCount, characters, worlds, project } = useDashboardContext();
  // QNBS-v3: one-frame delay shows skeleton cards so hydration flash is prevented
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (!isReady) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  // QNBS-v3: colorClass from APP_SECTIONS SSOT — no hardcoded color strings here
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
      <StatCard
        title={t('dashboard.stats.totalWordCount')}
        value={wordCount.toLocaleString()}
        icon={APP_SECTIONS.manuscript.icon}
        animationIndex={1}
        colorClass={APP_SECTIONS.manuscript.colorClass}
      />
      <StatCard
        title={t('dashboard.stats.characters')}
        value={characters.length}
        icon={APP_SECTIONS.characters.icon}
        animationIndex={2}
        colorClass={APP_SECTIONS.characters.colorClass}
      />
      <StatCard
        title={t('dashboard.stats.worlds')}
        value={worlds.length}
        icon={APP_SECTIONS.world.icon}
        animationIndex={3}
        colorClass={APP_SECTIONS.world.colorClass}
      />
      <StatCard
        title={t('dashboard.stats.outlineSections')}
        value={project.outline?.length || 0}
        icon={APP_SECTIONS.outline.icon}
        animationIndex={4}
        colorClass={APP_SECTIONS.outline.colorClass}
      />
    </div>
  );
};

const QuickActions: FC = () => {
  const { t, onNavigate } = useDashboardContext();

  // QNBS-v3: no icon field here — QuickAccessCard derives icon from APP_SECTIONS via view id
  const quickAccessItems: { title: string; description: string; view: View }[] = [
    {
      title: t('sidebar.manuscript'),
      description: t('dashboard.quickAccess.manuscriptDesc'),
      view: 'manuscript',
    },
    {
      title: t('sidebar.writer'),
      description: t('dashboard.quickAccess.writerDesc'),
      view: 'writer',
    },
    {
      title: t('sidebar.outline'),
      description: t('dashboard.quickAccess.outlineDesc'),
      view: 'outline',
    },
    {
      title: t('sidebar.characters'),
      description: t('dashboard.quickAccess.charactersDesc'),
      view: 'characters',
    },
    { title: t('sidebar.world'), description: t('dashboard.quickAccess.worldDesc'), view: 'world' },
    {
      title: t('sidebar.export'),
      description: t('dashboard.quickAccess.exportDesc'),
      view: 'export',
    },
  ];

  return (
    <div>
      <h2
        className="text-xl font-bold mb-6 animate-in px-1 tracking-tight text-[var(--sc-text-primary)]"
        style={{ '--index': 5 } as React.CSSProperties}
      >
        {t('dashboard.quickAccess.title')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {quickAccessItems.map((item, i) => (
          <QuickAccessCard
            key={item.view}
            title={item.title}
            description={item.description}
            view={item.view}
            onClick={() => onNavigate(item.view)}
            animationIndex={6 + i}
          />
        ))}
      </div>
    </div>
  );
};

const DashboardModals: FC = () => {
  const {
    t,
    isLoglineModalOpen,
    setIsLoglineModalOpen,
    isAiLoading,
    loglineSuggestions,
    selectLogline,
    isGoalModalOpen,
    setIsGoalModalOpen,
    goalWordCount,
    setGoalWordCount,
    goalTargetDate,
    setGoalTargetDate,
    handleSaveGoals,
  } = useDashboardContext();

  return (
    <>
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
                className="hover:bg-[var(--sc-surface-raised)]/50 transition-colors cursor-pointer w-full text-left border-l-4 border-l-transparent hover:border-l-indigo-500 group"
                onClick={() => selectLogline(line)}
              >
                <CardContent className="p-4">
                  <p className="text-[var(--sc-text-secondary)] group-hover:text-[var(--sc-text-primary)] transition-colors leading-relaxed">
                    {line}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length === 0 && (
          <div className="text-center text-[var(--sc-danger-fg)] min-h-[200px] flex items-center justify-center">
            <p>{t('outline.error.generationFailed')}</p>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(false)}
        title={t('dashboard.goals.modal.title')}
      >
        <div className="space-y-6">
          <div>
            <label
              htmlFor="goal-word-count"
              className="block text-sm font-semibold text-[var(--sc-text-primary)] mb-2"
            >
              {t('dashboard.goals.modal.wordCountLabel')}
            </label>
            <Input
              id="goal-word-count"
              type="number"
              value={goalWordCount}
              onChange={(e) => setGoalWordCount(Number(e.target.value))}
              min="0"
              step="1000"
              className="text-lg font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="goal-date"
              className="block text-sm font-semibold text-[var(--sc-text-primary)] mb-2"
            >
              {t('dashboard.goals.modal.deadlineLabel')}
            </label>
            <Input
              id="goal-date"
              type="date"
              value={goalTargetDate}
              onChange={(e) => setGoalTargetDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end pt-4 gap-3">
            <Button variant="secondary" onClick={() => setIsGoalModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveGoals} variant="primary">
              {t('dashboard.goals.modal.save')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

const DASHBOARD_ONBOARDING_KEY = 'worldscript-dashboard-onboarding-dismissed';

const OnboardingTipsBanner: FC = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(DASHBOARD_ONBOARDING_KEY)) setVisible(true);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DASHBOARD_ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <section
      aria-label={t('dashboard.onboarding.title')}
      className="rounded-xl border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/80 p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--sc-text-primary)]">
            {t('dashboard.onboarding.title')}
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--sc-text-secondary)]">
            <li>{t('dashboard.onboarding.tip1')}</li>
            <li>{t('dashboard.onboarding.tip2')}</li>
            <li>{t('dashboard.onboarding.tip3')}</li>
          </ul>
        </div>
        <div className="flex flex-col gap-2 shrink-0 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => startSpotlightTour((key) => t(key))}
          >
            {t('dashboard.onboarding.startTour')}
          </Button>
          <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={dismiss}>
            {t('dashboard.onboarding.dismiss')}
          </Button>
        </div>
      </div>
    </section>
  );
};

// --- Main Composition ---

const DashboardUI: FC = () => {
  const { onNavigate } = useDashboardContext();
  return (
    // QNBS-v3: width-capping moved to the PageContainer wrapper (width="wide"); the old inner
    // max-w-7xl (80rem) capped below the wide token (90rem) and neutralized it. Web stays full-width
    // by design (PWA), desktop honors the --width-content-wide token.
    <div className="space-y-8 pb-16">
      <DashboardHeader />
      <OnboardingTipsBanner />
      <StatsGrid />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-[minmax(340px,auto)]">
        <ProjectDetails />
        <WritingMomentumCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <GoalTrackerCard />
        <ProjectHealthCard />
        <ManuscriptCompositionCard />
      </div>
      <AuthorInsightsCard />
      <BackupQuickActionsCard onNavigate={onNavigate} />
      <QuickActions />
      <DashboardModals />
    </div>
  );
};

interface DashboardProps {
  onNavigate: (view: View) => void;
}

export const Dashboard: FC<DashboardProps> = ({ onNavigate }) => {
  const contextValue = useDashboard({ onNavigate });
  return (
    <DashboardContext.Provider value={contextValue}>
      <PageContainer width="wide">
        <DashboardUI />
      </PageContainer>
    </DashboardContext.Provider>
  );
};
