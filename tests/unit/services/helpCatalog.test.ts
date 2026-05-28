/**
 * Tests for helpCatalog — structural validation of HELP_CATALOG and catalogToHelpCategories().
 * QNBS-v3: Data integrity tests prevent silent regressions when catalog entries are added/removed.
 */

import { describe, expect, it } from 'vitest';

import {
  catalogToHelpCategories,
  HELP_CATALOG,
  type HelpCategoryDef,
} from '../../../services/help/helpCatalog';

// ---------------------------------------------------------------------------
// HELP_CATALOG shape tests
// ---------------------------------------------------------------------------

describe('HELP_CATALOG', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(HELP_CATALOG)).toBe(true);
    expect(HELP_CATALOG.length).toBeGreaterThan(0);
  });

  it('every category has id, titleKey, icon, and articles array', () => {
    for (const cat of HELP_CATALOG) {
      expect(cat.id).toBeTruthy();
      expect(cat.titleKey).toBeTruthy();
      expect(cat.icon).toBeTruthy();
      expect(Array.isArray(cat.articles)).toBe(true);
    }
  });

  it('category ids are unique', () => {
    const ids = HELP_CATALOG.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every article has titleKey and contentKey', () => {
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        expect(article.titleKey).toBeTruthy();
        expect(article.contentKey).toBeTruthy();
      }
    }
  });

  it('titleKeys follow help.category.* prefix convention', () => {
    for (const cat of HELP_CATALOG) {
      expect(cat.titleKey).toMatch(/^help\./);
    }
  });

  it('contentKeys follow help.* prefix convention', () => {
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        expect(article.contentKey).toMatch(/^help\./);
      }
    }
  });

  it('tryActionIds, when present, are non-empty strings', () => {
    for (const cat of HELP_CATALOG) {
      for (const article of cat.articles) {
        if (article.tryActionId !== undefined) {
          expect(typeof article.tryActionId).toBe('string');
          expect(article.tryActionId.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('contains the expected top-level categories', () => {
    const ids = HELP_CATALOG.map((c) => c.id);
    expect(ids).toContain('getting-started');
    expect(ids).toContain('writing');
    expect(ids).toContain('ai-studio');
    expect(ids).toContain('settings-guide');
  });

  it('every category has at least one article', () => {
    for (const cat of HELP_CATALOG) {
      expect(cat.articles.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// catalogToHelpCategories() function tests
// ---------------------------------------------------------------------------

describe('catalogToHelpCategories', () => {
  let categories: ReturnType<typeof catalogToHelpCategories>;

  beforeEach(() => {
    categories = catalogToHelpCategories();
  });

  it('returns one entry per HELP_CATALOG category', () => {
    expect(categories.length).toBe(HELP_CATALOG.length);
  });

  it('maps category id, title (=titleKey), and icon correctly', () => {
    for (let i = 0; i < HELP_CATALOG.length; i++) {
      const src = HELP_CATALOG[i] as HelpCategoryDef;
      const mapped = categories[i];
      expect(mapped).toBeDefined();
      expect(mapped!.id).toBe(src.id);
      expect(mapped!.title).toBe(src.titleKey);
      expect(mapped!.icon).toBe(src.icon);
    }
  });

  it('maps each article title and content from the source keys', () => {
    const srcCat = HELP_CATALOG[0] as HelpCategoryDef;
    const mappedCat = categories[0];
    for (let j = 0; j < srcCat.articles.length; j++) {
      const srcArt = srcCat.articles[j]!;
      const mappedArt = mappedCat!.articles[j];
      expect(mappedArt).toBeDefined();
      expect(mappedArt!.title).toBe(srcArt.titleKey);
      expect(mappedArt!.content).toBe(srcArt.contentKey);
    }
  });

  it('includes tryActionId on articles that have it', () => {
    // Find a known article with tryActionId
    const gettingStarted = categories.find((c) => c.id === 'getting-started');
    expect(gettingStarted).toBeDefined();
    const withAction = gettingStarted!.articles.find((a) => 'tryActionId' in a);
    expect(withAction).toBeDefined();
    expect(typeof withAction!.tryActionId).toBe('string');
  });

  it('does NOT include tryActionId on articles that lack it', () => {
    // Find an article without tryActionId in the source
    let found = false;
    for (const cat of HELP_CATALOG) {
      for (const art of cat.articles) {
        if (!art.tryActionId) {
          // Find the corresponding mapped article
          const mappedCat = categories.find((c) => c.id === cat.id)!;
          const mappedArt = mappedCat.articles.find((a) => a.title === art.titleKey)!;
          expect('tryActionId' in mappedArt).toBe(false);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  });

  it('article count per category matches source', () => {
    for (const srcCat of HELP_CATALOG) {
      const mappedCat = categories.find((c) => c.id === srcCat.id)!;
      expect(mappedCat.articles.length).toBe(srcCat.articles.length);
    }
  });

  it('is pure — multiple calls return equal structures', () => {
    const first = catalogToHelpCategories();
    const second = catalogToHelpCategories();
    expect(first).toEqual(second);
  });
});
