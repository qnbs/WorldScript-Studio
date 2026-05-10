import { describe, expect, it } from 'vitest';
import { parseImportedProjectJson } from '../../services/projectImportSchema';

describe('projectImportSchema', () => {
  it('parses minimal valid project JSON', () => {
    const raw = JSON.stringify({ title: 'T', logline: 'L', manuscript: [] });
    const parsed = parseImportedProjectJson(raw);
    expect(parsed.title).toBe('T');
    expect(parsed.logline).toBe('L');
    expect(parsed.manuscript).toEqual([]);
  });

  it('parses binder nodes when present', () => {
    const raw = JSON.stringify({
      title: 'T',
      logline: 'L',
      manuscript: [],
      binderNodes: [
        {
          id: 'n1',
          parentId: null,
          type: 'folder',
          title: 'Research',
          sortIndex: 0,
        },
      ],
    });
    const parsed = parseImportedProjectJson(raw);
    expect(parsed.binderNodes?.length).toBe(1);
    expect(parsed.binderNodes?.[0]?.title).toBe('Research');
  });

  it('rejects invalid JSON shape', () => {
    expect(() => parseImportedProjectJson(JSON.stringify([]))).toThrow(/Invalid project file/);
  });
});
