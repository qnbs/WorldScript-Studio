import type { FC } from 'react';
import React from 'react';
import { ICONS } from '../constants';
import { SettingsViewContext, useSettingsViewContext } from '../contexts/SettingsViewContext';
import { useSettingsView } from '../hooks/useSettingsView';
import { AdvancedAiSection, AiSection } from './settings/AiSections';
import { DataSection } from './settings/DataSection';
import { AdvancedEditorSection, EditorSection } from './settings/EditorSections';
import { AboutSection, AppearanceSection, GeneralSection } from './settings/GeneralSections';
import { SettingsModals } from './settings/SettingsModals';
import {
  AccessibilitySection,
  BackupSection,
  CollaborationSection,
  IntegrationsSection,
  NotificationsSection,
  PerformanceSection,
  PrivacySection,
} from './settings/SystemSections';
import { Select } from './ui/Select';
import { Spinner } from './ui/Spinner';

// --- SUB-COMPONENTS ---

const NavButton: FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ icon, label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={isActive ? 'page' : undefined}
    className={`flex items-center w-full px-3 py-2 text-left rounded-md transition-colors ${isActive ? 'bg-[var(--nav-background-active)] text-[var(--nav-text-active)]' : 'hover:bg-[var(--nav-background-hover)] text-[var(--foreground-secondary)] hover:text-[var(--foreground-primary)]'}`}
  >
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className="w-5 h-5 mr-3"
    >
      {icon}
    </svg>
    <span>{label}</span>
  </button>
));
NavButton.displayName = 'NavButton';

// ─── Main Settings UI ─────────────────────────────────────────────────────────

const SettingsViewUI: FC = () => {
  const { t, project, activeCategory, setActiveCategory } = useSettingsViewContext();
  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  const navCategories = [
    { id: 'general', label: t('settings.categories.general'), icon: ICONS.SETTINGS },
    {
      id: 'appearance',
      label: t('settings.categories.appearance'),
      icon: <path d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />,
    },
    { id: 'editor', label: t('settings.categories.editor'), icon: ICONS.WRITER },
    {
      id: 'advanced-editor',
      label: t('settings.categories.advancedEditor'),
      icon: (
        <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      ),
    },
    { id: 'ai', label: t('settings.categories.ai'), icon: ICONS.SPARKLES },
    {
      id: 'advanced-ai',
      label: t('settings.categories.advancedAi'),
      icon: (
        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      ),
    },
    {
      id: 'accessibility',
      label: t('settings.categories.accessibility'),
      icon: (
        <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75M4.5 16.5v-.75a2.25 2.25 0 011.372-2.048l1.287-.513a.75.75 0 011.06.184l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27a.75.75 0 01.816.316l.867 1.302a.75.75 0 00.816.316l1.084-.27z" />
      ),
    },
    {
      id: 'privacy',
      label: t('settings.categories.privacy'),
      icon: (
        <path d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      ),
    },
    {
      id: 'performance',
      label: t('settings.categories.performance'),
      icon: <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />,
    },
    {
      id: 'notifications',
      label: t('settings.categories.notifications'),
      icon: (
        <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      ),
    },
    {
      id: 'collaboration',
      label: t('settings.categories.collaboration'),
      icon: (
        <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      ),
    },
    {
      id: 'integrations',
      label: t('settings.categories.integrations'),
      icon: (
        <path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
      ),
    },
    {
      id: 'backup',
      label: t('settings.categories.backup'),
      icon: (
        <path d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0v-7.5A2.25 2.25 0 018.25 2.25h13.5A2.25 2.25 0 0124 4.5v7.5m-19.5 0v7.5a2.25 2.25 0 002.25 2.25h13.5a2.25 2.25 0 002.25-2.25v-7.5" />
      ),
    },
    {
      id: 'data',
      label: t('settings.categories.data'),
      icon: (
        <path d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125v-1.5c0-.621.504-1.125 1.125-1.125m17.25 0h.008v.008h-.008v-.008zm-17.25 0a1.125 1.125 0 00-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25 0h.008v.008h-.008v-.008zM6 16.5V9.75m6.75 6.75V9.75m6.75 6.75V9.75M9 9.75h.008v.008H9v-.008zm3.75 0h.008v.008h-.008v-.008zm3.75 0h.008v.008h-.008v-.008z" />
      ),
    },
    { id: 'about', label: t('settings.categories.about'), icon: ICONS.HELP },
  ];

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return <GeneralSection />;
      case 'appearance':
        return <AppearanceSection />;
      case 'editor':
        return <EditorSection />;
      case 'advanced-editor':
        return <AdvancedEditorSection />;
      case 'ai':
        return <AiSection />;
      case 'advanced-ai':
        return <AdvancedAiSection />;
      case 'accessibility':
        return <AccessibilitySection />;
      case 'privacy':
        return <PrivacySection />;
      case 'performance':
        return <PerformanceSection />;
      case 'notifications':
        return <NotificationsSection />;
      case 'collaboration':
        return <CollaborationSection />;
      case 'integrations':
        return <IntegrationsSection />;
      case 'backup':
        return <BackupSection />;
      case 'data':
        return <DataSection />;
      case 'about':
        return <AboutSection />;
      default:
        return null;
    }
  };

  return (
    <div>
      {/* Mobile Navigation */}
      <div className="md:hidden mb-6">
        <label
          htmlFor="settings-category"
          className="block text-sm font-medium text-[var(--foreground-secondary)] mb-2"
        >
          Category
        </label>
        <Select
          id="settings-category"
          value={activeCategory}
          onChange={(e) => setActiveCategory(e.target.value)}
          className="w-full"
        >
          {navCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Desktop Navigation */}
        <div className="hidden md:block md:col-span-1">
          <div className="space-y-2 sticky top-20">
            {navCategories.map((cat) => (
              <NavButton
                key={cat.id}
                icon={cat.icon}
                label={cat.label}
                isActive={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              />
            ))}
          </div>
        </div>
        <div className="md:col-span-3">{renderContent()}</div>
      </div>
      <SettingsModals />
    </div>
  );
};

export const SettingsView: FC = () => {
  const contextValue = useSettingsView();
  return (
    <SettingsViewContext.Provider value={contextValue}>
      <SettingsViewUI />
    </SettingsViewContext.Provider>
  );
};
