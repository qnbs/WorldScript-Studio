import { describe, expect, it } from 'vitest';
import { admitStructuredSnapshotRestore } from '../../../services/snapshotRestoreAdmission';

const target = { id: 'p1', title: 'Current' };
const snapshot = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  schemaVersion: 1,
  title: 'Snapshot',
  logline: 'L',
  futureWidget: { k: 1 },
  ...overrides,
});

describe('admitStructuredSnapshotRestore (#553 §2.8, a6)', () => {
  it('admits a current snapshot of the same project, opaque fields kept', () => {
    expect(admitStructuredSnapshotRestore(snapshot(), target as never)).toMatchObject({
      id: 'p1',
      schemaVersion: 1,
      title: 'Snapshot',
      futureWidget: { k: 1 },
    });
  });

  it('stamps a pre-version snapshot as current in memory', () => {
    const { schemaVersion: _omit, ...legacy } = snapshot();
    expect(admitStructuredSnapshotRestore(legacy, target as never)).toMatchObject({
      schemaVersion: 1,
    });
  });

  it.each([
    ['a future version', snapshot({ schemaVersion: 99 })],
    ['malformed owned fields', snapshot({ title: 42 })],
    ['a non-object', 'not a project'],
  ])('refuses %s before it can reach the editor', (_label, value) => {
    expect(() => admitStructuredSnapshotRestore(value, target as never)).toThrow(
      expect.objectContaining({ name: 'ProjectSnapshotRestoreError', reason: 'snapshot-invalid' }),
    );
  });

  it('refuses a snapshot that belongs to another project', () => {
    expect(() =>
      admitStructuredSnapshotRestore(snapshot({ id: 'other' }), target as never),
    ).toThrow(expect.objectContaining({ reason: 'snapshot-owner-mismatch' }));
  });

  it('refuses a missing snapshot', () => {
    expect(() => admitStructuredSnapshotRestore(undefined, target as never)).toThrow(
      expect.objectContaining({ reason: 'snapshot-unavailable' }),
    );
  });

  it.each([
    [
      'the snapshot has no id',
      (() => {
        const { id: _id, ...rest } = snapshot();
        return rest;
      })(),
      target,
    ],
    ['the target has no id', snapshot(), { title: 'Current' }],
    [
      'neither has an id',
      (() => {
        const { id: _id, ...rest } = snapshot();
        return rest;
      })(),
      { title: 'Current' },
    ],
    ['an id is empty', snapshot({ id: '' }), target],
  ])(
    'refuses as unverifiable when %s — two missing ids prove nothing',
    (_label, value, current) => {
      expect(() => admitStructuredSnapshotRestore(value, current as never)).toThrow(
        expect.objectContaining({ reason: 'snapshot-owner-unverifiable' }),
      );
    },
  );
});
