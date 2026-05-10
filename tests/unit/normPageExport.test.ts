import { describe, expect, it } from 'vitest';
import {
  buildNormManuscriptExport,
  NORM_PAGE_COLS,
  paginateNormLines,
  wrapParagraphToLines,
} from '../../services/normPageExport';

describe('normPageExport', () => {
  it('wraps words to column width', () => {
    const lines = wrapParagraphToLines('hello world '.repeat(20).trim(), NORM_PAGE_COLS);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(NORM_PAGE_COLS);
    }
  });

  it('pads pages to fixed row count', () => {
    const pages = paginateNormLines(['aa', 'bb'], 30, NORM_PAGE_COLS);
    expect(pages.split('\f').length).toBeGreaterThanOrEqual(1);
  });

  it('builds export with form feeds between pages', () => {
    const text = buildNormManuscriptExport([{ title: 'One', content: 'word '.repeat(400) }]);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toContain('\f');
  });
});
