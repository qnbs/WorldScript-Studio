import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/storageService', () => ({
  storageService: { loadEditorExportCarrier: vi.fn() },
}));

import {
  downloadCanonicalProjectExport,
  loadCanonicalEgressRaw,
  overlayProjectOntoCanonicalRaw,
  ProjectEgressError,
  toPortableProjectRaw,
} from '../../../services/projectCanonicalEgress';
import { admitCanonicalProjectDocument } from '../../../services/projectDocument';
import { importedProjectJsonSchema } from '../../../services/projectImportSchema';
import { storageService } from '../../../services/storageService';

const stored = {
  id: 'p1',
  schemaVersion: 1,
  title: 'Stored title',
  logline: 'L',
  characters: [],
  worlds: [],
  manuscript: [],
};
// An opaque field, an integer a parse would round, and the two machine-local trust keys.
const storedRaw = JSON.stringify(stored).replace(
  /}$/,
  ',"futureWidget":{"nested":[1,2,3]},"bigCount":9007199254740993,' +
    '"__worldscriptLegacyProjectDirectory":"old-dir",' +
    '"__worldscriptLegacyAuxiliary":{"legacyProjectId":"project"}}',
);
const edited = { ...stored, title: 'Unsaved edit' };

beforeEach(() => vi.mocked(storageService.loadEditorExportCarrier).mockReset());

describe('projectCanonicalEgress (#553 §2.8)', () => {
  it('applies the unsaved edit, keeps opaque data and exact tokens, and strips local trust metadata', () => {
    const raw = overlayProjectOntoCanonicalRaw(edited as never, storedRaw);

    expect(raw).toContain('"title":"Unsaved edit"');
    expect(raw).toContain('"futureWidget":{"nested":[1,2,3]}');
    expect(raw).toContain('"bigCount":9007199254740993');
    expect(raw).toContain('"schemaVersion":1');
    expect(raw).not.toContain('__worldscriptLegacyProjectDirectory');
    expect(raw).not.toContain('__worldscriptLegacyAuxiliary');
    expect(admitCanonicalProjectDocument(raw, importedProjectJsonSchema).status).toBe('CURRENT');
  });

  it('exports a never-saved project as a CURRENT document, not an unversioned one', () => {
    const { schemaVersion: _omit, ...unversioned } = edited;
    const raw = overlayProjectOntoCanonicalRaw(unversioned as never, null);

    expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1, title: 'Unsaved edit' });
    expect(admitCanonicalProjectDocument(raw, importedProjectJsonSchema).status).toBe('CURRENT');
  });

  it('refuses instead of exporting a lossy copy when the stored raw is not writable', () => {
    expect(() => overlayProjectOntoCanonicalRaw(edited as never, '{"title":')).toThrow(
      ProjectEgressError,
    );
  });

  it('refuses to emit a portable document this app would not admit', () => {
    expect(() => toPortableProjectRaw('{"schemaVersion":99,"title":"t","logline":"l"}')).toThrow(
      ProjectEgressError,
    );
  });

  it('asks the backend for the editor’s own carrier, never guessing a storage key', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);

    await loadCanonicalEgressRaw(undefined, edited as never);

    expect(storageService.loadEditorExportCarrier).toHaveBeenCalledWith(undefined);
  });

  it('writes no file and reports the refusal when the stored carrier cannot be exported', async () => {
    const createObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue('{"title":');
    const onRefused = vi.fn();

    await downloadCanonicalProjectExport('p1', edited as never, onRefused);

    expect(onRefused).toHaveBeenCalledWith(expect.any(ProjectEgressError));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
