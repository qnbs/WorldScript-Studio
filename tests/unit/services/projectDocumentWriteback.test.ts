import { describe, expect, it } from 'vitest';
import {
  commitOwnedProjectEdit,
  computeProjectSourceGeneration,
  type EntityCollectionEdit,
  type OwnedProjectEdit,
} from '../../../services/projectDocumentWriteback';

const UNSAFE_INTEGER_LITERAL = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2

function baseDocument(): string {
  return JSON.stringify({
    schemaVersion: 1,
    title: 'My Story',
    logline: 'A logline.',
    author: 'Author Name',
    manuscript: 'Once upon a time...',
    outline: 'An opaque, Core-unmodeled outline value.',
    characters: {
      ids: ['c1', 'c2'],
      entities: {
        c1: { id: 'c1', name: 'Alice', notes: 'opaque nested field on c1' },
        // QNBS-v3: raw literal spliced in below to preserve the exact unsafe-integer token untouched by JSON.stringify.
        c2: { id: 'c2', name: 'Bob', externalId: '__UNSAFE_INT__', secretNote: 'do-not-touch' },
      },
    },
    worlds: { ids: [], entities: {} },
  }).replace('"__UNSAFE_INT__"', UNSAFE_INTEGER_LITERAL);
}

function generationOf(raw: string): string {
  return computeProjectSourceGeneration(raw);
}

/** Commits `edit` against a fresh, uncontested document -- the shared shape of most cases below. */
function commitEdit(edit: OwnedProjectEdit, raw: string = baseDocument()) {
  return commitOwnedProjectEdit({
    expectedGeneration: generationOf(raw),
    currentRaw: raw,
    edit,
  });
}

