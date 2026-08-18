// QNBS-v3: exports types + both reference adapters — runtime selection (which one to instantiate) is app-level wiring, see services/desktopPlatform.ts.

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
  DesktopWriteOptions,
  LoraAbortOutcome,
  LoraMergeRequest,
  LoraOllamaModelfileRequest,
  LoraTrainingEnvironmentResult,
  LoraTrainingProgressEvent,
  LoraTrainRequest,
  RuntimeInfo,
  TauriMenuBuilderApi,
  TauriTrayBuilderApi,
} from './types';
