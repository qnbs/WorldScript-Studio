import { describe, expect, it } from 'vitest';
import type { CompilePresetDefinition } from '../../services/compilePresets';
import { COMPILE_PRESETS } from '../../services/compilePresets';

describe('COMPILE_PRESETS', () => {
  it('exports an array of at least 4 presets', () => {
    expect(COMPILE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it('all presets have required fields', () => {
    for (const preset of COMPILE_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.nameKey).toBeTruthy();
      expect(preset.format).toBeTruthy();
      expect(typeof preset.contentToExport.title).toBe('boolean');
      expect(typeof preset.contentToExport.manuscript).toBe('boolean');
    }
  });

  it('all preset IDs are unique', () => {
    const ids = COMPILE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('novel-manuscript-pdf has PDF format and pdfOptions', () => {
    const pdf = COMPILE_PRESETS.find(
      (p) => p.id === 'novel-manuscript-pdf',
    ) as CompilePresetDefinition;
    expect(pdf).toBeDefined();
    expect(pdf.format).toBe('pdf');
    expect(pdf.pdfOptions).toBeDefined();
    expect(pdf.pdfOptions?.font).toBe('Times');
    expect(pdf.pdfOptions?.lineSpacing).toBe('double');
    expect(pdf.pdfOptions?.includeTitlePage).toBe(true);
  });

  it('ebook-epub has epub format', () => {
    const epub = COMPILE_PRESETS.find((p) => p.id === 'ebook-epub');
    expect(epub?.format).toBe('epub');
  });

  it('full-archive-md exports all content types', () => {
    const md = COMPILE_PRESETS.find((p) => p.id === 'full-archive-md');
    expect(md?.contentToExport.characters).toBe(true);
    expect(md?.contentToExport.worlds).toBe(true);
    expect(md?.contentToExport.manuscript).toBe(true);
    expect(md?.contentToExport.title).toBe(true);
  });

  it('norm-manuscript-txt only includes manuscript', () => {
    const norm = COMPILE_PRESETS.find((p) => p.id === 'norm-manuscript-txt');
    expect(norm?.format).toBe('norm-txt');
    expect(norm?.contentToExport.manuscript).toBe(true);
    expect(norm?.contentToExport.characters).toBe(false);
    expect(norm?.contentToExport.worlds).toBe(false);
    expect(norm?.contentToExport.title).toBe(false);
  });
});
