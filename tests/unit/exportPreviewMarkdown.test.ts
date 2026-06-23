import { describe, expect, it } from 'vitest';
import { renderExportMarkdownToHtml } from '../../services/exportPreviewMarkdown';

describe('renderExportMarkdownToHtml', () => {
  it('renders headings as real heading tags', () => {
    const html = renderExportMarkdownToHtml('# Title\n## Section\n### Chapter');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Section</h2>');
    expect(html).toContain('<h3>Chapter</h3>');
  });

  it('renders paragraphs and emphasis', () => {
    const html = renderExportMarkdownToHtml('A **bold** and *italic* line.');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<p>');
  });

  it('groups consecutive list items into a single <ul>', () => {
    const html = renderExportMarkdownToHtml('- one\n- two');
    expect(html).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders markdown images', () => {
    const html = renderExportMarkdownToHtml('![cat](https://example.com/c.png)');
    expect(html).toContain('<img');
    expect(html).toContain('alt="cat"');
  });

  it('strips dangerous HTML / script injection', () => {
    const html = renderExportMarkdownToHtml('<script>alert(1)</script> hello & <b>x</b>');
    expect(html).not.toContain('<script');
    // raw angle brackets are escaped, so no injected <b> survives either
    expect(html).not.toContain('<b>');
    expect(html).toContain('hello');
  });

  it('does not emit class or style attributes (sanitized away)', () => {
    const html = renderExportMarkdownToHtml('## Heading');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
  });
});
