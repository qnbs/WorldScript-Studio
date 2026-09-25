import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadCanonicalProjectAdmission } = vi.hoisted(() => ({
  loadCanonicalProjectAdmission: vi.fn(),
}));
vi.mock('../../../../services/storage/idbProjectCanonicalAuthority', () => ({
  idbProjectCanonicalAuthority: { loadCanonicalProjectAdmission },
}));

import { IdbProjectStore } from '../../../../services/storage/idbProjectStore';

const current = (currentRaw: string) => ({
  status: 'CURRENT',
  currentRaw,
  generation: 'g',
  envelope: { kind: 'flat' },
});

describe('IdbProjectStore.loadCanonicalProjectRaw (#553 §2.8)', () => {
  beforeEach(() => loadCanonicalProjectAdmission.mockReset());

  it('returns the canonical raw text unchanged for the matching project', async () => {
    const raw = '{"id":"p1","bigCount":9007199254740993}';
    loadCanonicalProjectAdmission.mockResolvedValue(current(raw));
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'CURRENT',
      raw,
    });
  });

  it('accepts an id-less record for any key, like loadProject', async () => {
    loadCanonicalProjectAdmission.mockResolvedValue(current('{"title":"t"}'));
    await expect(
      new IdbProjectStore().loadCanonicalProjectRaw('browser-project'),
    ).resolves.toMatchObject({ status: 'CURRENT' });
  });

  it('reads another project’s record as absent', async () => {
    loadCanonicalProjectAdmission.mockResolvedValue(current('{"id":"other"}'));
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'ABSENT',
    });
  });

  it.each([
    [{ status: 'NOT_ADMITTED', classification: 'FUTURE' }, 'FUTURE'],
    [
      { status: 'GENERATION_CONTRADICTION', classification: 'LEGACY_UNVERSIONED' },
      'LEGACY_UNVERSIONED',
    ],
  ])('refuses a non-admitted record (%j)', async (admission, classification) => {
    loadCanonicalProjectAdmission.mockResolvedValue(admission);
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'REFUSED',
      classification,
    });
  });

  it('reports nothing stored as absent', async () => {
    loadCanonicalProjectAdmission.mockResolvedValue({ status: 'ABSENT' });
    await expect(new IdbProjectStore().loadCanonicalProjectRaw('p1')).resolves.toEqual({
      status: 'ABSENT',
    });
  });
});
