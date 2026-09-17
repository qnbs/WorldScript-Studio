import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../../features/project/projectState';
import { buildAutosaveOwnedProjectEdit } from '../../../services/projectAutosaveEditBridge';

// QNBS-v3: overrides stay loosely typed (not Partial<ProjectData>) -- fixtures only need id-bearing entity stubs, not every real Character/World field.
function baseProjectData(overrides: Record<string, unknown> = {}): ProjectData {
  return {
    id: 'default',
    title: 'My Story',
    logline: 'A logline.',
    characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    worlds: { ids: ['w1'], entities: { w1: { id: 'w1', name: 'Aldoria' } } },
    outline: [],
    manuscript: [],
    ...overrides,
  } as unknown as ProjectData;
}

function currentRawFor(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

describe('buildAutosaveOwnedProjectEdit', () => {
  it('puts every non-collection top-level field into `fields`', () => {
    const data = baseProjectData({ author: 'Author', outline: [{ id: 'o1' } as never] });
    const currentRaw = currentRawFor(data as unknown as Record<string, unknown>);

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.fields).toMatchObject({
      title: 'My Story',
      logline: 'A logline.',
      author: 'Author',
    });
    expect(edit.fields).not.toHaveProperty('characters');
    expect(edit.fields).not.toHaveProperty('worlds');
  });

  it('upserts every current character/world entity, in current order', () => {
    const data = baseProjectData({
      characters: {
        ids: ['c2', 'c1'],
        entities: {
          c1: { id: 'c1', name: 'Alice' },
          c2: { id: 'c2', name: 'Bob' },
        },
      },
    });
    const currentRaw = currentRawFor(data as unknown as Record<string, unknown>);

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.order).toEqual(['c2', 'c1']);
    expect(edit.collections?.characters?.upsert).toEqual([
      { id: 'c2', name: 'Bob' },
      { id: 'c1', name: 'Alice' },
    ]);
    expect(edit.collections?.characters?.remove).toBeUndefined();
  });

  it('computes remove as the set difference between the current raw carrier and the new state', () => {
    const currentRaw = currentRawFor({
      characters: { ids: ['c1', 'c2'], entities: { c1: {}, c2: {} } },
      worlds: { ids: [], entities: {} },
    });
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.remove).toEqual(['c2']);
  });

  it('omits `remove` when nothing was deleted (never emits an empty array)', () => {
    const currentRaw = currentRawFor({
      characters: { ids: ['c1'], entities: { c1: {} } },
      worlds: { ids: [], entities: {} },
    });
    const data = baseProjectData();

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.remove).toBeUndefined();
  });

  it('treats a currently-empty raw carrier (e.g. first-ever save) as having nothing to remove', () => {
    const currentRaw = currentRawFor({ title: 'placeholder' });
    const data = baseProjectData();

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.remove).toBeUndefined();
    expect(edit.collections?.characters?.upsert).toHaveLength(1);
  });

  it('does not mutate or re-serialize currentRaw -- it is read only to derive the removal set', () => {
    const currentRaw = currentRawFor({
      characters: { ids: ['c1', 'stale-id'], entities: {} },
      worlds: { ids: [], entities: {} },
    });
    const frozenRaw = Object.freeze(currentRaw);
    const data = baseProjectData();

    expect(() => buildAutosaveOwnedProjectEdit(data, frozenRaw)).not.toThrow();
  });
});
