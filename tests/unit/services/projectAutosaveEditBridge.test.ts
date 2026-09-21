import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../../../features/project/projectState';
import { buildAutosaveOwnedProjectEdit } from '../../../services/projectAutosaveEditBridge';
import {
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
} from '../../../services/projectDocumentWriteback';

const UNSAFE_INTEGER_LITERAL = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2

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

/** Runs the built edit through the real canonical writeback fence -- the downstream consumer this bridge exists to feed. */
function commitBridgeEdit(data: ProjectData, currentRaw: string) {
  const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);
  return commitOwnedProjectEdit({
    expectedGeneration: computeProjectSourceGeneration(currentRaw),
    currentRaw,
    edit,
  });
}

// QNBS-v3: characters/worlds go through the identical buildCollectionEdit path, so one shared assertion helper covers both without duplicating the assertion structure (CodeScene flagged the prior two near-identical tests as duplication, and the metric authority counts plain it/test call sites rather than it.each rows).
function expectOrderedUpsert(
  collection: 'characters' | 'worlds',
  ids: string[],
  entities: Record<string, { id: string; name: string }>,
) {
  const data = baseProjectData({ [collection]: { ids, entities } });
  const currentRaw = currentRawFor(data as unknown as Record<string, unknown>);

  const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);
  const result = edit.collections?.[collection];

  expect(result?.order).toEqual(ids);
  expect(result?.upsert).toEqual(ids.map((id) => entities[id]));
  expect(result?.remove).toBeUndefined();
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

  it('never emits an owned schemaVersion field, even when the runtime snapshot carries one as an extra', () => {
    // QNBS-v3: appBootstrap spreads the persisted payload into the runtime projection, so a CURRENT record's schemaVersion can ride along as a runtime-extra prop; schemaVersion is admission-owned and commitOwnedProjectEdit rejects any owned edit of it.
    const data = baseProjectData({ schemaVersion: 1 });
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'x',
      characters: { ids: [], entities: {} },
      worlds: { ids: [], entities: {} },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.fields).not.toHaveProperty('schemaVersion');
    expect(commitBridgeEdit(data, currentRaw).status).toBe('COMMITTED');
  });

  it('upserts every current characters entity, in current order', () => {
    expectOrderedUpsert('characters', ['c2', 'c1'], {
      c1: { id: 'c1', name: 'Alice' },
      c2: { id: 'c2', name: 'Bob' },
    });
  });

  it('upserts every current worlds entity, in current order', () => {
    expectOrderedUpsert('worlds', ['w2', 'w1'], {
      w1: { id: 'w1', name: 'Aldoria' },
      w2: { id: 'w2', name: 'Brythos' },
    });
  });

  it('preserves an opaque field the raw carrier holds but the typed entity does not own', () => {
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

    expect(edit.collections?.characters?.upsert).toEqual([{ id: 'c1', name: 'Alice Renamed' }]);
  });

  it('preserves an opaque top-level number when the runtime projection carries a rounded value', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: [],
      worlds: [],
      opaqueTop: '__UNSAFE_INT__',
    }).replace('"__UNSAFE_INT__"', UNSAFE_INTEGER_LITERAL);
    const data = baseProjectData({ opaqueTop: Number(UNSAFE_INTEGER_LITERAL) });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);
    const result = commitBridgeEdit(data, currentRaw);

    expect(edit.fields).not.toHaveProperty('opaqueTop');
    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    expect(result.raw).toContain(`"opaqueTop":${UNSAFE_INTEGER_LITERAL}`);
  });

  it('removes an owned optional field when the full snapshot no longer carries it', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: [],
      worlds: [],
      aiPreset: { model: 'legacy-model' },
    });
    const data = baseProjectData();

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);
    const result = commitBridgeEdit(data, currentRaw);

    expect(edit.removeFields).toEqual(['aiPreset']);
    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    expect(result.raw).not.toContain('"aiPreset"');
  });

  it('lets an explicitly-undefined typed entity prop defer to the opaque raw value (end-to-end through writeback)', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: {
        ids: ['c1'],
        entities: { c1: { id: 'c1', name: 'Alice', pluginNote: 'from an older build' } },
      },
      worlds: { ids: [], entities: {} },
    });
    const data = baseProjectData({
      characters: {
        ids: ['c1'],
        entities: { c1: { id: 'c1', name: 'Alice', pluginNote: undefined } },
      },
    });

    const result = commitBridgeEdit(data, currentRaw);

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const committed = JSON.parse(result.raw) as {
      characters: { entities: Record<string, { pluginNote?: string }> };
    };
    expect(committed.characters.entities['c1']?.pluginNote).toBe('from an older build');
  });

  it('preserves an opaque unsafe-integer literal byte-exactly through writeback (entity-state raw shape, incl. nested opaque values)', () => {
    // QNBS-v3: raw literal spliced in below to preserve the exact unsafe-integer token untouched by JSON.stringify.
    const currentRaw = JSON.stringify({
      schemaVersion: 1,
      title: 'My Story',
      characters: {
        ids: ['c1'],
        entities: {
          c1: {
            id: 'c1',
            name: 'Alice',
            externalId: '__UNSAFE_INT__',
            plugin: { ref: '__UNSAFE_INT__', note: 'opaque nested object' },
          },
        },
      },
      worlds: { ids: [], entities: {} },
    }).replaceAll('"__UNSAFE_INT__"', UNSAFE_INTEGER_LITERAL);
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice Renamed' } } },
    });

    const result = commitBridgeEdit(data, currentRaw);

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    expect(result.raw).toContain(`"externalId":${UNSAFE_INTEGER_LITERAL}`);
    expect(result.raw).toContain(`"ref":${UNSAFE_INTEGER_LITERAL}`);
    expect(result.raw).not.toContain('9007199254740992');
  });

  it('preserves an opaque unsafe-integer literal byte-exactly through writeback (plain-array raw shape)', () => {
    const currentRaw = JSON.stringify({
      schemaVersion: 1,
      title: 'My Story',
      characters: [{ id: 'c1', name: 'Alice', externalId: '__UNSAFE_INT__' }],
      worlds: [],
    }).replace('"__UNSAFE_INT__"', UNSAFE_INTEGER_LITERAL);
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice Renamed' } } },
    });

    const result = commitBridgeEdit(data, currentRaw);

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    expect(result.raw).toContain(UNSAFE_INTEGER_LITERAL);
    expect(result.raw).not.toContain('9007199254740992');
  });

  it('preserves opaque fractional and exponent tokens byte-exactly through writeback', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: [
        {
          id: 'c1',
          name: 'Alice',
          opaqueFraction: '__FRACTION__',
          opaqueExponent: '__EXPONENT__',
        },
      ],
      worlds: [],
    })
      .replace('"__FRACTION__"', '0.1234567890123456789')
      .replace('"__EXPONENT__"', '1e+3');
    const data = baseProjectData({
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'Alice Renamed' } } },
    });

    const result = commitBridgeEdit(data, currentRaw);

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    expect(result.raw).toContain('"opaqueFraction":0.1234567890123456789');
    expect(result.raw).toContain('"opaqueExponent":1e+3');
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
    expect(edit.collections?.characters?.upsert).toEqual([{ id: 'c1', name: 'Alice' }]);
  });

  it('treats prototype-named ids as ordinary entities in a plain-array raw collection', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: [
        { id: '__proto__', name: 'Proto', pluginNote: 'opaque-proto' },
        { id: 'constructor', name: 'Ctor', pluginNote: 'opaque-ctor' },
      ],
      worlds: [],
    });
    const data = baseProjectData({
      characters: {
        ids: ['__proto__', 'constructor'],
        entities: {
          // Computed key: a plain '__proto__' literal key (quoted or not) would set the fixture's prototype instead of an own property.
          ['__proto__']: { id: '__proto__', name: 'Renamed Proto' },
          constructor: { id: 'constructor', name: 'Renamed Ctor' },
        },
      },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.upsert).toEqual([
      { id: '__proto__', name: 'Renamed Proto' },
      { id: 'constructor', name: 'Renamed Ctor' },
    ]);
    expect(edit.collections?.characters?.remove).toBeUndefined();
  });

  it('never reads a "__proto__" entity body as a phantom merge base for unrelated ids', () => {
    const currentRaw = currentRawFor({
      schemaVersion: 1,
      title: 'My Story',
      characters: [{ id: '__proto__', name: 'Proto', c9: { note: 'phantom-object' } }],
      worlds: [],
    });
    const data = baseProjectData({
      characters: { ids: ['c9'], entities: { c9: { id: 'c9', name: 'New' } } },
    });

    const edit = buildAutosaveOwnedProjectEdit(data, currentRaw);

    expect(edit.collections?.characters?.upsert).toEqual([{ id: 'c9', name: 'New' }]);
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
