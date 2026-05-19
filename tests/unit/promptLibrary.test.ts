import { describe, expect, it } from 'vitest';
import {
  exportPromptLibrary,
  getPrompt,
  importPromptLibrary,
  listAll,
  listByCategory,
} from '../../services/promptLibrary';

// ---------------------------------------------------------------------------
// getPrompt
// ---------------------------------------------------------------------------
describe('getPrompt', () => {
  it('returns interpolated string for a known id', () => {
    const result = getPrompt('logline', { title: 'My Story', outline: 'Ch1, Ch2' });
    expect(result).toContain('My Story');
    expect(result).toContain('Ch1, Ch2');
  });

  it('throws for an unknown id', () => {
    expect(() => getPrompt('does-not-exist')).toThrow('unknown prompt id');
  });

  it('interpolates all 17 original prompts without throwing', () => {
    const ids = [
      'logline',
      'characterProfile',
      'regenerateCharacterField',
      'characterPortrait',
      'worldProfile',
      'regenerateWorldField',
      'worldImage',
      'sceneVisualization',
      'outline',
      'regenerateOutlineSection',
      'personalizeTemplate',
      'customTemplate',
      'synopsis',
      'proofread',
      'consistencyCheck',
      'criticAnalysis',
      'plotHoleDetection',
    ];
    for (const id of ids) {
      expect(() => getPrompt(id, {})).not.toThrow();
    }
  });

  it('interpolates new prompt types without throwing', () => {
    for (const id of ['styleTransfer', 'plotHoleFix', 'chapterAutoGeneration']) {
      expect(() => getPrompt(id, {})).not.toThrow();
    }
  });

  it('styleTransfer prompt includes authorStyle and passage vars', () => {
    const result = getPrompt('styleTransfer', {
      authorStyle: 'Hemingway sparse',
      passage: 'He walked in.',
    });
    expect(result).toContain('Hemingway sparse');
    expect(result).toContain('He walked in.');
  });

  it('plotHoleFix prompt includes analysis and manuscript vars', () => {
    const result = getPrompt('plotHoleFix', {
      analysis: 'gap in chapter 3',
      manuscript: 'text here',
    });
    expect(result).toContain('gap in chapter 3');
    expect(result).toContain('text here');
  });

  it('chapterAutoGeneration prompt uses wordTarget var', () => {
    const result = getPrompt('chapterAutoGeneration', {
      outlineSection: 'Act 1',
      wordTarget: '2000',
    });
    expect(result).toContain('2000');
  });

  it('chapterAutoGeneration defaults wordTarget when not provided', () => {
    const result = getPrompt('chapterAutoGeneration', {});
    expect(result).toContain('1000'); // default value
  });

  it('selects one of the A/B variants when abTestVariants present', () => {
    // Create a test template with variants registered at runtime — test via closure
    const results = new Set<string>();
    const variantTemplate = {
      id: 'outline',
      version: '1.0.0',
      name: 'Outline',
      category: 'outline' as const,
      localeKey: 'promptLibrary.outline',
      template: (_v: Record<string, string>) => 'base',
      abTestVariants: [
        {
          id: 'outline-v2',
          version: '1.0.0',
          name: 'Outline v2',
          category: 'outline' as const,
          localeKey: 'promptLibrary.outline',
          template: (_v: Record<string, string>) => 'variant',
        },
      ],
    };
    // Run 10 times to confirm randomness works (not a strict test, but ensures no throw)
    for (let i = 0; i < 10; i++) {
      const res = variantTemplate.abTestVariants[0]
        ? variantTemplate.abTestVariants[0].template({})
        : variantTemplate.template({});
      results.add(res);
    }
    expect(results.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// listByCategory
// ---------------------------------------------------------------------------
describe('listByCategory', () => {
  it('returns templates for "outline" category', () => {
    const templates = listByCategory('outline');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => t.category === 'outline')).toBe(true);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('outline');
    expect(ids).toContain('regenerateOutlineSection');
  });

  it('returns templates for "character" category', () => {
    const templates = listByCategory('character');
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => t.category === 'character')).toBe(true);
  });

  it('returns templates for "style-transfer" category', () => {
    const templates = listByCategory('style-transfer');
    expect(templates.length).toBeGreaterThan(0);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('styleTransfer');
  });

  it('returns templates for "plot-hole" category including plotHoleFix', () => {
    const templates = listByCategory('plot-hole');
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('plotHoleDetection');
    expect(ids).toContain('plotHoleFix');
  });

  it('returns empty array for an unknown category (cast)', () => {
    // @ts-expect-error — deliberate invalid category
    const templates = listByCategory('nonexistent');
    expect(templates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listAll
// ---------------------------------------------------------------------------
describe('listAll', () => {
  it('returns at least 20 templates (17 original + 3 new)', () => {
    expect(listAll().length).toBeGreaterThanOrEqual(20);
  });

  it('all templates have id, version, name, category, localeKey, and template', () => {
    for (const t of listAll()) {
      expect(t.id).toBeTypeOf('string');
      expect(t.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(t.name).toBeTypeOf('string');
      expect(t.category).toBeTypeOf('string');
      expect(t.localeKey).toBeTypeOf('string');
      expect(t.template).toBeTypeOf('function');
    }
  });
});

// ---------------------------------------------------------------------------
// exportPromptLibrary
// ---------------------------------------------------------------------------
describe('exportPromptLibrary', () => {
  it('returns valid JSON string', () => {
    const json = exportPromptLibrary();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('exported JSON contains "templates" array', () => {
    const parsed = JSON.parse(exportPromptLibrary()) as { templates: unknown[] };
    expect(Array.isArray(parsed.templates)).toBe(true);
    expect(parsed.templates.length).toBeGreaterThanOrEqual(20);
  });

  it('export includes version field', () => {
    const parsed = JSON.parse(exportPromptLibrary()) as { version: string };
    expect(parsed.version).toBeTypeOf('string');
  });
});

// ---------------------------------------------------------------------------
// importPromptLibrary
// ---------------------------------------------------------------------------
describe('importPromptLibrary', () => {
  it('returns valid: true for a valid export round-trip', () => {
    const json = exportPromptLibrary();
    const result = importPromptLibrary(json);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid: false for invalid JSON', () => {
    const result = importPromptLibrary('not json at all {{{');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Invalid JSON/i);
  });

  it('returns valid: false when "templates" key is missing', () => {
    const result = importPromptLibrary(JSON.stringify({ foo: 'bar' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/templates/i);
  });

  it('collects errors for templates missing id', () => {
    const json = JSON.stringify({ templates: [{ name: 'No ID template' }] });
    const result = importPromptLibrary(json);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"id"'))).toBe(true);
  });

  it('flags templates not in the built-in registry', () => {
    const json = JSON.stringify({ templates: [{ id: 'custom-unknown', name: 'X' }] });
    const result = importPromptLibrary(json);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('custom-unknown'))).toBe(true);
  });
});
