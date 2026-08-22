// QNBS-v3: exports types + both reference adapters — runtime selection (which one to instantiate) is app-level wiring, see services/desktopPlatform.ts.

export { tauriDesktopPlatform } from './adapters/tauriDesktopPlatform';
export { webDesktopPlatform } from './adapters/webDesktopPlatform';
export { sanitizeDiagnosticsContext, sanitizeDiagnosticsValue } from './diagnostics';
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
  DesktopProject,
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
  ProjectValidationResult,
  RuntimeInfo,
  TauriMenuBuilderApi,
  TauriTrayBuilderApi,
} from './types';
export { PROJECT_VALIDATE_CONTRACT_VERSION, ProjectValidationResultSchema } from './types';
