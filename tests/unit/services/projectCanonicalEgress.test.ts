import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/storageService', () => ({
  storageService: { loadCanonicalProjectRaw: vi.fn() },
}));

import {
  loadCanonicalEgressRaw,
  overlayProjectOntoCanonicalRaw,
  ProjectEgressError,
} from '../../../services/projectCanonicalEgress';
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
// An opaque field and an integer a JSON.parse round-trip would round.
const storedRaw = JSON.stringify(stored).replace(
  /}$/,
  ',"futureWidget":{"nested":[1,2,3]},"bigCount":9007199254740993}',
);
const edited = { ...stored, title: 'Unsaved edit' };

describe('projectCanonicalEgress (#553 §2.8)', () => {
  it('overlays the unsaved edit and keeps every stored opaque field byte-for-byte', () => {
    const raw = overlayProjectOntoCanonicalRaw(edited as never, storedRaw);

    expect(raw).toContain('"title":"Unsaved edit"');
    expect(raw).toContain('"futureWidget":{"nested":[1,2,3]}');
    expect(raw).toContain('"bigCount":9007199254740993');
    expect(raw).toContain('"schemaVersion":1');
  });

  it('serializes the in-memory project when nothing is stored yet', () => {
    expect(overlayProjectOntoCanonicalRaw(edited as never, null)).toBe(JSON.stringify(edited));
  });

  it('refuses instead of exporting a lossy copy when the stored raw is not writable', () => {
    expect(() => overlayProjectOntoCanonicalRaw(edited as never, '{"title":')).toThrow(
      ProjectEgressError,
    );
  });

  it('reads the stored raw for the project, falling back to the id-less IndexedDB key', async () => {
    vi.mocked(storageService.loadCanonicalProjectRaw).mockResolvedValue(storedRaw);

    await loadCanonicalEgressRaw('p1', edited as never);
    await loadCanonicalEgressRaw(undefined, edited as never);

    expect(storageService.loadCanonicalProjectRaw).toHaveBeenNthCalledWith(1, 'p1');
    expect(storageService.loadCanonicalProjectRaw).toHaveBeenNthCalledWith(2, 'browser-project');
  });
});
