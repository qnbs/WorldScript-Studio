// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  classifyRawProjectVersion,
  PROJECT_SCHEMA_V1,
  stampLegacyToV1,
} from '../../../../features/project/projectSchemaVersion';

describe('classifyRawProjectVersion', () => {
  it('classifies an absent schemaVersion as LEGACY_UNVERSIONED, never MALFORMED', () => {
    expect(classifyRawProjectVersion(JSON.stringify({ title: 'Old Project' }))).toBe(
      'LEGACY_UNVERSIONED',
    );
  });

  it('classifies the current version as CURRENT', () => {
    expect(
      classifyRawProjectVersion(JSON.stringify({ schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION })),
    ).toBe('CURRENT');
  });

  it('classifies a higher version as FUTURE', () => {
    expect(
      classifyRawProjectVersion(
        JSON.stringify({ schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION + 1 }),
      ),
    ).toBe('FUTURE');
  });

  it('classifies a FUTURE document even when its shape breaks the current typed schema', () => {
    // QNBS-v3: proves the raw/header parse runs before typed parsing — a breaking shape must not misclassify as MALFORMED.
    const raw = JSON.stringify({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION + 1,
      title: 12345, // wrong type for a real StoryProject.title, but irrelevant at this stage
      brandNewRequiredField: 'the current build does not know this exists',
    });
    expect(classifyRawProjectVersion(raw)).toBe('FUTURE');
  });

  it('classifies an integer-valued decimal literal (e.g. "1.0") the same as its integer form', () => {
    // QNBS-v3: JS's JSON.parse collapses 1 and 1.0 into the same number; the Rust side must match this exactly (serde_json otherwise parses "1.0" as a distinct Float variant).
    expect(
      classifyRawProjectVersion(`{"schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}.0}`),
    ).toBe('CURRENT');
  });

  it('classifies an unregistered lower version as UNSUPPORTED_OLDER', () => {
    // QNBS-v3: no SUPPORTED_OLDER_SOURCE_VERSIONS entry exists yet since PROJECT_SCHEMA_V1 is the only defined version.
    expect(classifyRawProjectVersion(JSON.stringify({ schemaVersion: 0 }))).toBe(
      'UNSUPPORTED_OLDER',
    );
  });

  it.each([
    ['a string', '"1"'],
    ['null', 'null'],
    ['a fractional number', '1.5'],
    ['a negative number', '-1'],
    ['a boolean', 'true'],
  ])('classifies a present but invalid schemaVersion (%s) as MALFORMED', (_label, jsonValue) => {
    expect(classifyRawProjectVersion(`{"schemaVersion": ${jsonValue}}`)).toBe('MALFORMED');
  });

  it('classifies duplicate top-level schemaVersion keys as MALFORMED, regardless of parser last-key-wins behavior', () => {
    // QNBS-v3: JSON.parse silently keeps only the last key; this must be caught before that collapse.
    const raw = `{"schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}, "title": "x", "schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION + 5}}`;
    expect(classifyRawProjectVersion(raw)).toBe('MALFORMED');
  });

  it('detects a duplicate schemaVersion key even when one occurrence uses a JSON unicode escape', () => {
    // QNBS-v3: JSON.parse decodes s to "s", so a byte-literal scanner would miss this duplicate; must compare decoded key names.
    const raw = `{"\\u0073chemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}, "schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION + 5}}`;
    expect(classifyRawProjectVersion(raw)).toBe('MALFORMED');
  });

  it('does not misclassify a nested field also named schemaVersion as a duplicate', () => {
    const raw = JSON.stringify({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      nested: { schemaVersion: 999 },
    });
    expect(classifyRawProjectVersion(raw)).toBe('CURRENT');
  });

  it('does not misclassify a string value that merely contains "schemaVersion" text as a duplicate key', () => {
    const raw = JSON.stringify({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      note: 'the field is called "schemaVersion" in this document',
    });
    expect(classifyRawProjectVersion(raw)).toBe('CURRENT');
  });

  it('classifies unparseable JSON as MALFORMED', () => {
    expect(classifyRawProjectVersion('{not valid json')).toBe('MALFORMED');
  });

  it('classifies a top-level JSON array as MALFORMED', () => {
    expect(classifyRawProjectVersion('[1,2,3]')).toBe('MALFORMED');
  });

  it('classifies a top-level JSON primitive as MALFORMED', () => {
    expect(classifyRawProjectVersion('"just a string"')).toBe('MALFORMED');
    expect(classifyRawProjectVersion('42')).toBe('MALFORMED');
    expect(classifyRawProjectVersion('null')).toBe('MALFORMED');
  });
});

describe('stampLegacyToV1', () => {
  const validLegacy = {
    title: 'Old Project',
    logline: 'A tale.',
    characters: [],
    worlds: [],
    manuscript: [],
  };

  it('stamps schemaVersion onto a legacy payload without altering any other field', () => {
    const result = stampLegacyToV1(validLegacy);

    expect(result?.stamped).toEqual({ ...validLegacy, schemaVersion: PROJECT_SCHEMA_V1 });
    expect([...(result?.sourceKeys ?? [])].sort()).toEqual(Object.keys(validLegacy).sort());
  });

  it('accepts EntityState-shaped characters/worlds, not only arrays', () => {
    const legacy = {
      ...validLegacy,
      characters: { ids: ['c1'], entities: { c1: { id: 'c1', name: 'X' } } },
      worlds: { ids: [], entities: {} },
    };
    expect(stampLegacyToV1(legacy)).not.toBeNull();
  });

  it('does not mutate the input payload', () => {
    const original = { ...validLegacy };
    stampLegacyToV1(validLegacy);
    expect(validLegacy).toEqual(original);
  });

  it.each([
    ['missing title', { logline: 'x', characters: [], worlds: [], manuscript: [] }],
    ['non-string title', { ...validLegacy, title: 123 }],
    ['missing manuscript', { title: 'x', characters: [], worlds: [] }],
    ['non-array manuscript', { ...validLegacy, manuscript: 'not an array' }],
    ['missing characters', { title: 'x', worlds: [], manuscript: [] }],
    ['characters neither array nor EntityState', { ...validLegacy, characters: 'nope' }],
    ['missing worlds', { title: 'x', characters: [], manuscript: [] }],
  ])('returns null for a legacy payload failing minimal verification (%s)', (_label, payload) => {
    expect(stampLegacyToV1(payload)).toBeNull();
  });
});
