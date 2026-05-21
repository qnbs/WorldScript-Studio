/** Ambient types for Tauri plugins loaded only in desktop runtime (dynamic import). */

declare module '@tauri-apps/plugin-updater' {
  export type Update = {
    version: string;
    downloadAndInstall(): Promise<void>;
  };
  export function check(): Promise<Update | null>;
}

declare module '@tauri-apps/plugin-process' {
  export function relaunch(): Promise<void>;
}

declare module '@tauri-apps/plugin-shell' {
  export function open(path: string): Promise<void>;
}
