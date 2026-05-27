/**
 * Tests for services/lora/loraDatasetBuilder.ts
 * QNBS-v3: Dataset extraction, quality scoring, and JSONL export.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock storageService before import
vi.mock('../../../services/storageService', () => ({
  storageService: {
    loadProject: vi.fn().mockResolvedValue({
      manuscript: [
        {
          id: 's1',
          title: 'Chapter One',
          content:
            'The old lighthouse keeper had not left the island in forty years. Each morning he climbed the spiral staircase, oiled the gears, and polished the great lens until it blazed like a captured sun. Tonight a storm was coming.',
        },
        {
          id: 's2',
          title: 'Chapter Two',
          content:
            "She found the letter buried beneath the floorboards, wrapped in oilcloth and tied with a faded ribbon. The handwriting was her grandmother's, spidery and trembling, as if written in great haste or great fear.",
        },
        {
          id: 's3',
          title: 'Too Short',
          content: 'Short.',
        },
      ],
    }),
  },
}));

vi.mock('../../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

import type { DatasetEntry } from '../../../features/lora/types';
import {
  estimateDatasetQuality,
  exportAsJsonl,
  extractScenePairs,
  scoreDatasetEntries,
} from '../../../services/lora/loraDatasetBuilder';

const mockEntry = (qualityScore = 0.7): DatasetEntry => ({
  id: 'e1',
  projectId: 'p1',
  instruction: 'Continue this scene',
  input: 'The keeper watched',
  output: 'The keeper watched as the storm drew closer, his weathered hands gripping the railing.',
  source: 'extracted',
  qualityScore,
  wordCount: 15,
  createdAt: Date.now(),
});

describe('extractScenePairs', () => {
  it('extracts sections meeting word count criteria', async () => {
    const entries = await extractScenePairs('proj-1');
    // 2 sections are long enough (s3 is too short)
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.projectId === 'proj-1')).toBe(true);
    expect(entries.every((e) => e.source === 'extracted')).toBe(true);
  });

  it('includes instruction and output fields', async () => {
    const entries = await extractScenePairs('proj-1');
    for (const e of entries) {
      expect(e.instruction).toContain('Chapter');
      expect(e.output.length).toBeGreaterThan(0);
    }
  });
});

describe('scoreDatasetEntries', () => {
  it('returns same count of entries with qualityScore set', async () => {
    const entries = [mockEntry(0), mockEntry(0)];
    const scored = await scoreDatasetEntries(entries);
    expect(scored).toHaveLength(2);
    expect(scored.every((e) => typeof e.qualityScore === 'number')).toBe(true);
  });
});

describe('estimateDatasetQuality', () => {
  it('counts accepted / rejected / flagged correctly', () => {
    const entries: DatasetEntry[] = [
      mockEntry(0.8), // accepted, above flag threshold
      mockEntry(0.5), // accepted, flagged (between 0.4 and 0.6)
      mockEntry(0.2), // rejected
      mockEntry(0.3), // rejected
    ];
    const report = estimateDatasetQuality(entries);
    expect(report.totalEntries).toBe(4);
    expect(report.rejectedEntries).toBe(2);
    expect(report.readyToTrain).toBe(false); // < 50 accepted
  });

  it('readyToTrain is true when >= 50 accepted entries', () => {
    const entries = Array.from({ length: 55 }, () => mockEntry(0.7));
    const report = estimateDatasetQuality(entries);
    expect(report.readyToTrain).toBe(true);
  });
});

describe('exportAsJsonl', () => {
  const entries: DatasetEntry[] = [
    mockEntry(0.8),
    mockEntry(0.3), // should be filtered out (below threshold)
  ];

  it('alpaca format contains instruction and output fields', () => {
    const jsonl = exportAsJsonl(entries, 'alpaca');
    const lines = jsonl.split('\n').filter(Boolean);
    // Only the accepted entry
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toHaveProperty('instruction');
    expect(parsed).toHaveProperty('output');
  });

  it('chatml format produces messages array', () => {
    const jsonl = exportAsJsonl(entries, 'chatml');
    const lines = jsonl.split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.messages).toBeInstanceOf(Array);
    expect(parsed.messages[0].role).toBe('system');
  });

  it('sharegpt format produces conversations array', () => {
    const jsonl = exportAsJsonl(entries, 'sharegpt');
    const lines = jsonl.split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.conversations).toBeInstanceOf(Array);
    expect(parsed.conversations[0].from).toBe('human');
  });
});
