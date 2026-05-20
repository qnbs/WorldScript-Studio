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
  duckdbCodexWrite,
  duckdbCrossProjectWrite,
  duckdbDualWrite,
  duckdbRagWrite,
  queryCharacterCoOccurrence,
  queryCrossProjectSearch,
  queryDailyProgress,
  queryRagSimilarity,
  querySceneOverlaps,
  querySceneOverlapsWithTitles,
  queryStreak,
  queryWeeklyProgress,
  withDuckDbRetry,
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

  it('includes scene_start in sections INSERT when provided', async () => {
    await duckdbDualWrite(
      'p1',
      'T',
      'L',
      0,
      undefined,
      null,
      [],
      [{ id: 's1', title: 'Ch1', wordCount: 100, position: 0, scene_start: '2026-01-01T08:00' }],
    );
    const sectionSql = mockExec.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO sections'),
    )?.[0] as string;
    expect(sectionSql).toContain('2026-01-01T08:00');
  });

  it('inserts NULL for scene_start when absent', async () => {
    await duckdbDualWrite(
      'p1',
      'T',
      'L',
      0,
      undefined,
      null,
      [],
      [{ id: 's1', title: 'Ch1', wordCount: 100, position: 0 }],
    );
    const sectionSql = mockExec.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO sections'),
    )?.[0] as string;
    expect(sectionSql).toContain('NULL');
  });
});

