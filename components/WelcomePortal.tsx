import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../app/hooks';
import { ICONS } from '../constants';
import { projectActions } from '../features/project/projectSlice';
import { importProjectThunk } from '../features/project/thunks/projectManagementThunks';
import { statusActions } from '../features/status/statusSlice';
import { useTranslation } from '../hooks/useTranslation';
import { storageService } from '../services/storageService';
import type { View } from '../types';
import { Button } from './ui/Button';
import { LanguageSelector } from './ui/LanguageSelector';

interface WelcomePortalProps {
  onExit: (view?: View) => void;
}

type PortalView = 'main' | 'new_project' | 'open_project';

// QNBS-v3: LanguageSelector now imported from ui/LanguageSelector.tsx with search functionality

const NewProjectOption: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}> = ({ icon, title, description, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-[var(--sc-surface-raised)]/80 p-6 rounded-lg border border-[var(--sc-border-subtle)] hover:border-indigo-500 hover:bg-[var(--sc-surface-raised)] transition-all cursor-pointer flex items-start space-x-4 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex-shrink-0 bg-[var(--sc-surface-overlay)] p-3 rounded-lg">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-8 h-8 text-[var(--sc-accent)]"
        >
          {icon}
        </svg>
      </div>
      <div>
        <h3 className="text-lg font-bold text-[var(--sc-text-primary)]">{title}</h3>
        <p className="text-[var(--sc-text-muted)] mt-1">{description}</p>
      </div>
    </button>
  );
};

// QNBS-v3: first-launch value-prop highlights — orient new users before they pick a path.
const FeatureHighlight: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/50 p-4 text-left">
    <div className="mb-2 inline-flex rounded-lg bg-[var(--sc-accent-subtle)] p-2 text-[var(--sc-accent)]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-5 w-5"
        aria-hidden="true"
      >
        {icon}
      </svg>
    </div>
    <h3 className="text-sm font-bold text-[var(--sc-text-primary)]">{title}</h3>
    <p className="mt-0.5 text-xs leading-relaxed text-[var(--sc-text-muted)]">{description}</p>
  </div>
);

