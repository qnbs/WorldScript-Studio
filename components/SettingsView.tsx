import type { FC } from 'react';
import React, { useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { ICONS } from '../constants';
import { SettingsViewContext, useSettingsViewContext } from '../contexts/SettingsViewContext';
import { useSettingsView } from '../hooks/useSettingsView';
import { SETTINGS_CATEGORY_SEARCH_HINTS } from '../services/settingsSearchHints';
import { AiExecutionModeSection } from './settings/AiExecutionModeSection';
import { AdvancedAiSection, AiSection } from './settings/AiSections';
import { CommunitySection } from './settings/CommunitySection';
import { DataSection } from './settings/DataSection';
import { DesktopSection } from './settings/DesktopSection';
import { AdvancedEditorSection, EditorSection } from './settings/EditorSections';
import { FeatureFlagsSection } from './settings/FeatureFlagsSection';
import { AboutSection, AppearanceSection, GeneralSection } from './settings/GeneralSections';
import { LocalAiSection } from './settings/LocalAiSection';
import { LoraAdapterSection } from './settings/LoraAdapterSection';
import { OpenRouterSection } from './settings/OpenRouterSection';
import { PluginsSection } from './settings/PluginsSection';
import { ProjectAiPresetSection } from './settings/ProjectAiPresetSection';
import { SettingsGuideSection } from './settings/SettingsGuideSection';
import { SettingsModals } from './settings/SettingsModals';
import { SettingsOverviewCard } from './settings/SettingsOverviewCard';
import { ShortcutsSection } from './settings/ShortcutsSection';
import {
  AccessibilitySection,
  BackupSection,
  CollaborationSection,
  IntegrationsSection,
  NotificationsSection,
  PerformanceSection,
  PrivacySection,
} from './settings/SystemSections';
import { TauriUpdaterBanner } from './settings/TauriUpdaterBanner';
import { VoiceSettingsSection } from './settings/VoiceSettingsSection';
import { Input } from './ui/Input';
import { SectionIcon } from './ui/SectionIcon';
import { Spinner } from './ui/Spinner';
import { ViewErrorBoundary } from './ui/ViewErrorBoundary';

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
    className={`flex items-center flex-shrink-0 md:flex-shrink md:w-full px-3 py-2 text-left rounded-md transition-colors whitespace-nowrap md:whitespace-normal ${isActive ? 'bg-[var(--nav-background-active)] text-[var(--nav-text-active)]' : 'hover:bg-[var(--nav-background-hover)] text-[var(--sc-text-secondary)] hover:text-[var(--sc-text-primary)]'}`}
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

const NavGroupHeader: FC<{ label: string }> = ({ label }) => (
  <div className="px-3 pt-3 pb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--sc-text-muted)] select-none">
    {label}
  </div>
);
NavGroupHeader.displayName = 'NavGroupHeader';

// X-1: category IDs grouped for sidebar nav; internal section IDs and renderContent() switch unchanged.
const NAV_GROUPS = [
  { key: 'writing', ids: ['editor', 'advanced-editor', 'project-ai'] },
  { key: 'aiModels', ids: ['ai', 'local-ai', 'advanced-ai', 'openrouter', 'lora-adapters'] },
  { key: 'appearanceAccessibility', ids: ['appearance', 'accessibility'] },
  { key: 'privacyData', ids: ['privacy', 'data', 'backup'] },
  {
    key: 'connections',
    ids: ['collaboration', 'voice', 'integrations', 'notifications', 'community'],
  },
  { key: 'system', ids: ['performance', 'plugins', 'shortcuts', 'guide', 'experimental', 'about'] },
] as const satisfies ReadonlyArray<{ key: string; ids: readonly string[] }>;

// ─── Main Settings UI ─────────────────────────────────────────────────────────

const SettingsViewUI: FC = () => {
  const { t, project, activeCategory, setActiveCategory } = useSettingsViewContext();
  const enableVoiceSupport = useAppSelector((s) => s.featureFlags.enableVoiceSupport);
  const [settingsQuery, setSettingsQuery] = useState('');

  const navCategories = useMemo(
    () => [
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
        id: 'local-ai',
        label: t('settings.categories.localAi'),
        // QNBS-v3: on-device chip icon — distinguishes Local AI from the cloud-leaning AI section.
        icon: (
          <path d="M9 3v2.25M15 3v2.25M9 18.75V21M15 18.75V21M5.25 9H3m2.25 6H3m18-6h-2.25M21 15h-2.25M6.75 6.75h10.5v10.5H6.75V6.75zM9.75 9.75h4.5v4.5h-4.5v-4.5z" />
        ),
      },
      {
        id: 'advanced-ai',
        label: t('settings.categories.advancedAi'),
        icon: (
          <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        ),
      },
      {
        id: 'community',
        label: t('settings.categories.community'),
        icon: (
          <path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        ),
      },
      {
        id: 'plugins',
        label: t('settings.categories.plugins'),
        icon: (
          <path d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
        ),
      },
      {
        id: 'lora-adapters',
        label: t('settings.categories.loraAdapters'),
        icon: (
          <path d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
        ),
      },
      {
        id: 'openrouter',
        label: t('settings.categories.openrouter'),
        icon: (
          // QNBS-v3: OpenRouter cloud-gateway icon — route/relay path shape.
          <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
        ),
      },
      {
        id: 'project-ai',
        label: t('settings.categories.projectAi'),
        icon: (
          <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
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
      // QNBS-v3: Voice nav item shown only when enableVoiceSupport is on — keeps Settings nav
      // clean for users who have not enabled voice, and satisfies the "absent when flag off" E2E test.
      ...(enableVoiceSupport
        ? [
            {
              id: 'voice',
              label: t('settings.categories.voice'),
              icon: (
                <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              ),
            },
          ]
        : []),
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
      {
        id: 'guide',
        label: t('settings.categories.guide'),
        icon: (
          <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        ),
      },
      {
        id: 'experimental',
        label: t('settings.categories.experimental'),
        icon: (
          <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 00 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 00 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 00 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 00 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456Z" />
        ),
      },
      { id: 'about', label: t('settings.categories.about'), icon: ICONS.HELP },
      {
        id: 'shortcuts',
        label: t('settings.categories.shortcuts'),
        icon: (
          <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H15M9 12h3.75M9 15.75h3.75M9 9h3.75" />
        ),
      },
    ],
    [t, enableVoiceSupport],
  );

  const q = settingsQuery.trim().toLowerCase();
  const filteredNavCategories = useMemo(() => {
    if (!q) return navCategories;
    return navCategories.filter((cat) => {
      const labelLower = cat.label.toLowerCase();
      if (labelLower.includes(q)) return true;
      const hints = SETTINGS_CATEGORY_SEARCH_HINTS[cat.id];
      return hints?.some((h) => h.includes(q)) ?? false;
    });
  }, [navCategories, q]);

  useEffect(() => {
    if (!q) return;
    const visible = filteredNavCategories.some((c) => c.id === activeCategory);
    if (!visible && filteredNavCategories[0]) {
      setActiveCategory(filteredNavCategories[0].id);
    }
  }, [q, filteredNavCategories, activeCategory, setActiveCategory]);

  if (!project)
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <Spinner className="w-16 h-16" />
      </div>
    );

  const renderContent = () => {
    switch (activeCategory) {
      case 'guide':
        return <SettingsGuideSection />;
      case 'experimental':
        return <FeatureFlagsSection />;
      case 'general':
        return (
          <div className="space-y-6">
            <SettingsOverviewCard />
            <GeneralSection />
          </div>
        );
      case 'appearance':
        return <AppearanceSection />;
      case 'editor':
        return <EditorSection />;
      case 'advanced-editor':
        return <AdvancedEditorSection />;
      case 'ai':
        return (
          <div className="space-y-8">
            <AiExecutionModeSection />
            <AiSection />
          </div>
        );
      case 'local-ai':
        return <LocalAiSection />;
      case 'advanced-ai':
        return <AdvancedAiSection />;
      case 'community':
        return <CommunitySection />;
      case 'plugins':
        return <PluginsSection />;
      case 'openrouter':
        return (
          <ViewErrorBoundary viewLabel={t('settings.categories.openrouter')}>
            <OpenRouterSection />
          </ViewErrorBoundary>
        );
      case 'lora-adapters':
        return <LoraAdapterSection />;
      case 'project-ai':
        return <ProjectAiPresetSection />;
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
        return (
          <div className="space-y-6">
            <TauriUpdaterBanner />
            <DesktopSection />
            <AboutSection />
          </div>
        );
      case 'shortcuts':
        return <ShortcutsSection />;
      case 'voice':
        return <VoiceSettingsSection />;
      default:
        return null;
    }
  };

  return (
    <div>
      {/* QNBS-v3: view-level header with colored SSOT icon */}
      <div className="flex items-center gap-3 mb-6">
        <SectionIcon section="settings" size="lg" />
        <h1 className="text-2xl font-bold text-[var(--sc-text-primary)]">
          {t('sidebar.settings')}
        </h1>
      </div>
      <div className="mb-6 max-w-xl">
        <Input
          type="search"
          value={settingsQuery}
          onChange={(e) => setSettingsQuery(e.target.value)}
          placeholder={t('settings.search.placeholder')}
          aria-label={t('settings.search.placeholder')}
          autoComplete="off"
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-8">
        <div className="md:col-span-1">
          {/* Mobile: horizontal scroll strip · Desktop: vertically sticky + independently scrollable sidebar */}
          {/* QNBS-v3: md:max-h-[calc(100vh-8rem)] + overflow-y-auto keeps the nav visible while the content panel scrolls — LA-3. */}
          <div className="flex md:flex-col gap-2 md:space-y-2 md:gap-0 overflow-x-auto md:overflow-x-visible md:overflow-y-auto no-scrollbar pb-2 md:pb-0 sticky top-0 md:top-20 md:max-h-[calc(100vh-8rem)] z-10 bg-[var(--sc-surface-base)] md:bg-transparent -mx-4 px-4 md:mx-0 md:px-0 pt-2 md:pt-0">
            {filteredNavCategories.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--sc-text-muted)]">
                {t('settings.search.noResults')}
              </p>
            ) : q ? (
              // Search active: flat list without group headers
              filteredNavCategories.map((cat) => (
                <NavButton
                  key={cat.id}
                  icon={cat.icon}
                  label={cat.label}
                  isActive={activeCategory === cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                />
              ))
            ) : (
              // X-1: grouped nav — "General" first, then 6 semantic groups
              <>
                {navCategories
                  .filter((cat) => cat.id === 'general')
                  .map((cat) => (
                    <NavButton
                      key={cat.id}
                      icon={cat.icon}
                      label={cat.label}
                      isActive={activeCategory === cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                    />
                  ))}
                {NAV_GROUPS.map((group) => {
                  const groupCats = navCategories.filter((cat) =>
                    (group.ids as readonly string[]).includes(cat.id),
                  );
                  if (groupCats.length === 0) return null;
                  return (
                    <React.Fragment key={group.key}>
                      <NavGroupHeader label={t(`settings.categories.${group.key}`)} />
                      {groupCats.map((cat) => (
                        <NavButton
                          key={cat.id}
                          icon={cat.icon}
                          label={cat.label}
                          isActive={activeCategory === cat.id}
                          onClick={() => setActiveCategory(cat.id)}
                        />
                      ))}
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </div>
        </div>
        <div className="md:col-span-3 min-h-0 md:min-h-[60vh]">
          {filteredNavCategories.length === 0 && q ? (
            <p className="text-sm text-[var(--sc-text-muted)]">{t('settings.search.noResults')}</p>
          ) : (
            renderContent()
          )}
        </div>
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
