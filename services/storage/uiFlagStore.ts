// QNBS-v3: tiny SYNCHRONOUS key-value helper for non-sensitive, ephemeral UI flags (coachmark
// "seen" dismissals, one-time hints). Centralizes localStorage access behind a services/storage
// abstraction so UI-pref persistence isn't scattered across raw localStorage calls.
//
// NOT for project data or anything sensitive — that goes through storageService / dbService
// (async, IndexedDB/filesystem, AES-256-GCM at rest). This is deliberately synchronous so React
// state can be seeded during render without a flash, which the async project-storage layer cannot do.

const PREFIX = 'worldscript-';

export const uiFlagStore = {
  /** Read a boolean UI flag. Returns false when unset or when storage is unavailable. */
  get(key: string): boolean {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(`${PREFIX}${key}`) === '1';
    } catch {
      return false;
    }
  },
  /** Persist a boolean UI flag. Silently degrades when storage is blocked (e.g. private mode). */
  set(key: string, value: boolean): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (value) localStorage.setItem(`${PREFIX}${key}`, '1');
      else localStorage.removeItem(`${PREFIX}${key}`);
    } catch {
      // storage unavailable — non-fatal for ephemeral UI prefs
    }
  },
};