export const WelcomePortal: React.FC<WelcomePortalProps> = ({ onExit }) => {
  const { t, language, setLanguage } = useTranslation();
  const dispatch = useAppDispatch();
  const [view, setView] = useState<PortalView>('main');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [hasExistingSession, setHasExistingSession] = useState(false);

  useEffect(() => {
    const checkDb = async () => {
      const hasData = await storageService.hasSavedData();
      setHasExistingSession(hasData);
    };
    checkDb();
  }, []);

  const handleStartBlank = () => {
    dispatch(
      projectActions.resetProject({
        title: t('initialProject.title'),
        logline: t('initialProject.logline'),
      }),
    );
    dispatch(
      projectActions.setManuscript([
        {
          id: `sec-${Date.now()}`,
          title: t('initialProject.chapter1'),
          content: '',
        },
      ]),
    );
    onExit('manuscript');
  };

  const handleStartWithTemplate = () => {
    onExit('templates');
  };

  const handleStartWithAI = () => {
    onExit('outline');
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const resultAction = await dispatch(importProjectThunk(file));
      if (importProjectThunk.fulfilled.match(resultAction)) {
        dispatch(
          statusActions.addNotification({
            type: 'success',
            title: t('settings.data.importSuccess'),
          }),
        );
        onExit('manuscript');
      } else {
        dispatch(
          statusActions.addNotification({
            type: 'error',
            title: t('settings.data.importError'),
          }),
        );
      }
    }
  };

  const buildDemoProjectFile = (): File => {
    const chapterId = `demo-ch-${Date.now()}`;
    const payload = {
      title: t('portal.demo.title'),
      logline: t('portal.demo.logline'),
      characters: [] as const,
      worlds: [] as const,
      outline: [
        {
          id: 'demo-o1',
          title: t('portal.demo.outline1Title'),
          description: t('portal.demo.outline1Desc'),
        },
        {
          id: 'demo-o2',
          title: t('portal.demo.outline2Title'),
          description: t('portal.demo.outline2Desc'),
        },
      ],
      manuscript: [
        {
          id: chapterId,
          title: t('portal.demo.chapterTitle'),
          content: t('portal.demo.chapterContent'),
        },
      ],
      projectGoals: { totalWordCount: 15000, targetDate: null },
      writingHistory: [] as const,
    };
    return new File([JSON.stringify(payload)], 'storycraft-demo.json', {
      type: 'application/json',
    });
  };

  const handleLoadDemo = async () => {
    const resultAction = await dispatch(importProjectThunk(buildDemoProjectFile()));
    if (importProjectThunk.fulfilled.match(resultAction)) {
      dispatch(
        statusActions.addNotification({
          type: 'success',
          title: t('settings.data.importSuccess'),
        }),
      );
      onExit('manuscript');
    } else {
      dispatch(
        statusActions.addNotification({
          type: 'error',
          title: t('settings.data.importError'),
        }),
      );
    }
  };

  const renderMainView = () => (
    <div className="text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-16 h-16 text-[var(--sc-accent)] mx-auto mb-4"
      >
        {ICONS.WRITER}
      </svg>
      <h1 className="text-4xl md:text-5xl font-bold text-[var(--sc-text-primary)]">
        {t('portal.welcome.title')}
      </h1>
      <p className="text-lg text-[var(--sc-text-muted)] mt-2 mb-6">
        {t('portal.welcome.subtitle')}
      </p>
      {/* QNBS-v3: feature highlights orient first-time users; offline-first badge sets the privacy
          expectation up front (no backend, keys encrypted at rest, data stays on device). */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FeatureHighlight
          icon={ICONS.SPARKLES}
          title={t('portal.features.ai.title')}
          description={t('portal.features.ai.description')}
        />
        <FeatureHighlight
          icon={ICONS.SCENEBOARD}
          title={t('portal.features.plot.title')}
          description={t('portal.features.plot.description')}
        />
        <FeatureHighlight
          icon={ICONS.CHARACTERS}
          title={t('portal.features.worldbuilding.title')}
          description={t('portal.features.worldbuilding.description')}
        />
        <FeatureHighlight
          icon={ICONS.EXPORT}
          title={t('portal.features.export.title')}
          description={t('portal.features.export.description')}
        />
      </div>
      <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/60 px-4 py-1.5 text-sm text-[var(--sc-text-secondary)]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-4 w-4 text-[var(--sc-success-fg)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
        {t('portal.welcome.privacyBadge')}
      </p>
      {!hasExistingSession && (
        <section
          className="mb-8 rounded-lg border border-[var(--sc-border-subtle)] bg-[var(--sc-surface-raised)]/60 px-4 py-3 text-left text-sm text-[var(--sc-text-secondary)]"
          aria-label={t('portal.welcome.demoHint')}
        >
          <p className="mb-3">{t('portal.welcome.demoHint')}</p>
          <Button
            type="button"
            onClick={() => void handleLoadDemo()}
            variant="primary"
            className="w-full sm:w-auto"
          >
            {t('portal.welcome.tryDemo')}
          </Button>
        </section>
      )}
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        {hasExistingSession && (
          <Button
            onClick={() => onExit('manuscript')}
            variant="primary"
            className="px-8 py-4 text-lg"
          >
            {t('portal.welcome.continue')}
          </Button>
        )}
        <Button
          onClick={() => setView('new_project')}
          variant="secondary"
          className="px-8 py-4 text-lg"
        >
          {t('portal.welcome.newProject')}
        </Button>
        <Button
          onClick={() => setView('open_project')}
          variant="secondary"
          className="px-8 py-4 text-lg"
        >
          {t('portal.welcome.openProject')}
        </Button>
      </div>
    </div>
  );

  const renderNewProjectView = () => (
    <div>
      <button
        type="button"
        onClick={() => setView('main')}
        className="flex items-center space-x-2 text-[var(--sc-accent)] hover:text-[var(--sc-accent-hover)] mb-6"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-5 h-5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span>{t('portal.back')}</span>
      </button>
      <h2 className="text-3xl font-bold text-[var(--sc-text-primary)] mb-2">
        {t('portal.new.title')}
      </h2>
      <p className="text-[var(--sc-text-muted)] mb-8">{t('portal.new.description')}</p>
      <div className="space-y-4">
        <NewProjectOption
          icon={ICONS.OUTLINE}
          title={t('portal.new.demo.title')}
          description={t('portal.new.demo.description')}
          onClick={() => void handleLoadDemo()}
        />
        <NewProjectOption
          icon={ICONS.TEMPLATES}
          title={t('portal.new.template.title')}
          description={t('portal.new.template.description')}
          onClick={handleStartWithTemplate}
        />
        <NewProjectOption
          icon={ICONS.SPARKLES}
          title={t('portal.new.ai.title')}
          description={t('portal.new.ai.description')}
          onClick={handleStartWithAI}
        />
        <NewProjectOption
          icon={ICONS.DOCUMENT_TEXT}
          title={t('portal.new.blank.title')}
          description={t('portal.new.blank.description')}
          onClick={handleStartBlank}
        />
      </div>
    </div>
  );

  const renderOpenProjectView = () => (
    <div>
      <button
        type="button"
        onClick={() => setView('main')}
        className="flex items-center space-x-2 text-[var(--sc-accent)] hover:text-[var(--sc-accent-hover)] mb-6"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-5 h-5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span>{t('portal.back')}</span>
      </button>
      <h2 className="text-3xl font-bold text-[var(--sc-text-primary)] mb-2">
        {t('portal.open.title')}
      </h2>
      <p className="text-[var(--sc-text-muted)] mb-8">{t('portal.open.description')}</p>
      <Button
        onClick={() => importFileRef.current?.click()}
        className="w-full sm:w-auto px-8 py-4 text-lg"
      >
        {t('portal.open.button')}
      </Button>
      <input
        type="file"
        ref={importFileRef}
        onChange={handleImportFile}
        accept=".json"
        className="hidden"
      />
    </div>
  );

  const renderView = () => {
    switch (view) {
      case 'main':
        return renderMainView();
      case 'new_project':
        return renderNewProjectView();
      case 'open_project':
        return renderOpenProjectView();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[var(--sc-surface-base)] animate-fade-in">
      {/* QNBS-v3: shell is now scrollable (overflow-y-auto) with min-h-full centering — content
          taller than the viewport (e.g. the feature grid on mobile) scrolls instead of being
          clipped by the old fixed `flex items-center` shell. Fixes Mobile-Chrome E2E click
          timeouts where the bottom action buttons were unreachable. */}
      {/* LanguageSelector now imported from ui/LanguageSelector.tsx with search functionality */}
      <LanguageSelector value={language} onChange={setLanguage} />
      <div className="flex min-h-full items-center justify-center p-4 pt-16 sm:pt-4">
        <div className="w-full max-w-3xl">{renderView()}</div>
      </div>
      <style>{`
            @keyframes fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .animate-fade-in {
                animation: fade-in 0.5s ease-in-out;
            }
            /* QNBS-v3: respect reduced-motion — disabling the fade keeps the portal at full
               opacity so axe never samples blended mid-animation colors (WCAG 2.3.3 + stable a11y). */
            @media (prefers-reduced-motion: reduce) {
                .animate-fade-in {
                    animation: none;
                    opacity: 1;
                }
            }
        `}</style>
    </div>
  );
};
