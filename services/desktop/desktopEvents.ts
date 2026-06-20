/**
 * QNBS-v3 (T1): Central registry for the native-desktop layer (menu / tray / global shortcuts).
 * Native surfaces are built in JS (ADR-D1) and route every action through the existing
 * `executeCommand(commandId)` sink (ADR-D3), so the contract lives here — one source of truth for
 * the command ids and Tauri event names later phases reuse.
 */

/** App command ids that native surfaces dispatch via `executeCommand`. Must exist in the registry. */
export const DESKTOP_COMMANDS = {
  export: 'nav-export',
  settings: 'nav-settings',
  help: 'nav-help',
  commandPalette: 'global-open-command-palette',
} as const;

export type DesktopCommandId = (typeof DESKTOP_COMMANDS)[keyof typeof DESKTOP_COMMANDS];
