import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadEditorExportCarrier: vi.fn(),
    saveSnapshotText: vi.fn(),
    getProjectAuthority: vi.fn(async () => 'idb'),
  },
}));

import {
  _resetEditorProjectGenerationForTest,
  noteEditorEpoch,
  notePersistedEditorEpoch,
  toEditorReplacementEpoch,
} from '../../../services/editorProjectGeneration';
import { StaleProjectWriterError } from '../../../services/fs/fsCore';
import {
  createCanonicalProjectSnapshot,
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

beforeEach(() => {
  vi.mocked(storageService.loadEditorExportCarrier).mockReset();
  _resetEditorProjectGenerationForTest();
});

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

  it('overlays an ordinary edit onto the stored carrier of the same project', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);
    const raw = await loadCanonicalEgressRaw('p1', edited as never);
    expect(raw).toContain('"futureWidget"');
  });

  it('never overlays a replaced editor project onto the replaced project’s stored text', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);
    noteEditorEpoch(toEditorReplacementEpoch(1));

    const raw = await loadCanonicalEgressRaw('p1', { ...edited, title: 'Replacement B' } as never);

    // The backend fence is still consulted; only its payload is discarded.
    expect(storageService.loadEditorExportCarrier).toHaveBeenCalledWith('p1');
    expect(raw).not.toContain('futureWidget');
    expect(raw).not.toContain('bigCount');
    expect(JSON.parse(raw)).toMatchObject({ title: 'Replacement B', schemaVersion: 1 });
  });

  it('reuses the stored text again once the replacement epoch of this target is committed', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);
    noteEditorEpoch(toEditorReplacementEpoch(1));
    notePersistedEditorEpoch(edited, 'idb', toEditorReplacementEpoch(1));

    expect(await loadCanonicalEgressRaw('p1', edited as never)).toContain('"futureWidget"');
  });

  it('never reuses a committed baseline for another storage target (Safe-Session rekey)', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);
    notePersistedEditorEpoch(edited, 'idb', toEditorReplacementEpoch(0));

    const raw = await loadCanonicalEgressRaw('rekeyed', { ...edited, id: 'rekeyed' } as never);

    expect(raw).not.toContain('futureWidget');
  });

  it.each([
    [
      'STALE (another window advanced, deleted, or recreated the project)',
      new StaleProjectWriterError('p1'),
    ],
    ['REFUSED', new Error('refused')],
    ['UNSUPPORTED', new Error('unsupported')],
  ])(
    'still refuses a replaced project’s export when the backend fence answers %s',
    async (_label, refusal) => {
      vi.mocked(storageService.loadEditorExportCarrier).mockImplementation(() => {
        throw refusal;
      });
      noteEditorEpoch(toEditorReplacementEpoch(1));

      await expect(
        loadCanonicalEgressRaw('p1', { ...edited, title: 'Replacement B' } as never),
      ).rejects.toBe(refusal);
    },
  );

  it('snapshots the same canonical text as export but keeps machine-local metadata', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);

    await createCanonicalProjectSnapshot('manual', 'p1', edited as never);

    expect(storageService.loadEditorExportCarrier).toHaveBeenCalledWith('p1');
    const text = vi.mocked(storageService.saveSnapshotText).mock.calls.at(-1)?.[1] as string;
    expect(text).toContain('"title":"Unsaved edit"');
    expect(text).toContain('"bigCount":9007199254740993');
    expect(text).toContain('__worldscriptLegacyProjectDirectory');
  });

  it('builds a manual snapshot of a replaced editor project from its own state, fence still asked', async () => {
    vi.mocked(storageService.loadEditorExportCarrier).mockResolvedValue(storedRaw);
    noteEditorEpoch(toEditorReplacementEpoch(1));

    await createCanonicalProjectSnapshot('manual', 'p1', {
      ...edited,
      title: 'Replacement B',
    } as never);

    expect(storageService.loadEditorExportCarrier).toHaveBeenCalledWith('p1');
    const text = vi.mocked(storageService.saveSnapshotText).mock.calls.at(-1)?.[1] as string;
    expect(text).toContain('"title":"Replacement B"');
    expect(text).not.toContain('futureWidget');
  });
});
