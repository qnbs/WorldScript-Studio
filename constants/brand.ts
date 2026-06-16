/**
 * Centralized product identity — the single source for the display name and the file-name slug.
 *
 * QNBS-v3: brand strings are intentionally NOT in the i18n catalog. A product name is identical
 * across every locale and must never be accidentally translated (or drift between components).
 * Prefer these constants over hardcoding `'WorldScript Studio'` / `'worldscript'` in components.
 */
export const APP_NAME = 'WorldScript Studio';

/** Lowercase, filesystem-safe slug for generated artefacts (download filenames, key prefixes). */
export const APP_FILE_SLUG = 'worldscript';
