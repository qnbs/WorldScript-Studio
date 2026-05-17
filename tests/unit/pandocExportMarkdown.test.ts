import { describe, expect, it } from 'vitest';
import { buildPandocMarkdownFromProject } from '../../services/pandocExportMarkdown';
import type { StoryProject } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// QNBS-v3: loose override type allows undefined for exactOptionalPropertyTypes tests
function makeProject(
  overrides: { [K in keyof StoryProject]?: StoryProject[K] | undefined } = {},
): StoryProject {
  return {
    title: 'Test Novel',
    logline: 'A hero rises.',
    author: undefined,
    characters: [],
    worlds: [],
    outline: [],
    manuscript: [],
    ...overrides,
  } as unknown as StoryProject;
}

// ---------------------------------------------------------------------------
// Title handling
// ---------------------------------------------------------------------------
describe('buildPandocMarkdownFromProject — title', () => {
  it('renders a h1 heading with the project title', () => {
    const md = buildPandocMarkdownFromProject(makeProject({ title: 'My Novel' }));
    expect(md).toContain('# My Novel');
  });

  it('strips embedded newlines from the title', () => {
    const md = buildPandocMarkdownFromProject(makeProject({ title: 'Multi\nLine\nTitle' }));
    expect(md).toContain('# Multi Line Title');
    expect(md).not.toContain('\n# ');
  });
});

// ---------------------------------------------------------------------------
// Author
// ---------------------------------------------------------------------------
describe('author block', () => {
  it('includes author in italics when present', () => {
    const md = buildPandocMarkdownFromProject(makeProject({ author: 'Jane Doe' }));
    expect(md).toContain('*Jane Doe*');
  });

  it('omits author block when author is absent', () => {
    const md = buildPandocMarkdownFromProject(makeProject({ author: undefined }));
    expect(md).not.toContain('*');
  });

  it('omits author block when author is only whitespace', () => {
    const md = buildPandocMarkdownFromProject(makeProject({ author: '   ' }));
    expect(md).not.toContain('*');
  });
});

// ---------------------------------------------------------------------------
// compileProfile sections
// ---------------------------------------------------------------------------
describe('titlePage block', () => {
  it('includes titlePageMarkdown and a horizontal rule', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { titlePageMarkdown: 'Custom title page content' } }),
    );
    expect(md).toContain('Custom title page content');
    expect(md).toContain('---');
  });

  it('omits titlePage when blank', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { titlePageMarkdown: '  ' } }),
    );
    // Only the h1 and nothing about titlePageMarkdown
    expect(md).not.toContain('---');
  });
});

describe('dedication block', () => {
  it('includes dedicationMarkdown and a horizontal rule', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { dedicationMarkdown: 'For my family' } }),
    );
    expect(md).toContain('For my family');
    expect(md).toContain('---');
  });

  it('omits dedication when blank', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { dedicationMarkdown: '' } }),
    );
    expect(md).not.toContain('---');
  });
});

describe('frontMatter blocks', () => {
  it('renders each front matter block as a h2 section', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        compileProfile: {
          frontMatter: [{ id: 'fm-1', title: 'Preface', bodyMarkdown: 'A word before we begin.' }],
        },
      }),
    );
    expect(md).toContain('## Preface');
    expect(md).toContain('A word before we begin.');
  });

  it('skips front matter blocks with empty body', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        compileProfile: {
          frontMatter: [{ id: 'fm-2', title: 'Empty Block', bodyMarkdown: '' }],
        },
      }),
    );
    expect(md).not.toContain('## Empty Block');
  });
});

describe('backMatter blocks', () => {
  it('renders each back matter block as a h2 section', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        compileProfile: {
          backMatter: [{ id: 'bm-1', title: 'Afterword', bodyMarkdown: 'Thanks to everyone.' }],
        },
      }),
    );
    expect(md).toContain('## Afterword');
    expect(md).toContain('Thanks to everyone.');
  });
});

describe('acknowledgementsMarkdown', () => {
  it('includes acknowledgements at the end', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { acknowledgementsMarkdown: 'Thanks to all.' } }),
    );
    expect(md).toContain('Thanks to all.');
  });
});

describe('imprintMarkdown', () => {
  it('includes imprint at the end', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({ compileProfile: { imprintMarkdown: 'Published 2025.' } }),
    );
    expect(md).toContain('Published 2025.');
  });
});

// ---------------------------------------------------------------------------
// Manuscript sections
// ---------------------------------------------------------------------------
describe('manuscript sections', () => {
  it('renders each section as a h2 with its content', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        manuscript: [
          { id: '1', title: 'Chapter One', content: 'It was a dark night.', wordCount: 5 } as never,
          { id: '2', title: 'Chapter Two', content: 'The sun rose.', wordCount: 3 } as never,
        ],
      }),
    );
    expect(md).toContain('## Chapter One');
    expect(md).toContain('It was a dark night.');
    expect(md).toContain('## Chapter Two');
    expect(md).toContain('The sun rose.');
  });

  it('strips newlines from section titles', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        manuscript: [{ id: '1', title: 'Part\nOne', content: 'Content.', wordCount: 1 } as never],
      }),
    );
    expect(md).toContain('## Part One');
  });

  it('handles sections with undefined content', () => {
    const md = buildPandocMarkdownFromProject(
      makeProject({
        manuscript: [{ id: '1', title: 'Empty', content: undefined, wordCount: 0 } as never],
      }),
    );
    expect(md).toContain('## Empty');
  });

  it('returns trimmed output (no trailing whitespace)', () => {
    const md = buildPandocMarkdownFromProject(makeProject());
    expect(md).toBe(md.trimEnd());
  });
});
