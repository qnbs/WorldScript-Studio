import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAppDispatch } from '../app/hooks';
import { ICONS } from '../constants';
import { importProjectThunk, projectActions } from '../features/project/projectSlice';
import { useTranslation } from '../hooks/useTranslation';
import { dbService } from '../services/dbService';
import type { View } from '../types';
import { Button } from './ui/Button';

interface WelcomePortalProps {
  onExit: (view?: View) => void;
}

type PortalView = 'main' | 'new_project' | 'open_project';

const LanguageSelector = () => {
  const { language, setLanguage } = useTranslation();
  return (
    <div className="absolute top-4 right-4 space-x-2">
      <button
        type="button"
        onClick={() => setLanguage('de')}
        className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'de' ? 'bg-indigo-600 text-white' : 'bg-[var(--background-tertiary)]/50 text-[var(--foreground-secondary)] hover:bg-[var(--background-tertiary)]'}`}
      >
        DE
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'en' ? 'bg-indigo-600 text-white' : 'bg-[var(--background-tertiary)]/50 text-[var(--foreground-secondary)] hover:bg-[var(--background-tertiary)]'}`}
      >
        EN
      </button>
    </div>
  );
};

const NewProjectOption: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}> = ({ icon, title, description, onClick }) => {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="bg-[var(--background-secondary)]/80 p-6 rounded-lg border border-[var(--border-primary)] hover:border-indigo-500 hover:bg-[var(--background-secondary)] transition-all cursor-pointer flex items-start space-x-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      <div className="flex-shrink-0 bg-[var(--background-tertiary)] p-3 rounded-lg">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-8 h-8 text-indigo-500 dark:text-indigo-400"
        >
          {icon}
        </svg>
      </div>
      <div>
        <h3 className="text-lg font-bold text-[var(--foreground-primary)]">{title}</h3>
        <p className="text-[var(--foreground-muted)] mt-1">{description}</p>
      </div>
    </div>
  );
};

export const WelcomePortal: React.FC<WelcomePortalProps> = ({ onExit }) => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [view, setView] = useState<PortalView>('main');
  const importFileRef = useRef<HTMLInputElement>(null);
  const [hasExistingSession, setHasExistingSession] = useState(false);

  useEffect(() => {
    const checkDb = async () => {
      const hasData = await dbService.hasSavedData();
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
        alert(t('settings.data.importSuccess'));
        onExit('manuscript');
      } else {
        alert(t('settings.data.importError'));
      }
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
        className="w-16 h-16 text-indigo-500 dark:text-indigo-400 mx-auto mb-4"
      >
        {ICONS.WRITER}
      </svg>
      <h1 className="text-4xl md:text-5xl font-bold text-[var(--foreground-primary)]">
        {t('portal.welcome.title')}
      </h1>
      <p className="text-lg text-[var(--foreground-muted)] mt-2 mb-8">
        {t('portal.welcome.subtitle')}
      </p>
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
        className="flex items-center space-x-2 text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 mb-6"
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
      <h2 className="text-3xl font-bold text-[var(--foreground-primary)] mb-2">
        {t('portal.new.title')}
      </h2>
      <p className="text-[var(--foreground-muted)] mb-8">{t('portal.new.description')}</p>
      <div className="space-y-4">
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
        className="flex items-center space-x-2 text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 mb-6"
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
      <h2 className="text-3xl font-bold text-[var(--foreground-primary)] mb-2">
        {t('portal.open.title')}
      </h2>
      <p className="text-[var(--foreground-muted)] mb-8">{t('portal.open.description')}</p>
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
    <div className="fixed inset-0 bg-[var(--background-primary)] z-50 flex items-center justify-center p-4 animate-fade-in">
      <LanguageSelector />
      <div className="w-full max-w-3xl">{renderView()}</div>
      <style>{`
            @keyframes fade-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .animate-fade-in {
                animation: fade-in 0.5s ease-in-out;
            }
        `}</style>
    </div>
  );
};
