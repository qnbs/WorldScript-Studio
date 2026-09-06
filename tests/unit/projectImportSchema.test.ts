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

  // QNBS-v3: the bootstrap boundary must preserve string IDs already accepted by project imports.
  it('accepts empty and whitespace entity IDs in imported projects', () => {
    const raw = JSON.stringify({
      title: 'T',
      logline: 'L',
      characters: [{ id: '', name: 'Unnamed' }],
      worlds: [{ id: ' ', name: 'Whitespace world' }],
      manuscript: [],
    });
    const parsed = parseImportedProjectJson(raw);

    expect(parsed.characters).toMatchObject([{ id: '', name: 'Unnamed' }]);
    expect(parsed.worlds).toMatchObject([{ id: ' ', name: 'Whitespace world' }]);
  });

  // QNBS-v3: import parsing must retain prototype-named entity keys before hydration correspondence checks.
  it('preserves prototype-named IDs in normalized entity records', () => {
    const raw = JSON.stringify({
      title: 'T',
      logline: 'L',
      characters: {
        ids: ['__proto__'],
        entities: Object.fromEntries([['__proto__', { id: '__proto__', name: 'Prototype' }]]),
      },
      worlds: {
        ids: ['constructor'],
        entities: Object.fromEntries([['constructor', { id: 'constructor', name: 'Constructor' }]]),
      },
      manuscript: [],
    });
    const parsed = parseImportedProjectJson(raw);
    const characters = parsed.characters;
    const worlds = parsed.worlds;

    expect(Array.isArray(characters)).toBe(false);
    expect(Array.isArray(worlds)).toBe(false);
    if (Array.isArray(characters) || Array.isArray(worlds) || !characters || !worlds) return;
    expect(Object.hasOwn(characters.entities, '__proto__')).toBe(true);
    expect(Reflect.get(characters.entities, '__proto__')?.id).toBe('__proto__');
    expect(Object.hasOwn(worlds.entities, 'constructor')).toBe(true);
    expect(worlds.entities.constructor?.id).toBe('constructor');
  });

  it('rejects invalid JSON shape', () => {
    expect(() => parseImportedProjectJson(JSON.stringify([]))).toThrow(/Invalid project file/);
  });

  // QNBS-v3: file import must refuse version states that cannot receive editable authority.
  it('refuses future and migration-gap documents before projection', () => {
    expect(() =>
      parseImportedProjectJson(
        JSON.stringify({ schemaVersion: 99, futureOnlyField: { preserved: true } }),
      ),
    ).toThrow(/FUTURE/);
    expect(() =>
      parseImportedProjectJson(JSON.stringify({ schemaVersion: 0, ...validProjectForImport() })),
    ).toThrow(/UNSUPPORTED_OLDER/);
  });
});

function validProjectForImport() {
  return { title: 'T', logline: 'L', manuscript: [] };
}
