import type {
  DesktopClipboard,
  DesktopDeepLinks,
  DesktopDiagnostics,
  DesktopDialogs,
  DesktopFilesystem,
  DesktopLifecycle,
  DesktopMenu,
  DesktopNotifications,
  DesktopPersistence,
  DesktopPlatform,
  DesktopTasks,
  DesktopTray,
  DesktopUpdater,
  DesktopWindow,
  RuntimeInfo,
} from '../types';

// QNBS-v3: mirrors desktopNotifications.ts's never-throw convention — every facet resolves a safe default on web instead of rejecting, so callers never need a platform-specific branch.

const filesystemUnavailable = (): never => {
  throw new Error('DesktopPlatform.filesystem is unavailable on the web/PWA build');
};

const filesystem: DesktopFilesystem = {
  readTextFile: async () => filesystemUnavailable(),
  writeTextFile: async () => filesystemUnavailable(),
  writeTextFileAtomic: async () => filesystemUnavailable(),
  readFile: async () => filesystemUnavailable(),
  writeFile: async () => filesystemUnavailable(),
  writeFileAtomic: async () => filesystemUnavailable(),
  mkdir: async () => filesystemUnavailable(),
  exists: async () => false,
  readDir: async () => [],
  remove: async () => filesystemUnavailable(),
  rename: async () => filesystemUnavailable(),
};

const persistence: DesktopPersistence = {
  appDataDir: async () => filesystemUnavailable(),
  join: async (...parts) => parts.join('/'),
};

const dialogs: DesktopDialogs = {
  openFilePicker: async () => null,
  saveFilePicker: async () => null,
};

const windowFacet: DesktopWindow = {
  show: async () => {},
  hide: async () => {},
  setFocus: async () => {},
};

const menu: DesktopMenu = {
  loadMenuBuilder: async () => null,
  onMenuAction: async () => () => {},
};

const tray: DesktopTray = {
  loadTrayBuilder: async () => null,
};

const notifications: DesktopNotifications = {
  isPermissionGranted: async () => false,
  requestPermission: async () => false,
  send: async () => false,
};

const updater: DesktopUpdater = {
  getAppVersion: async () => null,
  check: async () => null,
  relaunch: async () => {},
};

const lifecycle: DesktopLifecycle = {
  quit: async () => {},
  onCloseRequested: async () => () => {},
};

const tasksUnavailable = (): never => {
  throw new Error('DesktopPlatform.tasks is unavailable on the web/PWA build');
};

const tasks: DesktopTasks = {
  submitTask: async () => tasksUnavailable(),
  pingSupervisor: async () => tasksUnavailable(),
  convertMarkdownToEpub: async () => null,
  trainLora: async () => tasksUnavailable(),
  abortLoraTraining: async () => tasksUnavailable(),
  mergeLora: async () => tasksUnavailable(),
  checkLoraEnvironment: async () => tasksUnavailable(),
  setLoraPythonPath: async () => tasksUnavailable(),
  generateOllamaModelfile: async () => tasksUnavailable(),
};

const diagnostics: DesktopDiagnostics = {
  getAppVersion: async () => null,
  openDataDirectory: async () => false,
};

const clipboard: DesktopClipboard = {
  readText: async () => null,
  writeText: async () => false,
};

const deepLinks: DesktopDeepLinks = {
  onDeepLink: async () => () => {},
};

const runtime: RuntimeInfo = { isDesktop: false, os: null };

/** Safe no-op implementation for the browser/PWA build — never throws except for hard filesystem/task calls that have no web equivalent. */
export const webDesktopPlatform: DesktopPlatform = {
  runtime,
  filesystem,
  persistence,
  dialogs,
  window: windowFacet,
  menu,
  tray,
  notifications,
  updater,
  lifecycle,
  tasks,
  diagnostics,
  clipboard,
  deepLinks,
};
