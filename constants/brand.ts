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

/**
 * QNBS-v3 (F-10, 2026-07-29): the canonical, live Vercel deployment URL — single source of truth,
 * defined once to prevent re-drift. A stale `worldscript-studio-indol.vercel.app` URL (a dead
 * preview-deployment domain, confirmed 404) had drifted into the in-app link and the Italian
 * locale; both now reference this constant / are kept in sync with it. Verify liveness before
 * changing: this is the only URL that actually resolves (200) among the domains found in the repo.
 */
export const PRODUCTION_URL = 'https://worldscript-studio.vercel.app/';
