import { describe, expect, it } from 'vitest';
import { SETTINGS_CATEGORY_SEARCH_HINTS } from '../../services/settingsSearchHints';

describe('SETTINGS_CATEGORY_SEARCH_HINTS', () => {
  it('has entries for all main categories', () => {
    const keys = Object.keys(SETTINGS_CATEGORY_SEARCH_HINTS);
    expect(keys).toContain('general');
    expect(keys).toContain('appearance');
    expect(keys).toContain('editor');
    expect(keys).toContain('ai');
    expect(keys).toContain('accessibility');
    expect(keys).toContain('data');
    expect(keys).toContain('shortcuts');
  });

  it('each category has at least one keyword', () => {
    for (const [cat, keywords] of Object.entries(SETTINGS_CATEGORY_SEARCH_HINTS)) {
      expect(Array.isArray(keywords), `${cat} should have array`).toBe(true);
      expect(keywords.length, `${cat} should have keywords`).toBeGreaterThan(0);
    }
  });

  it('appearance category contains theme keyword', () => {
    expect(SETTINGS_CATEGORY_SEARCH_HINTS['appearance']).toContain('theme');
  });

  it('accessibility category contains a11y keyword', () => {
    expect(SETTINGS_CATEGORY_SEARCH_HINTS['accessibility']).toContain('a11y');
  });

  it('shortcuts category contains keyboard keyword', () => {
    expect(SETTINGS_CATEGORY_SEARCH_HINTS['shortcuts']).toContain('keyboard');
  });

  it('all keywords are lowercase strings', () => {
    for (const keywords of Object.values(SETTINGS_CATEGORY_SEARCH_HINTS)) {
      for (const kw of keywords) {
        expect(typeof kw).toBe('string');
        expect(kw).toBe(kw.toLowerCase());
      }
    }
  });

  // QNBS-v3: guard against hints for removed settings categories (the dead-toggle audit deleted the
  // performance/notifications/backup sections) — a stale hint would surface a nav category that no
  // longer exists.
  it('has no hints for removed settings categories', () => {
    const keys = Object.keys(SETTINGS_CATEGORY_SEARCH_HINTS);
    expect(keys).not.toContain('performance');
    expect(keys).not.toContain('notifications');
    expect(keys).not.toContain('backup');
  });
});
