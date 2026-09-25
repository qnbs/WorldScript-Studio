import { describe, expect, it } from 'vitest';
import { buildImportReplacementCarrier } from '../../../services/projectImportCarrier';
import { parseImportedProjectDocument } from '../../../services/projectImportSchema';

const IMPORT_TEXT =
  '{"schemaVersion":1,"id":"p1","title":"T","logline":"L","manuscript":[],' +
  '"characters":[{"id":"c1","name":"Ada","avatarBase64":"QUJD","charExact":9007199254740993}],' +
  '"worlds":{"ids":["w1"],"entities":{"w1":{"id":"w1","name":"Aldoria","ambianceImageBase64":"REVG","keep":true}}},' +
  '"topOpaque":{"nested":[1,2]},"__worldscriptLegacyProjectDirectory":"local-dir","__worldscriptLegacyAuxiliary":{"k":1}}';

describe('buildImportReplacementCarrier (#553 a4)', () => {
  it('keeps the admitted text’s opaque data and exact tokens, dropping only inline image copies', () => {
    const { raw } = parseImportedProjectDocument(IMPORT_TEXT);
    const carrier = buildImportReplacementCarrier(raw) as string;

    expect(carrier).toContain('"charExact":9007199254740993');
    expect(carrier).toContain('"topOpaque":{"nested":[1,2]}');
    expect(carrier).toContain('"keep":true');
    expect(carrier).not.toContain('avatarBase64');
    expect(carrier).not.toContain('ambianceImageBase64');
    // Import admission already removes machine-local metadata; the carrier never reintroduces it.
    expect(carrier).not.toContain('__worldscriptLegacy');
  });

  it('returns the admitted text unchanged when it has no inline images', () => {
    const raw =
      '{"schemaVersion":1,"id":"p1","title":"T","characters":[],"worlds":[],"x":9007199254740993}';
    expect(buildImportReplacementCarrier(raw)).toBe(raw);
  });

  it('returns null for text it cannot prepare', () => {
    expect(buildImportReplacementCarrier('{"title":')).toBeNull();
    expect(buildImportReplacementCarrier('[1,2]')).toBeNull();
  });
});
