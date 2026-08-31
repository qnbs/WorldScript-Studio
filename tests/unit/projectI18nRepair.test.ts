import { describe, expect, it, vi } from 'vitest';
import { type ProjectMetaSlice, repairProjectI18nFields } from '../../services/projectI18nRepair';

describe('repairProjectI18nFields', () => {
  const t = vi.fn((key: string) => {
    const map: Record<string, string> = {
      'initialProject.title': 'My Untitled Story',
      'initialProject.logline': 'A journey...',
      'initialProject.chapter1': 'Chapter 1',
    };
    return map[key] ?? key;
  });

  it('repairs raw i18n keys in title and logline', () => {
    const repair = repairProjectI18nFields(
      {
        title: 'initialProject.title',
        logline: 'initialProject.logline',
        manuscript: [{ id: '1', title: 'initialProject.chapter1', content: '' }],
      },
      t,
    );
    expect(repair?.title).toBe('My Untitled Story');
    expect(repair?.logline).toBe('A journey...');
    expect(repair?.manuscript?.[0]?.title).toBe('Chapter 1');
  });

  // QNBS-v3: separates user-intent preservation from explicit fresh-project metadata seeding.
  it('preserves intentionally empty title and logline while still seeding an empty manuscript', () => {
    const repair = repairProjectI18nFields({ title: '', logline: '', manuscript: [] }, t);
    expect(repair?.title).toBeUndefined();
    expect(repair?.logline).toBeUndefined();
    expect(repair?.manuscript).toHaveLength(1);
  });

  it('seeds blank metadata only when fresh-user bootstrap explicitly authorizes it', () => {
    const repair = repairProjectI18nFields({ title: '', logline: '', manuscript: [] }, t, {
      seedInitialMetadata: true,
    });
    expect(repair?.title).toBe('My Untitled Story');
    expect(repair?.logline).toBe('A journey...');
    expect(repair?.manuscript).toHaveLength(1);
  });

  it('leaves intentionally empty metadata untouched when the project has real content', () => {
    const repair = repairProjectI18nFields(
      {
        title: '',
        logline: '',
        manuscript: [{ id: '1', title: 'Chapter 1', content: 'Existing work' }],
      },
      t,
    );
    expect(repair).toBeNull();
  });

  it('repairs missing title without replacing the persisted project content', () => {
    const repair = repairProjectI18nFields(
      {
        logline: 'Existing logline',
        manuscript: [{ id: '1', title: 'Chapter 1', content: 'Existing work' }],
      } as unknown as ProjectMetaSlice,
      t,
    );
    expect(repair).toEqual({ title: 'My Untitled Story' });
  });

  // QNBS-v3: missing presentation metadata is repaired without discarding the genuine persisted project.
  it('repairs missing logline without replacing the persisted project content', () => {
    const repair = repairProjectI18nFields(
      {
        title: 'Existing title',
        manuscript: [{ id: '1', title: 'Chapter 1', content: 'Existing work' }],
      } as unknown as ProjectMetaSlice,
      t,
    );
    expect(repair).toEqual({ logline: 'A journey...' });
  });

  it('returns null when project metadata is already human-readable', () => {
    const repair = repairProjectI18nFields(
      {
        title: 'Echoes of Dawn',
        logline: 'A pilot returns home.',
        manuscript: [{ id: '1', title: 'Prologue', content: 'Once...' }],
      },
      t,
    );
    expect(repair).toBeNull();
  });
});