// ---------------------------------------------------------------------------
// duckdbRagWrite (P2)
// ---------------------------------------------------------------------------
describe('duckdbRagWrite', () => {
  it('calls exec for each chunk with vector literal', async () => {
    await duckdbRagWrite('p1', [
      { id: 's1:0', sectionId: 's1', chunkIndex: 0, vector: [0.5, 0.3, 0.1] },
    ]);
    const sqls = mockExec.mock.calls.map(([sql]) => sql as string);
    expect(sqls.some((s) => s.includes('INSERT INTO rag_chunks'))).toBe(true);
    expect(sqls.some((s) => s.includes("chunk_id = 's1:0'") || s.includes("'s1:0'"))).toBe(true);
  });

  it('no-ops when chunks array is empty', async () => {
    await duckdbRagWrite('p1', []);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('encodes vector as SQL FLOAT[] literal', async () => {
    await duckdbRagWrite('p1', [
      { id: 'c1', sectionId: 's1', chunkIndex: 0, vector: [0.25, 0.75] },
    ]);
    const sql = mockExec.mock.calls[0]?.[0] as string;
    expect(sql).toContain('[0.25000000,0.75000000]::FLOAT[]');
  });
});

// ---------------------------------------------------------------------------
// queryRagSimilarity (P2)
// ---------------------------------------------------------------------------
describe('queryRagSimilarity', () => {
  it('returns similarity rows on success', async () => {
    const rows = [{ chunk_id: 'c1', section_id: 's1', chunk_index: 0, score: 0.9 }];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await queryRagSimilarity('p1', new Float32Array([0.5, 0.5]), 5);
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('list_dot_product'),
      undefined,
      undefined,
    );
  });

  it('returns empty array on query failure', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: false });
    const result = await queryRagSimilarity('p1', [0.1, 0.2], 3);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// querySceneOverlapsWithTitles (P3)
// ---------------------------------------------------------------------------
describe('querySceneOverlapsWithTitles', () => {
  it('returns rows with titles on success', async () => {
    const rows = [{ section_a: 's1', section_b: 's2', title_a: 'Dawn', title_b: 'River' }];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await querySceneOverlapsWithTitles('p1');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('v_scene_overlap'),
      undefined,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// queryCharacterCoOccurrence (P3)
// ---------------------------------------------------------------------------
describe('queryCharacterCoOccurrence', () => {
  it('returns co-occurrence rows on success', async () => {
    const rows = [{ character_a: 'c1', character_b: 'c2', project_id: 'p1', shared_sections: 3 }];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await queryCharacterCoOccurrence('p1');
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('v_character_cooccurrence'),
      undefined,
      undefined,
    );
  });

  it('returns empty array on failure', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: false });
    expect(await queryCharacterCoOccurrence('p1')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// queryCrossProjectSearch (P3)
// ---------------------------------------------------------------------------
describe('queryCrossProjectSearch', () => {
  it('returns ranked rows on success', async () => {
    const rows = [
      {
        project_id: 'px',
        title: 'Epic',
        logline: 'A tale',
        manuscript_word_count: 30000,
        character_names: ['Alice'],
        last_indexed: '2026-05-20',
        score: 0.88,
      },
    ];
    mockQuery.mockResolvedValueOnce({ messageId: 'm1', ok: true, rows });

    const result = await queryCrossProjectSearch(new Float32Array([0.1, 0.2]), 3);
    expect(result).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('cross_project_index'),
      undefined,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// duckdbCrossProjectWrite (P3)
// ---------------------------------------------------------------------------
describe('duckdbCrossProjectWrite', () => {
  it('calls exec with INSERT INTO cross_project_index', async () => {
    await duckdbCrossProjectWrite({
      projectId: 'p1',
      title: 'Novel',
      logline: 'A hero',
      manuscriptWordCount: 5000,
      characterNames: ['Alice', "O'Brien"],
    });
    const sql = mockExec.mock.calls.find(([s]) =>
      (s as string).includes('INSERT INTO cross_project_index'),
    )?.[0] as string;
    expect(sql).toBeDefined();
    expect(sql).toContain("O''Brien");
    expect(sql).toContain('NULL'); // no embedding
  });

  it('includes FLOAT[] literal when embeddingVector provided', async () => {
    await duckdbCrossProjectWrite({
      projectId: 'p1',
      title: 'T',
      logline: 'L',
      manuscriptWordCount: 0,
      characterNames: [],
      embeddingVector: [0.1, 0.2],
    });
    const sql = mockExec.mock.calls[0]?.[0] as string;
    expect(sql).toContain('::FLOAT[]');
  });
});

// ---------------------------------------------------------------------------
// duckdbCodexWrite (P3)
// ---------------------------------------------------------------------------
describe('duckdbCodexWrite', () => {
  it('no-ops when entities array is empty', async () => {
    await duckdbCodexWrite('p1', []);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('calls exec for entity + each mention', async () => {
    await duckdbCodexWrite('p1', [
      {
        id: 'e1',
        name: 'Alice',
        type: 'character',
        mentionCount: 2,
        mentions: [
          { sectionId: 's1', excerpt: 'Alice arrived.' },
          { sectionId: 's2', excerpt: 'Alice left.' },
        ],
      },
    ]);
    const sqls = mockExec.mock.calls.map(([s]) => s as string);
    expect(sqls.some((s) => s.includes('INSERT INTO codex_entities'))).toBe(true);
    expect(sqls.filter((s) => s.includes('INSERT INTO codex_mentions'))).toHaveLength(2);
  });

  it('escapes single quotes in entity name', async () => {
    await duckdbCodexWrite('p1', [
      { id: 'e1', name: "O'Brien", type: 'character', mentionCount: 1, mentions: [] },
    ]);
    const sql = mockExec.mock.calls[0]?.[0] as string;
    expect(sql).toContain("O''Brien");
  });
});

// ---------------------------------------------------------------------------
// withDuckDbRetry
// ---------------------------------------------------------------------------
describe('withDuckDbRetry', () => {
  it('returns result immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withDuckDbRetry(fn, 3);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on second attempt', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const promise = withDuckDbRetry(fn, 3);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws after exhausting all attempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    // Pre-attach rejection handler before running timers to prevent unhandled-rejection warnings.
    const settled = withDuckDbRetry(fn, 3).then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, error: e }),
    );
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: unknown }).error).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// duckdbDualWrite — throws on exec failure
// ---------------------------------------------------------------------------
describe('duckdbDualWrite exec failure', () => {
  it('throws when exec returns ok: false', async () => {
    mockExec.mockResolvedValueOnce({ messageId: 'm1', ok: false, error: 'disk full' });
    await expect(duckdbDualWrite('p1', 'T', 'L', 100, undefined, null, [], [])).rejects.toThrow(
      'disk full',
    );
  });
});
