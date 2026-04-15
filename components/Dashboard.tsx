import type { FC } from 'react';
import React from 'react';
import type { View } from '../types';
import { Card, CardContent, CardHeader } from './ui/Card';
import { ICONS } from '../constants';
import { DebouncedInput } from './ui/DebouncedInput';
import { DebouncedTextarea } from './ui/DebouncedTextarea';
import { Button } from './ui/Button';
import { Spinner } from './ui/Spinner';
import { Modal } from './ui/Modal';
import { Progress } from './ui/Progress';
import { Input } from './ui/Input';
import { useDashboard } from '../hooks/useDashboard';
import { DashboardContext, useDashboardContext } from '../contexts/DashboardContext';

// --- Generic Components ---

const StatCard: FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  animationIndex: number;
  colorClass?: string;
}> = React.memo(
  ({ title, value, icon, animationIndex, colorClass = 'text-indigo-500 bg-indigo-500/10' }) => (
    <Card
      className="animate-in flex items-center p-5 h-auto hover:border-[var(--border-highlight)] transition-colors group"
      style={{ '--index': animationIndex } as React.CSSProperties}
    >
      <div
        className={`p-4 rounded-2xl mr-5 flex-shrink-0 border border-white/5 group-hover:scale-110 transition-transform duration-300 shadow-sm ${colorClass}`}
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
      <div>
        <p className="text-xs text-[var(--foreground-muted)] uppercase tracking-wider font-bold mb-1">
          {title}
        </p>
        <p className="text-3xl font-black text-[var(--foreground-primary)] tracking-tight tabular-nums">
          {value}
        </p>
      </div>
    </Card>
  )
);
StatCard.displayName = 'StatCard';

const QuickAccessCard: FC<{
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
  animationIndex: number;
}> = React.memo(({ title, description, icon, onClick, animationIndex }) => (
  <Card
    as="button"
    onClick={onClick}
    className="text-left p-6 h-full min-w-[260px] max-w-[260px] md:max-w-none md:min-w-0 group animate-in snap-center flex flex-col justify-between hover:border-[var(--border-interactive)] transition-all duration-300"
    style={{ '--index': animationIndex } as React.CSSProperties}
  >
    <div>
      <div className="flex items-center mb-4">
        <div className="p-3 rounded-xl bg-[var(--background-secondary)] group-hover:bg-[var(--background-interactive)] group-hover:text-white transition-colors shrink-0 shadow-sm border border-[var(--border-primary)] group-hover:border-[var(--border-interactive)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            {icon}
          </svg>
        </div>
      </div>
      <h3 className="font-bold text-lg text-[var(--foreground-primary)] mb-2 group-hover:text-[var(--background-interactive)] transition-colors">
        {title}
      </h3>
      <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed line-clamp-2">
        {description}
      </p>
    </div>
    <div className="mt-6 flex items-center text-xs font-bold text-[var(--background-interactive)] opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-[-10px] group-hover:translate-x-0">
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
        <h1 className="text-base font-semibold text-[var(--foreground-primary)] flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5 text-indigo-500"
          >
            {ICONS.WRITER}
          </svg>
          {t('dashboard.details.title')}
        </h1>
      </CardHeader>
      <CardContent className="space-y-5 flex-grow pt-4">
        <div className="space-y-2">
          <label
            htmlFor="projectTitle"
            className="text-sm font-medium text-[var(--foreground-secondary)]"
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
              className="text-sm font-medium text-[var(--foreground-secondary)]"
            >
              {t('dashboard.details.logline')}
            </label>
            <Button
              onClick={handleGenerateLoglines}
              disabled={isAiLoading}
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2 text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30"
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

const GoalTracker: FC = () => {
  const { t, project, wordCount, wordCountProgress, daysLeft, openGoalModal } =
    useDashboardContext();

  const renderDaysLeft = () => {
    if (daysLeft === null)
      return (
        <p className="text-xl font-bold text-[var(--foreground-muted)]">
          {t('dashboard.goals.noDeadline')}
        </p>
      );
    let color = 'text-[var(--foreground-primary)]';
    if (daysLeft < 0) color = 'text-red-500';
    else if (daysLeft < 7) color = 'text-amber-500';

    const count = Math.abs(daysLeft);

    return (
      <div className="flex items-baseline gap-2">
        <span className={`text-4xl font-black ${color}`}>{count}</span>
        <span className="text-sm font-semibold text-[var(--foreground-secondary)] uppercase tracking-wide">
          {daysLeft < 0
            ? t('dashboard.goals.overdue')
            : t('dashboard.goals.daysLeft', { count: '' }).replace(/\d+/, '').trim()}
        </span>
      </div>
    );
  };

  return (
    <Card
      className="animate-in h-full flex flex-col"
      style={{ '--index': 1 } as React.CSSProperties}
    >
      <CardHeader className="flex justify-between items-center border-b-0 pb-0 pt-6">
        <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--foreground-muted)]">
          {t('dashboard.goals.title')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={openGoalModal}
          className="rounded-full hover:bg-[var(--background-tertiary)] w-8 h-8 p-0"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-5 h-5"
          >
            {ICONS.TARGET}
          </svg>
        </Button>
      </CardHeader>
      <CardContent className="space-y-8 flex-grow flex flex-col justify-center">
        <div>
          <div className="flex justify-between items-end mb-3">
            <span className="text-4xl font-black text-[var(--foreground-primary)] tracking-tight tabular-nums">
              {wordCount.toLocaleString()}
            </span>
            <span className="text-sm font-medium text-[var(--foreground-muted)] mb-1">
              / {project.projectGoals?.totalWordCount.toLocaleString()} {t('common.words')}
            </span>
          </div>
          <Progress value={wordCountProgress} className="h-4" />
        </div>
        <div className="bg-[var(--background-primary)]/40 p-5 rounded-2xl border border-[var(--border-primary)] backdrop-blur-sm">
          <label className="text-xs uppercase tracking-wider font-bold text-[var(--foreground-muted)] mb-1 block">
            {t('dashboard.goals.deadline')}
          </label>
          {renderDaysLeft()}
        </div>
      </CardContent>
    </Card>
  );
};

const StatsGrid: FC = () => {
  const { t, wordCount, characters, worlds, project } = useDashboardContext();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
      <StatCard
        title={t('dashboard.stats.totalWordCount')}
        value={wordCount.toLocaleString()}
        icon={ICONS.WRITER}
        animationIndex={1}
        colorClass="text-emerald-500 bg-emerald-500/10 dark:text-emerald-400 dark:bg-emerald-500/10"
      />
      <StatCard
        title={t('dashboard.stats.characters')}
        value={characters.length}
        icon={ICONS.CHARACTERS}
        animationIndex={2}
        colorClass="text-blue-500 bg-blue-500/10 dark:text-blue-400 dark:bg-blue-500/10"
      />
      <StatCard
        title={t('dashboard.stats.worlds')}
        value={worlds.length}
        icon={ICONS.WORLD}
        animationIndex={3}
        colorClass="text-purple-500 bg-purple-500/10 dark:text-purple-400 dark:bg-purple-500/10"
      />
      <StatCard
        title={t('dashboard.stats.outlineSections')}
        value={project.outline?.length || 0}
        icon={ICONS.OUTLINE}
        animationIndex={4}
        colorClass="text-amber-500 bg-amber-500/10 dark:text-amber-400 dark:bg-amber-500/10"
      />
    </div>
  );
};