describe('projectDocumentWriteback (#553)', () => {
  it('commits when there is no concurrent change', () => {
    const result = commitEdit({ fields: { title: 'Renamed Story' } });

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as { title: string };
    expect(parsed.title).toBe('Renamed Story');
  });

  it('refuses the commit when the source changed before commit (fail closed, no overwrite)', () => {
    const raw = baseDocument();
    const generation = generationOf(raw);
    const concurrentlyChangedRaw = JSON.parse(raw) as Record<string, unknown>;
    concurrentlyChangedRaw['title'] = 'Someone else already renamed this';
    const currentRaw = JSON.stringify(concurrentlyChangedRaw);

    const result = commitOwnedProjectEdit({
      expectedGeneration: generation,
      currentRaw,
      edit: { fields: { logline: 'A different logline.' } },
    });

    expect(result.status).toBe('CONFLICT');
  });

  it('fails closed when the caller supplies the wrong expected generation, even if currentRaw looks unrelated', () => {
    const raw = baseDocument();

    const result = commitOwnedProjectEdit({
      expectedGeneration: 'deadbeefdeadbeef',
      currentRaw: raw,
      edit: { fields: { title: 'Should never land' } },
    });

    expect(result.status).toBe('CONFLICT');
    if (result.status !== 'CONFLICT') return;
    expect(result.expectedGeneration).toBe('deadbeefdeadbeef');
    expect(result.actualGeneration).toBe(generationOf(raw));
  });

  it('preserves an untouched opaque top-level field exactly', () => {
    const result = commitEdit({ fields: { title: 'Renamed Story' } });

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as { outline: string };
    expect(parsed.outline).toBe('An opaque, Core-unmodeled outline value.');
  });

  it('preserves an untouched opaque nested field on an entity the edit does not touch', () => {
    const result = commitEdit({
      collections: { characters: { upsert: [{ id: 'c1', name: 'Alicia', notes: 'updated' }] } },
    });

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as {
      characters: { entities: Record<string, { notes?: string; secretNote?: string }> };
    };
    expect(parsed.characters.entities['c2']?.notes).toBeUndefined();
    expect(parsed.characters.entities['c2']?.secretNote).toBe('do-not-touch');
    expect((parsed.characters.entities['c2'] as unknown as { name: string }).name).toBe('Bob');
  });

  it('preserves a large/unsafe-integer raw value on an untouched entity exactly through a collection edit', () => {
    const raw = baseDocument();
    expect(raw).toContain(UNSAFE_INTEGER_LITERAL);

    // QNBS-v3: the edit must touch the collection (not just a top-level field) so the protect/revive path this test targets actually runs.
    const result = commitEdit(
      { collections: { characters: { upsert: [{ id: 'c1', name: 'Alicia' }] } } },
      raw,
    );

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    // QNBS-v3: a JSON.parse-based assertion would itself round the literal -- assert on the raw text instead.
    expect(result.raw).toContain(UNSAFE_INTEGER_LITERAL);
    expect(result.raw).not.toContain('9007199254740992'); // the value JS's float rounding would produce
  });

  it('applies an owned scalar field edit', () => {
    const result = commitEdit({ fields: { title: 'New Title', logline: 'New logline.' } });

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as { title: string; logline: string };
    expect(parsed.title).toBe('New Title');
    expect(parsed.logline).toBe('New logline.');
  });

  /** Commits a characters-collection edit and returns its parsed characters, asserting COMMITTED. */
  function commitCharactersEdit(edit: EntityCollectionEdit) {
    const result = commitEdit({ collections: { characters: edit } });
    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') throw new Error('expected COMMITTED');
    return (
      JSON.parse(result.raw) as { characters: { ids: string[]; entities: Record<string, unknown> } }
    ).characters;
  }

  it('applies an owned entity edit (upsert of an existing entity)', () => {
    const characters = commitCharactersEdit({ upsert: [{ id: 'c1', name: 'Alicia' }] });

    expect((characters.entities['c1'] as { name: string })?.name).toBe('Alicia');
    expect(characters.ids).toEqual(['c1', 'c2']);
  });

  it('applies an intentional entity create without treating it as an invented-field violation', () => {
    const characters = commitCharactersEdit({ upsert: [{ id: 'c3', name: 'Carol' }] });

    expect(characters.ids).toEqual(['c1', 'c2', 'c3']);
    expect(characters.entities['c3']).toEqual({ id: 'c3', name: 'Carol' });
  });

  it('applies an intentional entity delete without treating it as opaque-data loss', () => {
    const characters = commitCharactersEdit({ remove: ['c2'] });

    expect(characters.ids).toEqual(['c1']);
    expect(characters.entities['c2']).toBeUndefined();
  });

  it('reorders entities by an explicit declared order while preserving stable ids and content', () => {
    const characters = commitCharactersEdit({ order: ['c2', 'c1'] });

    expect(characters.ids).toEqual(['c2', 'c1']);
    expect((characters.entities['c1'] as { name: string })?.name).toBe('Alice');
    expect((characters.entities['c2'] as { name: string })?.name).toBe('Bob');
  });

  it.each([
    ['MALFORMED', '{not valid json'],
    [
      'FUTURE',
      JSON.stringify({
        schemaVersion: 999,
        title: 't',
        logline: 'l',
        author: 'a',
        manuscript: 'm',
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
      }),
    ],
    [
      'LEGACY_UNVERSIONED',
      JSON.stringify({
        title: 't',
        logline: 'l',
        author: 'a',
        manuscript: 'm',
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
      }),
    ],
  ])('never grants write authority for a %s document', (_label, raw) => {
    const result = commitEdit({ fields: { title: 'Should never land' } }, raw);

    expect(result.status).toBe('NOT_ADMITTED_FOR_WRITE');
  });

  function expectVerificationFailedContaining(
    result: ReturnType<typeof commitEdit>,
    reasonSubstring: string,
  ): void {
    expect(result.status).toBe('VERIFICATION_FAILED');
    if (result.status !== 'VERIFICATION_FAILED') return;
    expect(result.reason).toContain(reasonSubstring);
  }

  function minimalDocument(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      schemaVersion: 1,
      title: 't',
      logline: 'l',
      author: 'a',
      manuscript: 'm',
      worlds: { ids: [], entities: {} },
      ...overrides,
    });
  }

  const upsertAliceEdit: OwnedProjectEdit = {
    collections: { characters: { upsert: [{ id: 'c1', name: 'Alice' }] } },
  };

  it('reports VERIFICATION_FAILED when the edit targets a collection absent from the document', () => {
    // QNBS-v3: "characters" deliberately omitted to exercise readEntityCollection's "not present" path.
    const result = commitEdit(upsertAliceEdit, minimalDocument());

    expectVerificationFailedContaining(result, 'not present in the raw payload');
  });

  it('reports VERIFICATION_FAILED when a targeted collection is neither an array nor an EntityState', () => {
    const raw = minimalDocument({ characters: 'not a collection at all' });

    const result = commitEdit(upsertAliceEdit, raw);

    expectVerificationFailedContaining(result, 'neither an array nor an EntityState');
  });

  it('reports VERIFICATION_FAILED when an explicit order does not match the resulting entity set', () => {
    const result = commitEdit({ collections: { characters: { order: ['c1', 'does-not-exist'] } } });

    expectVerificationFailedContaining(result, 'does not match the resulting entity set');
  });

  it('rejects an explicit order containing a duplicate id instead of crashing', () => {
    // QNBS-v3 regression: a Set-only comparison of `order` against the expected id set cannot see a
    // duplicate entry inside `order` itself when the distinct-id set still matches.
    const result = commitEdit({
      collections: { characters: { remove: ['c2'], order: ['c1', 'c1'] } },
    });

    expectVerificationFailedContaining(result, 'does not match the resulting entity set');
  });

  it('refuses to admit a document with an ambiguous duplicate top-level key', () => {
    // QNBS-v3 regression: JSON.parse's last-occurrence-wins semantics disagree with a first-match
    // top-level-member lookup, so a duplicate key must be refused rather than silently resolved.
    const raw = baseDocument().replace(
      '"title":"My Story"',
      '"title":"My Story","title":"Duplicated Title"',
    );

    const result = commitEdit({ fields: { logline: 'New logline.' } }, raw);

    expect(result.status).toBe('MALFORMED_SOURCE');
  });

  it('preserves an opaque envelope member on an EntityState-shaped collection beyond ids/entities', () => {
    const document = JSON.parse(baseDocument()) as { characters: Record<string, unknown> };
    document.characters['meta'] = { customEnvelopeField: 'preserve-me' };
    const raw = JSON.stringify(document);

    const result = commitEdit(
      { collections: { characters: { upsert: [{ id: 'c1', name: 'Alicia' }] } } },
      raw,
    );

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as {
      characters: { meta?: { customEnvelopeField: string } };
    };
    expect(parsed.characters.meta?.customEnvelopeField).toBe('preserve-me');
  });

  it('does not misinterpret an opaque string that happens to look like a raw-number marker', () => {
    // QNBS-v3 regression: a per-call random nonce (not a fixed marker string) must be immune to any
    // legitimate opaque value already present in the document, no matter what text it contains.
    const document = JSON.parse(baseDocument()) as {
      characters: { entities: Record<string, { notes?: string }> };
    };
    document.characters.entities['c1']!.notes = 'WS_RAW_NUMBER123';
    const raw = JSON.stringify(document);

    const result = commitEdit(
      { collections: { characters: { upsert: [{ id: 'c2', name: 'Bobby' }] } } },
      raw,
    );

    expect(result.status).toBe('COMMITTED');
    if (result.status !== 'COMMITTED') return;
    const parsed = JSON.parse(result.raw) as {
      characters: { entities: Record<string, { notes?: string }> };
    };
    expect(parsed.characters.entities['c1']?.notes).toBe('WS_RAW_NUMBER123');
  });

  it('refuses an owned-field edit that attempts to set schemaVersion', () => {
    // QNBS-v3 regression: admission only classifies the document BEFORE the edit; schemaVersion
    // must never be settable as an ordinary owned field, or a writer could bump the document past
    // admission's protection after the fact.
    const result = commitEdit({ fields: { schemaVersion: 999, title: 'Should never land' } });

    expectVerificationFailedContaining(result, 'schemaVersion cannot be set');
  });
});
