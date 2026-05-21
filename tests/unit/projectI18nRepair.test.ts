import { describe, expect, it, vi } from 'vitest';
import { repairProjectI18nFields } from '../../services/projectI18nRepair';

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

  it('seeds manuscript when empty', () => {
    const repair = repairProjectI18nFields(
      { title: '', logline: '', manuscript: [] },
      t,
    );
    expect(repair?.title).toBe('My Untitled Story');
    expect(repair?.manuscript).toHaveLength(1);
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
