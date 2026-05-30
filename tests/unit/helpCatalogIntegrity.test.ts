/**
 * Validates the structural integrity of HELP_CATALOG:
 * - Every article titleKey and contentKey must be non-empty strings.
 * - No duplicate contentKey values (would mean copy-paste mistake).
 * - All referenced tryActionIds follow the expected naming pattern.
 * - The catalog has a minimum article count (regression: accidental truncation).
 */
import { describe, expect, it } from 'vitest';
import { HELP_CATALOG } from '../../services/help/helpCatalog';

describe('HELP_CATALOG integrity', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(HELP_CATALOG)).toBe(true);
    expect(HELP_CATALOG.length).toBeGreaterThan(0);
  });

  it('every category has a non-empty id, titleKey, icon, and articles array', () => {
    for (const cat of HELP_CATALOG) {
      expect(cat.id).toBeTruthy();
      expect(typeof cat.id).toBe('string');
      expect(cat.titleKey).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(Array.isArray(cat.articles)).toBe(true);
    }
  });

  it('every category has at least one article', () => {
    for (const cat of HELP_CATALOG) {
      expect(cat.articles.length).toBeGreaterThan(0);
    }
  });

  it('every article has non-empty titleKey and contentKey strings', () => {
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        expect(typeof article.titleKey).toBe('string');
        expect(article.titleKey.length).toBeGreaterThan(0);
        expect(typeof article.contentKey).toBe('string');
        expect(article.contentKey.length).toBeGreaterThan(0);
      }
    }
  });

  it('no duplicate contentKey values across all articles', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        if (seen.has(article.contentKey)) {
          duplicates.push(article.contentKey);
        }
        seen.add(article.contentKey);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('no duplicate category ids', () => {
    const ids = HELP_CATALOG.map((c) => c.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('tryActionId follows "nav-*" or "open-*" naming convention when present', () => {
    const validPrefixes = ['nav-', 'open-', 'focus-', 'toggle-'];
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        if (article.tryActionId) {
          const hasPrefix = validPrefixes.some((p) => article.tryActionId!.startsWith(p));
          expect(hasPrefix).toBe(true);
        }
      }
    }
  });

  it('has at least 50 articles total (regression: accidental truncation)', () => {
    const total = HELP_CATALOG.reduce((sum, cat) => sum + cat.articles.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it('settings-guide category exists and contains expected articles', () => {
    const settingsGuide = HELP_CATALOG.find((c) => c.id === 'settings-guide');
    expect(settingsGuide).toBeDefined();
    const keys = settingsGuide!.articles.map((a) => a.titleKey);
    expect(keys).toContain('help.settingsGuide.overview.title');
    expect(keys).toContain('help.settingsGuide.ai.title');
    expect(keys).toContain('help.settingsGuide.accessibility.title');
    expect(keys).toContain('help.settingsGuide.flags.title');
    expect(keys).toContain('help.settingsGuide.shortcuts.title');
    expect(keys).toContain('help.settingsGuide.pwaInstall.title');
  });

  it('documentation category contains architecture, dataModel, and pwaDesktop articles', () => {
    const docs = HELP_CATALOG.find((c) => c.id === 'documentation');
    expect(docs).toBeDefined();
    const keys = docs!.articles.map((a) => a.titleKey);
    expect(keys).toContain('help.docs.architecture.title');
    expect(keys).toContain('help.docs.dataModel.title');
    expect(keys).toContain('help.docs.pwaDesktop.title');
  });
});
