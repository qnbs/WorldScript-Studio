// QNBS-v3: Pure roster metrics shared by the Characters + World Building views — completeness
// scoring, search filtering, and sorting. Kept framework-free so it is trivially unit-testable
// and reusable by any future entity roster (objects, factions, …).
import type { Character, World } from '../types';

/** Character dossier fields that count toward a "fully developed" profile. */
export const CHARACTER_TEXT_FIELDS = [
  'backstory',
  'motivation',
  'appearance',
  'personalityTraits',
  'flaws',
  'characterArc',
  'relationships',
  'notes',
] as const;

/** 0–100 completeness for a character: filled text fields + portrait, evenly weighted. */
export function characterCompleteness(c: Character): number {
  const total = CHARACTER_TEXT_FIELDS.length + 1; // +1 for the portrait
  let filled = 0;
  for (const field of CHARACTER_TEXT_FIELDS) {
    if ((c[field] ?? '').trim().length > 0) filled++;
  }
  if (c.hasAvatar) filled++;
  return Math.round((filled / total) * 100);
}

/** World atlas text fields that count toward a "fully developed" world. */
export const WORLD_TEXT_FIELDS = [
  'description',
  'geography',
  'culture',
  'magicSystem',
  'notes',
] as const;

/** 0–100 completeness for a world: filled text fields + ambiance image + timeline + locations. */
export function worldCompleteness(w: World): number {
  const total = WORLD_TEXT_FIELDS.length + 3; // + image + timeline + locations
  let filled = 0;
  for (const field of WORLD_TEXT_FIELDS) {
    if ((w[field] ?? '').trim().length > 0) filled++;
  }
  if (w.hasAmbianceImage) filled++;
  if ((w.timeline?.length ?? 0) > 0) filled++;
  if ((w.locations?.length ?? 0) > 0) filled++;
  return Math.round((filled / total) * 100);
}

export type RosterSort = 'name-asc' | 'name-desc' | 'complete-desc' | 'complete-asc';

export const ROSTER_SORT_OPTIONS: { value: RosterSort; labelKey: string }[] = [
  { value: 'name-asc', labelKey: 'roster.sort.nameAsc' },
  { value: 'name-desc', labelKey: 'roster.sort.nameDesc' },
  { value: 'complete-desc', labelKey: 'roster.sort.completeDesc' },
  { value: 'complete-asc', labelKey: 'roster.sort.completeAsc' },
];

/** Case-insensitive substring filter over a projected text. Empty query returns the input. */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => text(item).toLowerCase().includes(needle));
}

/** Non-mutating sort by the selected mode. */
export function sortByMode<T>(
  items: readonly T[],
  mode: RosterSort,
  name: (item: T) => string,
  complete: (item: T) => number,
): T[] {
  const arr = [...items];
  switch (mode) {
    case 'name-asc':
      return arr.sort((a, b) => name(a).localeCompare(name(b)));
    case 'name-desc':
      return arr.sort((a, b) => name(b).localeCompare(name(a)));
    case 'complete-desc':
      return arr.sort((a, b) => complete(b) - complete(a) || name(a).localeCompare(name(b)));
    case 'complete-asc':
      return arr.sort((a, b) => complete(a) - complete(b) || name(a).localeCompare(name(b)));
  }
}
