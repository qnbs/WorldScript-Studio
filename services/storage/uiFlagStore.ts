// QNBS-v3: tiny SYNCHRONOUS key-value helper for non-sensitive, ephemeral UI flags (coachmark
// "seen" dismissals, one-time hints). Centralizes localStorage access behind a services/storage
// abstraction so UI-pref persistence isn't scattered across raw localStorage calls.
//
// NOT for project data or anything sensitive — that goes through storageService / dbService
// (async, IndexedDB/filesystem, AES-256-GCM at rest). This is deliberately synchronous so React
// state can be seeded during render without a flash, which the async project-storage layer cannot do.

const PREFIX = 'worldscript-';

// QNBS-v3: module-level session fallback. When localStorage is blocked (private mode, embedded
// webview), persistence falls back to this map so a dismissal still survives component
// unmount/remount within the session — otherwise a coachmark would reappear on every navigation.
const sessionMemory = new Map<string, boolean>();

export const uiFlagStore = {
  /** Read a boolean UI flag. The session map is authoritative once a key has been written this
   *  session (true OR false), so a failed-removal stale '1' in localStorage can't resurrect a
   *  cleared flag; only falls back to localStorage when the key was never set this session. */
  get(key: string): boolean {
    if (sessionMemory.has(key)) return sessionMemory.get(key) === true;
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(`${PREFIX}${key}`) === '1';
    } catch {
      return false;
    }
  },
  /** Persist a boolean UI flag. Always records the session map; localStorage is best-effort. */
  set(key: string, value: boolean): void {
    sessionMemory.set(key, value);
    try {
      if (typeof localStorage === 'undefined') return;
      if (value) localStorage.setItem(`${PREFIX}${key}`, '1');
      else localStorage.removeItem(`${PREFIX}${key}`);
    } catch {
      // storage unavailable — the session map above keeps the value for this session
    }
  },
  /** Test-only: clear the module-level session map so unit tests start from a clean store. */
  _resetForTest(): void {
    sessionMemory.clear();
  },
};