const QuickActions: FC = () => {
  const { t, onNavigate } = useDashboardContext();

  const quickAccessItems = [
    {
      title: t('sidebar.manuscript'),
      description: t('dashboard.quickAccess.manuscriptDesc'),
      icon: ICONS.WRITER,
      view: 'manuscript',
    },
    {
      title: t('sidebar.writer'),
      description: t('dashboard.quickAccess.writerDesc'),
      icon: ICONS.SPARKLES,
      view: 'writer',
    },
    {
      title: t('sidebar.outline'),
      description: t('dashboard.quickAccess.outlineDesc'),
      icon: ICONS.OUTLINE,
      view: 'outline',
    },
    {
      title: t('sidebar.characters'),
      description: t('dashboard.quickAccess.charactersDesc'),
      icon: ICONS.CHARACTERS,
      view: 'characters',
    },
    {
      title: t('sidebar.world'),
      description: t('dashboard.quickAccess.worldDesc'),
      icon: ICONS.WORLD,
      view: 'world',
    },
    {
      title: t('sidebar.export'),
      description: t('dashboard.quickAccess.exportDesc'),
      icon: ICONS.EXPORT,
      view: 'export',
    },
  ];

  return (
    <div>
      <h2
        className="text-xl font-bold mb-6 animate-in px-1 tracking-tight text-[var(--foreground-primary)]"
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
            icon={item.icon}
            onClick={() => onNavigate(item.view as View)}
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
            <p className="mt-4 text-[var(--foreground-secondary)]">
              {t('dashboard.loglineModal.loading')}
            </p>
          </div>
        )}
        {!isAiLoading && loglineSuggestions.length > 0 && (
          <div className="space-y-3">
            {loglineSuggestions.map((line, idx) => (
              <Card
                as="button"
                key={idx}
                className="hover:bg-[var(--background-secondary)]/50 transition-colors cursor-pointer w-full text-left border-l-4 border-l-transparent hover:border-l-indigo-500 group"
                onClick={() => selectLogline(line)}
              >
                <CardContent className="p-4">
                  <p className="text-[var(--foreground-secondary)] group-hover:text-[var(--foreground-primary)] transition-colors leading-relaxed">
                    {line}
                  </p>
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

      <Modal
        isOpen={isGoalModalOpen}
        onClose={() => setIsGoalModalOpen(false)}
        title={t('dashboard.goals.modal.title')}
      >
        <div className="space-y-6">
          <div>
            <label
              htmlFor="goal-word-count"
              className="block text-sm font-semibold text-[var(--foreground-primary)] mb-2"
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
              className="block text-sm font-semibold text-[var(--foreground-primary)] mb-2"
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

// --- Main Composition ---

const DashboardUI: FC = () => {
  return (
    <div className="space-y-10 pb-16 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 auto-rows-[minmax(340px,auto)]">
        <ProjectDetails />
        <GoalTracker />
      </div>
      <StatsGrid />
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
      <DashboardUI />
    </DashboardContext.Provider>
  );
};
