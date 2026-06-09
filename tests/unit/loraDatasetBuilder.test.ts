import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetEntry } from '../../features/lora/types';
import {
  estimateDatasetQuality,
  exportAsJsonl,
  extractScenePairs,
  scoreDatasetEntries,
  scoreDatasetEntry,
} from '../../services/lora/loraDatasetBuilder';

// Mocks
vi.mock('../../services/storageService', () => ({
  storageService: {
    loadProject: vi.fn(),
  },
}));

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn(),
}));

vi.mock('../../services/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

import { embedText } from '../../services/ai/localEmbeddingService';
import { storageService } from '../../services/storageService';

const mockLoadProject = vi.mocked(storageService.loadProject);
const mockEmbedText = vi.mocked(embedText);

function makeEntry(overrides: Partial<DatasetEntry> = {}): DatasetEntry {
  return {
    id: 'e1',
    projectId: 'p1',
    instruction: 'Write a scene',
    input: 'The hero',
    output: 'The hero walked into the dark forest.',
    source: 'extracted',
    qualityScore: 0,
    wordCount: 7,
    createdAt: 0,
    ...overrides,
  };
}

// ── extractScenePairs ──────────────────────────────────────────────────────

describe('extractScenePairs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when project has no manuscript', async () => {
    mockLoadProject.mockResolvedValue({} as never);
    const result = await extractScenePairs('p1');
    expect(result).toEqual([]);
  });

  it('filters sections with too few words', async () => {
    mockLoadProject.mockResolvedValue({
      manuscript: [
        { id: 's1', title: 'Short', content: 'Hi' },
        { id: 's2', title: 'Long', content: 'a '.repeat(40) },
      ],
    } as never);
    const result = await extractScenePairs('p1');
    expect(result).toHaveLength(1);
    expect(result[0]!.wordCount).toBe(40);
  });

  it('filters sections with too many words', async () => {
    mockLoadProject.mockResolvedValue({
      manuscript: [{ id: 's1', title: 'TooLong', content: 'word '.repeat(700) }],
    } as never);
    const result = await extractScenePairs('p1');
    expect(result).toHaveLength(0);
  });

  it('splits content into input/output at 60%', async () => {
    const content = 'word '.repeat(50).trim(); // 50 words, well within 30–600 range
    mockLoadProject.mockResolvedValue({
      manuscript: [{ id: 's1', title: 'Scene', content }],
    } as never);
    const result = await extractScenePairs('p1');
    expect(result).toHaveLength(1);
    const expectedInputLength = Math.floor(content.length * 0.6);
    expect(result[0]!.input).toBe(content.slice(0, expectedInputLength));
    expect(result[0]!.output).toBe(content.slice(expectedInputLength));
  });

  it('handles storage errors gracefully', async () => {
    mockLoadProject.mockRejectedValue(new Error('IDB timeout'));
    const result = await extractScenePairs('p1');
    expect(result).toEqual([]);
  });
});

// ── scoreDatasetEntries ────────────────────────────────────────────────────

describe('scoreDatasetEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockImplementation((text: string) => {
      // Deterministic embedding based on text length
      const arr = new Float32Array(384);
      arr[0] = text.length / 100;
      arr[1] = 1;
      return Promise.resolve(arr);
    });
  });

  it('returns empty array for empty input', async () => {
    const result = await scoreDatasetEntries([]);
    expect(result).toEqual([]);
  });

  it('assigns quality scores based on embedding similarity', async () => {
    const entries = [makeEntry(), makeEntry({ id: 'e2', output: 'Different text here.' })];
    const result = await scoreDatasetEntries(entries);
    expect(result[0]!.qualityScore).toBeGreaterThan(0);
    expect(result[0]!.qualityScore).toBeLessThanOrEqual(1);
  });

  it('defaults to 0.5 on embed failure', async () => {
    mockEmbedText.mockRejectedValue(new Error('OOM'));
    const entries = [makeEntry()];
    const result = await scoreDatasetEntries(entries);
    expect(result[0]!.qualityScore).toBe(0.5);
  });
});

