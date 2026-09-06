import { describe, expect, it } from 'vitest';
import {
  admitCanonicalProjectDocument,
  parseCanonicalProjectDocument,
} from '../../services/projectDocument';
import { importedProjectJsonSchema } from '../../services/projectImportSchema';

const validProject = {
  title: 'Canonical project',
  logline: 'A project used to prove raw-carrier behavior.',
  manuscript: [],
};

describe('parseCanonicalProjectDocument', () => {
  // QNBS-v3: prove the raw carrier remains authoritative when the typed projection is narrower.
  it('retains unknown fields in the raw carrier while projecting owned V1 fields', () => {
    const raw =
      '{"schemaVersion":1,"title":"Canonical project","logline":"A project used to prove raw-carrier behavior.","manuscript":[],"opaqueTopLevel":{"exact":9007199254740993},"characters":[{"id":"character-1","name":"A character","opaqueNested":{"preserved":true}}]}';

    const document = parseCanonicalProjectDocument(raw, importedProjectJsonSchema);

    expect(document.classification).toBe('CURRENT');
    expect(document.headerClassification).toBe('CURRENT');
    expect(document.projection?.title).toBe(validProject.title);
    expect(document.projection).not.toHaveProperty('opaqueTopLevel');
    expect(document.raw).toBe(raw);
    expect(document.raw).toContain('9007199254740993');
    expect(document.raw).toContain('"opaqueNested":{"preserved":true}');
  });

  it('returns a typed projection for unversioned legacy input without stamping it', () => {
    const document = parseCanonicalProjectDocument(
      JSON.stringify(validProject),
      importedProjectJsonSchema,
    );

    expect(document.classification).toBe('LEGACY_UNVERSIONED');
    expect(document.headerClassification).toBe('LEGACY_UNVERSIONED');
    expect(document.projection?.title).toBe(validProject.title);
    expect(document.raw).toBe(JSON.stringify(validProject));
  });

  it('preserves a future payload without producing an editable projection', () => {
    const raw = JSON.stringify({
      schemaVersion: 99,
      futureOnlyField: { preserved: true },
    });

    const document = parseCanonicalProjectDocument(raw, importedProjectJsonSchema);

    expect(document.classification).toBe('FUTURE');
    expect(document.headerClassification).toBe('FUTURE');
    expect(document.projection).toBeNull();
    expect(document.error).toBeNull();
    expect(document.raw).toBe(raw);
  });

  it('turns current typed validation failure into MALFORMED while retaining raw input', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      ...validProject,
      title: 42,
    });

    const document = parseCanonicalProjectDocument(raw, importedProjectJsonSchema);

    expect(document.classification).toBe('MALFORMED');
    expect(document.headerClassification).toBe('CURRENT');
    expect(document.projection).toBeNull();
    expect(document.raw).toBe(raw);
    expect(document.error).toMatch(/title/);
  });

  it('does not create a raw carrier for unparseable JSON', () => {
    const document = parseCanonicalProjectDocument('{"schemaVersion":1', importedProjectJsonSchema);

    expect(document.classification).toBe('MALFORMED');
    expect(document.headerClassification).toBe('MALFORMED');
    expect(document.raw).toBe('{"schemaVersion":1');
    expect(document.projection).toBeNull();
    expect(document.error).toMatch(/not valid JSON/);
  });

  it('performs explicit LEGACY_TO_V1 admission without reserializing the source payload', () => {
    const raw =
      '{\n  "title":"Legacy project",\n  "logline":"Preserve this",\n  "manuscript":[],\n  "opaque":{"exact":9007199254740993}\n}';

    const admission = admitCanonicalProjectDocument(raw, importedProjectJsonSchema);

    expect(admission.status).toBe('LEGACY_TO_V1');
    expect(admission.source.classification).toBe('LEGACY_UNVERSIONED');
    expect(admission.canonical?.classification).toBe('CURRENT');
    expect(admission.canonical?.projection?.title).toBe('Legacy project');
    expect(admission.canonical?.raw).toContain('"schemaVersion":1');
    expect(admission.canonical?.raw).toContain('9007199254740993');
    expect(admission.canonical?.raw).toContain('"opaque":{"exact":9007199254740993}');
  });

  it('refuses legacy input that fails the complete V1 projection', () => {
    const admission = admitCanonicalProjectDocument(
      JSON.stringify({ title: 'Missing logline', manuscript: [] }),
      importedProjectJsonSchema,
    );

    expect(admission.status).toBe('REFUSED');
    expect(admission.source.classification).toBe('MALFORMED');
    expect(admission.canonical).toBeNull();
  });

  it.each([
    ['future', JSON.stringify({ schemaVersion: 99, title: 'Future' })],
    ['migration gap', JSON.stringify({ schemaVersion: 0, ...validProject })],
    ['current typed failure', JSON.stringify({ ...validProject, schemaVersion: 1, title: 42 })],
  ])('refuses %s documents without a canonical editable projection', (_label, raw) => {
    const admission = admitCanonicalProjectDocument(raw, importedProjectJsonSchema);

    expect(admission.status).toBe('REFUSED');
    expect(admission.canonical).toBeNull();
  });
});
