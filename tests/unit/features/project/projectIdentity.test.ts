import { describe, expect, it } from 'vitest';
import { getProjectTargetIdentity } from '../../../../features/project/projectIdentity';

describe('getProjectTargetIdentity', () => {
  it('returns null when the source is null or undefined', () => {
    expect(getProjectTargetIdentity(null)).toBeNull();
    expect(getProjectTargetIdentity(undefined)).toBeNull();
  });

  it('returns null when data has neither an id nor a legacy directory', () => {
    expect(getProjectTargetIdentity({ data: { title: 'Untitled' }, generation: 0 })).toBeNull();
  });

  it('incorporates the persisted id and generation into the identity', () => {
    expect(getProjectTargetIdentity({ data: { id: 'p1' }, generation: 0 })).toBe('id:p1:gen:0');
  });

  it('treats two snapshots with the same id but different generation as different projects', () => {
    // QNBS-v3: the core fix -- a fresh "New Project" always reuses id:'default', so two different reset sessions must be distinguishable by generation alone.
    const first = getProjectTargetIdentity({ data: { id: 'default' }, generation: 0 });
    const second = getProjectTargetIdentity({ data: { id: 'default' }, generation: 1 });
    expect(first).not.toBe(second);
  });

  it('treats two snapshots with the same id and the same generation as the same project', () => {
    const a = getProjectTargetIdentity({ data: { id: 'default' }, generation: 3 });
    const b = getProjectTargetIdentity({ data: { id: 'default' }, generation: 3 });
    expect(a).toBe(b);
  });

  it('defaults a missing generation to 0, matching pre-existing hand-built test fixtures', () => {
    expect(getProjectTargetIdentity({ data: { id: 'p1' } })).toBe(
      getProjectTargetIdentity({ data: { id: 'p1' }, generation: 0 }),
    );
  });

  it('falls back to the legacy directory metadata key when id is absent', () => {
    expect(
      getProjectTargetIdentity({
        data: { __worldscriptLegacyProjectDirectory: 'dir-1' },
        generation: 0,
      }),
    ).toBe('legacy:dir-1:gen:0');
  });

  it('prefers a real id over the legacy directory metadata when both are present', () => {
    const identity = getProjectTargetIdentity({
      data: { id: 'p1', __worldscriptLegacyProjectDirectory: 'dir-1' },
      generation: 0,
    });
    expect(identity).toBe('id:p1:gen:0');
  });
});