// ── scoreDatasetEntry ──────────────────────────────────────────────────────

describe('scoreDatasetEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue(new Float32Array(384).fill(0.5));
  });

  it('returns a single quality score', async () => {
    const score = await scoreDatasetEntry(makeEntry());
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── estimateDatasetQuality ─────────────────────────────────────────────────

describe('estimateDatasetQuality', () => {
  it('handles empty entries', () => {
    const report = estimateDatasetQuality([]);
    expect(report.totalEntries).toBe(0);
    expect(report.averageQualityScore).toBe(0);
    expect(report.readyToTrain).toBe(false);
  });

  it('categorizes entries by quality threshold', () => {
    const entries = [
      makeEntry({ qualityScore: 0.3 }), // rejected
      makeEntry({ qualityScore: 0.5 }), // flagged (accepted but < flag threshold)
      makeEntry({ qualityScore: 0.8 }), // accepted
    ];
    const report = estimateDatasetQuality(entries);
    expect(report.rejectedEntries).toBe(1);
    expect(report.acceptedEntries).toBe(2); // >= 0.4
    expect(report.flaggedEntries).toBe(1); // >= 0.4 && < 0.6
    expect(report.totalEntries).toBe(3);
  });

  it('computes averages correctly', () => {
    const entries = [
      makeEntry({ qualityScore: 0.5, wordCount: 100 }),
      makeEntry({ qualityScore: 1.0, wordCount: 200 }),
    ];
    const report = estimateDatasetQuality(entries);
    expect(report.averageQualityScore).toBe(0.75);
    expect(report.averageWordCount).toBe(150);
  });

  it('reports readyToTrain when >= 50 accepted entries', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeEntry({ id: `e${i}`, qualityScore: 0.5 }),
    );
    const report = estimateDatasetQuality(entries);
    expect(report.readyToTrain).toBe(true);
  });

  it('breaks down by source', () => {
    const entries = [
      makeEntry({ source: 'extracted' }),
      makeEntry({ source: 'synthetic' }),
      makeEntry({ source: 'synthetic' }),
    ];
    const report = estimateDatasetQuality(entries);
    expect(report.sourceBreakdown.extracted).toBe(1);
    expect(report.sourceBreakdown.synthetic).toBe(2);
  });
});

// ── exportAsJsonl ──────────────────────────────────────────────────────────

describe('exportAsJsonl', () => {
  it('exports alpaca format', () => {
    const entries = [makeEntry({ qualityScore: 0.5 })];
    const jsonl = exportAsJsonl(entries, 'alpaca');
    const parsed = JSON.parse(jsonl);
    expect(parsed).toHaveProperty('instruction');
    expect(parsed).toHaveProperty('input');
    expect(parsed).toHaveProperty('output');
  });

  it('exports chatml format', () => {
    const entries = [makeEntry({ qualityScore: 0.5 })];
    const jsonl = exportAsJsonl(entries, 'chatml');
    const parsed = JSON.parse(jsonl);
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0]!.role).toBe('system');
  });

  it('exports sharegpt format', () => {
    const entries = [makeEntry({ qualityScore: 0.5 })];
    const jsonl = exportAsJsonl(entries, 'sharegpt');
    const parsed = JSON.parse(jsonl);
    expect(parsed.conversations).toHaveLength(2);
    expect(parsed.conversations[0]!.from).toBe('human');
  });

  it('filters out low-quality entries', () => {
    const entries = [
      makeEntry({ qualityScore: 0.3 }), // rejected
      makeEntry({ qualityScore: 0.5 }), // accepted
    ];
    const jsonl = exportAsJsonl(entries, 'alpaca');
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('handles empty entries', () => {
    const jsonl = exportAsJsonl([], 'alpaca');
    expect(jsonl).toBe('');
  });
});
