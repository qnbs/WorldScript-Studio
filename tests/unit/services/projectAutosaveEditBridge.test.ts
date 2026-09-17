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
  it('puts every non-collection top-level field, and only those, into `fields`', () => {
    const data = baseProjectData();
    const currentRaw = currentRawFor(data as unknown as Record<string, unknown>);

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.fields).toEqual({
      id: 'default',
      title: 'My Story',
      logline: 'A logline.',
      outline: [],
      manuscript: [],
    });
  });

  it('drops an explicitly-undefined-valued field instead of forwarding invalid JSON', () => {
    const data = baseProjectData({ author: undefined });
    const currentRaw = currentRawFor({ title: 'x' });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.fields).not.toHaveProperty('author');
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
      worlds: {
        ids: ['w2', 'w1'],
        entities: {
          w1: { id: 'w1', name: 'Aldoria' },
          w2: { id: 'w2', name: 'Brythos' },
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
    expect(edit.collections?.worlds?.order).toEqual(['w2', 'w1']);
    expect(edit.collections?.worlds?.upsert).toEqual([
      { id: 'w2', name: 'Brythos' },
      { id: 'w1', name: 'Aldoria' },
    ]);
    expect(edit.collections?.worlds?.remove).toBeUndefined();
  });

  it('preserves an opaque field the raw carrier holds but the typed entity does not model', () => {
    const currentRaw = currentRawFor({
      characters: {
        ids: ['c1'],
        entities: { c1: { id: 'c1', name: 'Alice', pluginNote: 'from an older build' } },
      },
      worlds: { ids: [], entities: {} },
    });
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice Renamed' } } },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.upsert).toEqual([
      { id: 'c1', name: 'Alice Renamed', pluginNote: 'from an older build' },
    ]);
  });

  it('reads prior ids/entities from a plain-array-shaped raw collection (the Core boundary/filesystem on-disk shape)', () => {
    const currentRaw = currentRawFor({
      characters: [
        { id: 'c1', name: 'Alice', pluginNote: 'kept' },
        { id: 'c2', name: 'Bob' },
      ],
      worlds: [],
    });
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice' } } },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.remove).toEqual(['c2']);
    expect(edit.collections?.characters?.upsert).toEqual([
      { id: 'c1', name: 'Alice', pluginNote: 'kept' },
    ]);
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

  it('is idempotent -- calling it twice with the same inputs never mutates currentRaw between calls', () => {
    const currentRaw = currentRawFor({
      characters: { ids: ['c1', 'stale-id'], entities: { c1: {}, 'stale-id': {} } },
      worlds: { ids: [], entities: {} },
    });
    const data = baseProjectData();

    const first = buildAutosaveOwnedProjectEdit(data, currentRaw);
    const second = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(second).toEqual(first);
    expect(second.collections?.characters?.remove).toEqual(['stale-id']);
  });
});
