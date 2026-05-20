import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock duckdbClient before importing duckdbAnalytics
vi.mock('../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    query: vi.fn(),
    exec: vi.fn(),
    init: vi.fn(),
    shutdown: vi.fn(),
    terminate: vi.fn(),
  },
}));

import {
  duckdbDualWrite,
  queryDailyProgress,
  querySceneOverlaps,
  queryStreak,
  queryWeeklyProgress,
} from '../../services/duckdb/duckdbAnalytics';
import { duckdbClient } from '../../services/duckdb/duckdbClient';

const mockQuery = vi.mocked(duckdbClient.query);
const mockExec = vi.mocked(duckdbClient.exec);

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ messageId: 'm1', ok: true, rows: [] });
  mockExec.mockResolvedValue({ messageId: 'm2', ok: true });
});

// ---------------------------------------------------------------------------
// queryDailyProgress
// ---------------------------------------------------------------------------
describe('queryDailyProgress', () => {
  it('calls duckdbClient.query with the project_id and returns rows', async () => {
    const rows = [{ project_id: 'p1', date: '2026-05-01', words: 500, rolling_7day_avg: 450 }];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await queryDailyProgress('p1', 30);
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("project_id = 'p1'"),
      undefined,
      undefined,
    );
  });

  it('returns empty array when DuckDB query fails', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: false, error: 'DB error' });
    const result = await queryDailyProgress('p1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// queryWeeklyProgress
// ---------------------------------------------------------------------------
describe('queryWeeklyProgress', () => {
  it('returns weekly rows on success', async () => {
    const rows = [{ project_id: 'p1', week_start: '2026-05-12', weekly_words: 3000 }];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await queryWeeklyProgress('p1', 12);
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('v_weekly_progress'),
      undefined,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// queryStreak
// ---------------------------------------------------------------------------
describe('queryStreak', () => {
  it('returns { current: 0, longest: 0 } when no history', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows: [] });
    const result = await queryStreak('p1');
    expect(result).toEqual({ current: 0, longest: 0 });
  });

  it('delegates streak computation to computeStreak', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({
      messageId: 'm1',
      ok: true,
      rows: [{ date: today, words: 300 }],
    });
    const result = await queryStreak('p1');
    // Today has words → current streak is at least 1
    expect(result.current).toBeGreaterThanOrEqual(1);
  });

  it('returns { current: 0, longest: 0 } on query failure', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: false });
    const result = await queryStreak('p1');
    expect(result).toEqual({ current: 0, longest: 0 });
  });
});

// ---------------------------------------------------------------------------
// querySceneOverlaps
// ---------------------------------------------------------------------------
describe('querySceneOverlaps', () => {
  it('returns overlap rows on success', async () => {
    const rows = [
      {
        section_a: 's1',
        section_b: 's2',
        project_id: 'p1',
        scene_start_a: '08:00',
        scene_start_b: '08:00',
      },
    ];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await querySceneOverlaps('p1');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('v_scene_overlap'),
      undefined,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// duckdbDualWrite
// ---------------------------------------------------------------------------
describe('duckdbDualWrite', () => {
  it('calls exec for projects + writing_history + sections', async () => {
    await duckdbDualWrite(
      'p1',
      'My Novel',
      'A logline',
      5000,
      50000,
      '2026-12-31',
      [{ date: '2026-05-20', words: 500 }],
      [{ id: 's1', title: 'Chapter 1', wordCount: 2000, status: 'draft', position: 0 }],
    );

    // Should have called exec at least 3 times: projects, writing_history, section
    expect(mockExec.mock.calls.length).toBeGreaterThanOrEqual(3);
    const sqls = mockExec.mock.calls.map(([sql]) => sql as string);
    expect(sqls.some((s) => s.includes('INSERT INTO projects'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO writing_history'))).toBe(true);
    expect(sqls.some((s) => s.includes('INSERT INTO sections'))).toBe(true);
  });

  it('skips writing_history INSERT when history is empty', async () => {
    await duckdbDualWrite('p1', 'T', 'L', 0, undefined, null, [], []);
    const sqls = mockExec.mock.calls.map(([sql]) => sql as string);
    expect(sqls.some((s) => s.includes('INSERT INTO writing_history'))).toBe(false);
  });

  it('skips sections INSERT when manuscript is empty', async () => {
    await duckdbDualWrite('p1', 'T', 'L', 0, undefined, null, [], []);
    const sqls = mockExec.mock.calls.map(([sql]) => sql as string);
    expect(sqls.some((s) => s.includes('INSERT INTO sections'))).toBe(false);
  });

  it('escapes single quotes in project title', async () => {
    await duckdbDualWrite('p1', "O'Brien's Story", 'logline', 0, undefined, null, [], []);
    const projectSql = mockExec.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO projects'),
    )?.[0] as string;
    expect(projectSql).toContain("O''Brien''s Story");
  });
});
