import React, { useEffect } from 'react';
import { ICONS } from '../constants';
import { useTranslation } from '../hooks/useTranslation';
import type { View } from '../types';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  /** Spotlight tour anchor (`data-tour`) */
  dataTour?: string;
}> = React.memo(({ icon, label, isActive, onClick, dataTour }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour={dataTour}
      className={`relative flex items-center w-full px-4 py-3 text-left rounded-xl transition-all duration-300 group touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] overflow-hidden ${
        isActive
          ? 'bg-gradient-to-r from-[var(--nav-background-active)] to-transparent text-[var(--nav-text-active)] shadow-sm font-semibold'
          : 'text-[var(--foreground-secondary)] hover:bg-[var(--nav-background-hover)] hover:text-[var(--foreground-primary)] font-medium'
      }`}
      aria-current={isActive ? 'page' : undefined}
    >
      {isActive && (
        <>
          <span className="absolute left-0 h-full top-0 w-1 bg-[var(--nav-border-active)] shadow-[0_0_15px_2px_var(--nav-border-active)]"></span>
          <span className="absolute inset-0 bg-gradient-to-r from-[var(--nav-border-active)]/10 to-transparent pointer-events-none"></span>
        </>
      )}
      <div className={`relative z-10 flex items-center`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={isActive ? 2 : 1.5}
          stroke="currentColor"
          className={`w-5 h-5 mr-3 transition-transform duration-300 ${isActive ? 'scale-110 text-[var(--nav-text-active)]' : 'group-hover:scale-110 text-[var(--foreground-muted)] group-hover:text-[var(--foreground-primary)]'}`}
          aria-hidden="true"
        >
          {icon}
        </svg>
        <span className="text-sm tracking-wide">{label}</span>
      </div>
    </button>
  );
});
NavItem.displayName = 'NavItem';

