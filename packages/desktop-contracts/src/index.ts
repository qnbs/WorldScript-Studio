// QNBS-v3: Wave 1 (docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md §8) — renderer-neutral DesktopPlatform
//          contract. This package exports TYPES and both reference adapters; runtime selection
//          (which adapter to instantiate) is app-level wiring — see services/desktopPlatform.ts.

export { tauriDesktopPlatform } from './adapters/tauriDesktopPlatform';
export { webDesktopPlatform } from './adapters/webDesktopPlatform';
export type {
  DesktopClipboard,
  DesktopCloseRequestedEvent,
  DesktopDeepLinks,
  DesktopDiagnostics,
  DesktopDialogs,
  DesktopDirEntry,
  DesktopFilesystem,
  DesktopLifecycle,
  DesktopMenu,
  DesktopNotifications,
  DesktopOsKind,
  DesktopPendingUpdate,
  DesktopPersistence,
  DesktopPlatform,
  DesktopTasks,
  DesktopTray,
  DesktopUpdater,
  DesktopWindow,
  RuntimeInfo,
  TauriMenuBuilderApi,
  TauriTrayBuilderApi,
} from './types';
