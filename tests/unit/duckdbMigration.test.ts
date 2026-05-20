import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    query: vi.fn(),
    exec: vi.fn(),
    init: vi.fn(),
    shutdown: vi.fn(),
    terminate: vi.fn(),
  },
}));

vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  duckdbDualWrite: vi.fn(),
}));

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { duckdbDualWrite } from '../../services/duckdb/duckdbAnalytics';
import { duckdbClient } from '../../services/duckdb/duckdbClient';
import { isMigrated, runIfNeeded } from '../../services/duckdb/duckdbMigration';

const mockQuery = vi.mocked(duckdbClient.query);
const mockExec = vi.mocked(duckdbClient.exec);
const mockDualWrite = vi.mocked(duckdbDualWrite);

const sampleProject = {
  id: 'proj-1',
  title: 'Test Novel',
  logline: 'A great story',
  projectGoals: { totalWordCount: 50000, targetDate: '2026-12-31' },
  writingHistory: [{ date: '2026-05-20', words: 500 }],
  manuscript: [{ id: 's1', title: 'Chapter 1', content: 'Hello world', status: 'draft' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ messageId: 'm', ok: true });
  mockDualWrite.mockResolvedValue(undefined);
});

describe('isMigrated', () => {
  it('returns true when _meta row exists', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    expect(await isMigrated()).toBe(true);
  });

  it('returns false when no _meta row', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    expect(await isMigrated()).toBe(false);
  });

  it('returns false when query fails', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: false });
    expect(await isMigrated()).toBe(false);
  });
});

describe('runIfNeeded', () => {
  it('skips migration if marker already present', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    await runIfNeeded(sampleProject);
    expect(mockDualWrite).not.toHaveBeenCalled();
  });

  it('runs duckdbDualWrite when marker absent', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    await runIfNeeded(sampleProject);
    expect(mockDualWrite).toHaveBeenCalledOnce();
  });

  it('writes _meta marker after successful migration', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    await runIfNeeded(sampleProject);
    const markerCall = mockExec.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO _meta'),
    );
    expect(markerCall).toBeDefined();
  });

  it('does NOT write marker when duckdbDualWrite throws', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    mockDualWrite.mockRejectedValueOnce(new Error('IDB error'));
    await expect(runIfNeeded(sampleProject)).rejects.toThrow('IDB error');
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('counts words from section content', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    const project = {
      ...sampleProject,
      manuscript: [{ id: 's1', title: 'Ch1', content: 'one two three four five' }],
    };
    await runIfNeeded(project);
    const callArgs = mockDualWrite.mock.calls[0]!;
    // 4th arg is totalWordCount, 7th is sections array
    const sections = callArgs[7] as { wordCount: number }[];
    expect(sections[0]!.wordCount).toBe(5);
  });
});