/** Bottom tab bar item for mobile */
const BottomTabItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ icon, label, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center justify-center flex-1 py-1.5 transition-colors duration-200 touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] rounded-lg ${
      isActive ? 'text-[var(--nav-text-active)]' : 'text-[var(--foreground-muted)]'
    }`}
    aria-current={isActive ? 'page' : undefined}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={isActive ? 2 : 1.5}
      stroke="currentColor"
      className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}
      aria-hidden="true"
    >
      {icon}
    </svg>
    <span
      className={`text-[10px] mt-0.5 leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}
    >
      {label}
    </span>
    {isActive && (
      <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-[var(--nav-border-active)] shadow-[0_0_8px_1px_var(--nav-border-active)]" />
    )}
  </button>
));
BottomTabItem.displayName = 'BottomTabItem';

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isSidebarOpen,
  setIsSidebarOpen,
}) => {
  const { t } = useTranslation();

  const handleNavigation = (view: View) => {
    onNavigate(view);
    setIsSidebarOpen(false);
  };

  // Close sidebar on Escape key (mobile)
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen, setIsSidebarOpen]);

  const allNavItems = [
    { id: 'dashboard', label: t('sidebar.dashboard'), icon: ICONS.DASHBOARD },
    { id: 'manuscript', label: t('sidebar.manuscript'), icon: ICONS.WRITER },
    { id: 'writer', label: t('sidebar.writer'), icon: ICONS.SPARKLES },
    { id: 'templates', label: t('sidebar.templates'), icon: ICONS.TEMPLATES },
    { id: 'outline', label: t('sidebar.outline'), icon: ICONS.OUTLINE },
    {
      id: 'characters',
      label: t('sidebar.characters'),
      icon: ICONS.CHARACTERS,
    },
    { id: 'world', label: t('sidebar.world'), icon: ICONS.WORLD },
    {
      id: 'sceneboard',
      label: t('sidebar.sceneboard'),
      icon: ICONS.SCENEBOARD,
    },
    {
      id: 'characterGraph',
      label: t('sidebar.characterGraph'),
      icon: ICONS.CHARACTERGRAPH,
    },
    {
      id: 'consistencyChecker',
      label: t('sidebar.consistencyChecker'),
      icon: ICONS.CONSISTENCYCHECKER,
    },
    { id: 'critic', label: t('sidebar.critic'), icon: ICONS.CRITIC },
    { id: 'export', label: t('sidebar.export'), icon: ICONS.EXPORT },
    { id: 'settings', label: t('sidebar.settings'), icon: ICONS.SETTINGS },
    { id: 'help', label: t('sidebar.help'), icon: ICONS.HELP },
  ];

  // Desktop sidebar: main items vs bottom items
  const desktopNavItems = allNavItems.filter((i) => i.id !== 'settings' && i.id !== 'help');
  const desktopBottomItems = allNavItems.filter((i) => i.id === 'settings' || i.id === 'help');

  // Mobile bottom tab bar: 5 key views (the 5th is "More" to open the sheet)
  const mobileTabBarItems = [
    { id: 'dashboard', label: t('sidebar.dashboard'), icon: ICONS.DASHBOARD },
    { id: 'manuscript', label: t('sidebar.manuscript'), icon: ICONS.WRITER },
    { id: 'writer', label: t('sidebar.writer'), icon: ICONS.SPARKLES },
    { id: 'characters', label: t('sidebar.characters'), icon: ICONS.CHARACTERS },
  ];

  // Check if current view is one of the tab bar views
  const isTabBarView = mobileTabBarItems.some((item) => item.id === currentView);

  return (
    <>
      {/* ── Mobile bottom navbar ── */}
      <nav
        data-tour="nav-mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--background-secondary)]/95 backdrop-blur-xl border-t border-[var(--border-primary)] flex items-center safe-bottom"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        aria-label="Mobile navigation"
      >
        {mobileTabBarItems.map((item) => (
          <BottomTabItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={currentView === item.id}
            onClick={() => handleNavigation(item.id as View)}
          />
        ))}
        {/* "More" button opens the bottom sheet */}
        <BottomTabItem
          icon={ICONS.MENU}
          label={t('common.more')}
          isActive={isSidebarOpen || !isTabBarView}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        />
      </nav>

      {/* ── Mobile overlay backdrop ── */}
      <div
        className={`fixed inset-0 bg-[var(--overlay-backdrop)] backdrop-blur-sm z-40 transition-opacity duration-300 md:hidden ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* ── Mobile bottom sheet ── */}
      <aside
        id="sidebar-mobile"
        aria-label="Navigation"
        aria-hidden={!isSidebarOpen ? true : undefined}
        className={`
          md:hidden fixed left-0 right-0 bottom-0 z-50
          bg-[var(--background-secondary)] backdrop-blur-3xl
          rounded-t-2xl shadow-2xl
          max-h-[75dvh] overflow-hidden
          flex flex-col
          transform transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]
          ${isSidebarOpen ? 'translate-y-0' : 'translate-y-full'}
        `}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Drag handle */}
        <button
          type="button"
          className="flex justify-center pt-3 pb-2 w-full bg-transparent border-none cursor-pointer"
          onClick={() => setIsSidebarOpen(false)}
          aria-label={t('common.cancel')}
        >
          <div className="w-10 h-1 rounded-full bg-[var(--foreground-muted)]/40" />
        </button>
        <div className="overflow-y-auto overscroll-contain px-3 pb-4 space-y-1.5">
          {allNavItems.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={currentView === item.id}
              onClick={() => handleNavigation(item.id as View)}
              {...(item.id === 'settings' ? { dataTour: 'nav-settings' as const } : {})}
            />
          ))}
        </div>
      </aside>

      {/* ── Desktop sidebar (unchanged) ── */}
      <aside
        id="sidebar"
        data-tour="sidebar-desktop"
        aria-label="Hauptnavigation"
        className={`
        hidden md:flex
        bg-transparent
        w-64 fixed top-16 left-0 h-[calc(100vh-4rem)] z-40 
        flex-col justify-between 
        border-r border-[var(--border-primary)]
        py-4 px-3
      `}
      >
        <div className="flex-grow flex flex-col overflow-y-auto no-scrollbar space-y-6">
          <nav className="flex flex-col space-y-1.5" aria-label="Main navigation">
            {desktopNavItems.map((item) => (
              <NavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                isActive={currentView === item.id}
                onClick={() => handleNavigation(item.id as View)}
              />
            ))}
          </nav>
        </div>
        <nav
          className="flex flex-col space-y-1.5 mt-4 border-t border-[var(--border-primary)] pt-4"
          aria-label="Secondary navigation"
        >
          {desktopBottomItems.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={currentView === item.id}
              onClick={() => handleNavigation(item.id as View)}
              {...(item.id === 'settings' ? { dataTour: 'nav-settings' as const } : {})}
            />
          ))}
        </nav>
      </aside>
    </>
  );
};
