/**
 * insightGenerator tests — debounce timing, LRU cache hit/miss, and cancellation.
 * QNBS-v3: Uses vi.useFakeTimers to deterministically control debounce delays.
 */

import type { EntityState } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../../features/project/projectState';
import type { CopilotContext } from '../../../services/copilot/copilotContextService';
import {
  _clearInsightCache,
  cancelInsightGeneration,
  scheduleInsightGeneration,
} from '../../../services/copilot/insightGenerator';
import type { Character, World } from '../../../types';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

const emptyChars = (): EntityState<Character, string> => ({ ids: [], entities: {} });
const emptyWorlds = (): EntityState<World, string> => ({ ids: [], entities: {} });

function makeProject(id = 'p1'): ProjectData {
  return {
    title: `Novel-${id}`,
    logline: '',
    outline: [],
    manuscript: [{ id: `${id}-s1`, title: 'Ch1', content: 'The beginning.' }],
    characters: emptyChars(),
    worlds: emptyWorlds(),
  };
}

const ctx: CopilotContext = {
  view: 'manuscript',
  viewLabel: 'Manuscript',
  projectTitle: 'Test Novel',
  wordCount: 0,
  language: 'en',
  chapterCount: 1,
  characterCount: 0,
  worldEntryCount: 0,
  outlineCompleteness: 0,
  selectedText: '',
  openInsightCount: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  _clearInsightCache();
});

afterEach(() => {
  vi.useRealTimers();
  _clearInsightCache();
});

describe('insightGenerator.scheduleInsightGeneration', () => {
  it('calls onReady after the delay', () => {
    const project = makeProject();
    const onReady = vi.fn();

    scheduleInsightGeneration(project, ctx, onReady, 400);
    expect(onReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(Array.isArray(onReady.mock.calls[0]?.[0])).toBe(true);
  });

  it('debounces: only the last call fires when scheduled rapidly', () => {
    const project = makeProject();
    const onReady = vi.fn();

    scheduleInsightGeneration(project, ctx, onReady, 400);
    vi.advanceTimersByTime(200);
    scheduleInsightGeneration(project, ctx, onReady, 400);
    vi.advanceTimersByTime(200);
    scheduleInsightGeneration(project, ctx, onReady, 400);
    vi.advanceTimersByTime(400);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('serves from cache on a second identical call', () => {
    const project = makeProject();
    const first = vi.fn();
    const second = vi.fn();

    // First call — populates cache
    scheduleInsightGeneration(project, ctx, first, 400);
    vi.advanceTimersByTime(400);
    expect(first).toHaveBeenCalledTimes(1);

    // Second call with same project/ctx — cache hit
    scheduleInsightGeneration(project, ctx, second, 400);
    vi.advanceTimersByTime(400);
    expect(second).toHaveBeenCalledTimes(1);

    // Both calls should return the same findings array instance
    expect(first.mock.calls[0]?.[0]).toBe(second.mock.calls[0]?.[0]);
  });

  it('bypasses cache when project content changes', () => {
    const project1 = makeProject('p1');
    const project2: ProjectData = {
      ...makeProject('p1'),
      manuscript: [{ id: 'p1-s1', title: 'Ch1', content: 'Different content here.' }],
    };
    const first = vi.fn();
    const second = vi.fn();

    scheduleInsightGeneration(project1, ctx, first, 400);
    vi.advanceTimersByTime(400);

    scheduleInsightGeneration(project2, ctx, second, 400);
    vi.advanceTimersByTime(400);

    expect(second).toHaveBeenCalledTimes(1);
    // Different content → different hash → different cache entries (not same reference)
    expect(first.mock.calls[0]?.[0]).not.toBe(second.mock.calls[0]?.[0]);
  });

  it('bypasses cache when language changes', () => {
    const project = makeProject();
    const ctxDe: CopilotContext = { ...ctx, language: 'de' };
    const first = vi.fn();
    const second = vi.fn();

    scheduleInsightGeneration(project, ctx, first, 400);
    vi.advanceTimersByTime(400);

    scheduleInsightGeneration(project, ctxDe, second, 400);
    vi.advanceTimersByTime(400);

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('insightGenerator.cancelInsightGeneration', () => {
  it('prevents onReady from being called after cancel', () => {
    const onReady = vi.fn();

    scheduleInsightGeneration(makeProject(), ctx, onReady, 400);
    cancelInsightGeneration();
    vi.advanceTimersByTime(400);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('is safe to call when no timer is pending', () => {
    expect(() => cancelInsightGeneration()).not.toThrow();
  });
});

describe('insightGenerator._clearInsightCache', () => {
  it('causes next call to re-run analysis (cache miss after clear)', () => {
    const project = makeProject();
    const first = vi.fn();
    const second = vi.fn();

    scheduleInsightGeneration(project, ctx, first, 400);
    vi.advanceTimersByTime(400);

    _clearInsightCache();

    scheduleInsightGeneration(project, ctx, second, 400);
    vi.advanceTimersByTime(400);

    // Both called — cache was cleared between them
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // After clear, the returned array is a new reference
    expect(first.mock.calls[0]?.[0]).not.toBe(second.mock.calls[0]?.[0]);
  });
});
