const STORAGE_KEY = 'storycraft-palette-prefs-v1';
const MAX_RECENT = 15;
const MAX_PINNED = 20;

export interface PalettePreferences {
  recentIds: string[];
  pinnedIds: string[];
}

const defaultPrefs: PalettePreferences = {
  recentIds: [],
  pinnedIds: [],
};

export function loadPalettePreferences(): PalettePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultPrefs };
    const parsed = JSON.parse(raw) as Partial<PalettePreferences>;
    return {
      recentIds: Array.isArray(parsed.recentIds) ? parsed.recentIds.slice(0, MAX_RECENT) : [],
      pinnedIds: Array.isArray(parsed.pinnedIds) ? parsed.pinnedIds.slice(0, MAX_PINNED) : [],
    };
  } catch {
    return { ...defaultPrefs };
  }
}

export function savePalettePreferences(p: PalettePreferences): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        recentIds: p.recentIds.slice(0, MAX_RECENT),
        pinnedIds: p.pinnedIds.slice(0, MAX_PINNED),
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function recordRecentCommand(id: string): void {
  const cur = loadPalettePreferences();
  const next = cur.recentIds.filter((x) => x !== id);
  next.unshift(id);
  savePalettePreferences({
    ...cur,
    recentIds: next.slice(0, MAX_RECENT),
  });
}

export function togglePinnedCommand(id: string): boolean {
  const cur = loadPalettePreferences();
  const isPinned = cur.pinnedIds.includes(id);
  const pinnedIds = isPinned ? cur.pinnedIds.filter((x) => x !== id) : [...cur.pinnedIds, id];
  savePalettePreferences({
    ...cur,
    pinnedIds: pinnedIds.slice(0, MAX_PINNED),
  });
  return !isPinned;
}

export function isPinnedCommand(id: string): boolean {
  return loadPalettePreferences().pinnedIds.includes(id);
}
