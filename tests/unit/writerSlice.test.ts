import { beforeEach, describe, expect, it } from 'vitest';
import type { WriterState } from '../../features/writer/writerSlice';
import writerReducer from '../../features/writer/writerSlice';

// Helper to get initial state
function getInitialState(): WriterState {
  return writerReducer(undefined, { type: '@@INIT' });
}

describe('writerSlice', () => {
  let state: WriterState;

  beforeEach(() => {
    state = getInitialState();
  });

  describe('initial state', () => {
    it('should have correct defaults', () => {
      expect(state.activeTool).toBe('continue');
      expect(state.isLoading).toBe(false);
      expect(state.generationHistory).toEqual([]);
      expect(state.activeHistoryIndex).toBe(-1);
      expect(state.resultStream).toBe('');
      expect(state.selectedSectionId).toBeNull();
    });
  });

  describe('setActiveTool', () => {
    it('should change tool and reset history', () => {
      // Add some history first
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'item1' });
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'item2' });
      expect(state.generationHistory.length).toBe(2);

      // Change tool
      state = writerReducer(state, { type: 'writer/setActiveTool', payload: 'improve' });
      expect(state.activeTool).toBe('improve');
      expect(state.generationHistory).toEqual([]);
      expect(state.activeHistoryIndex).toBe(-1);
    });
  });

  describe('addHistory', () => {
    it('should prepend history items', () => {
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'first' });
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'second' });
      expect(state.generationHistory).toEqual(['second', 'first']);
      expect(state.activeHistoryIndex).toBe(0);
    });

    it('should limit history to 50 items', () => {
      for (let i = 0; i < 60; i++) {
        state = writerReducer(state, { type: 'writer/addHistory', payload: `item-${i}` });
      }
      expect(state.generationHistory.length).toBe(50);
      expect(state.generationHistory[0]).toBe('item-59');
    });
  });

  describe('clearHistory', () => {
    it('should reset history and index', () => {
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'item' });
      state = writerReducer(state, { type: 'writer/clearHistory' });
      expect(state.generationHistory).toEqual([]);
      expect(state.activeHistoryIndex).toBe(-1);
    });
  });

  describe('navigateHistory', () => {
    it('should navigate between history items', () => {
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'first' });
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'second' });
      state = writerReducer(state, { type: 'writer/addHistory', payload: 'third' });

      // History: [third, second, first], index: 0
      state = writerReducer(state, { type: 'writer/navigateHistory', payload: 'next' });
      expect(state.activeHistoryIndex).toBe(1); // second

      state = writerReducer(state, { type: 'writer/navigateHistory', payload: 'next' });
      expect(state.activeHistoryIndex).toBe(2); // first

      // Shouldn't go past end
      state = writerReducer(state, { type: 'writer/navigateHistory', payload: 'next' });
      expect(state.activeHistoryIndex).toBe(2);

      state = writerReducer(state, { type: 'writer/navigateHistory', payload: 'prev' });
      expect(state.activeHistoryIndex).toBe(1);
    });
  });

  describe('loading', () => {
    it('should toggle loading state', () => {
      state = writerReducer(state, { type: 'writer/startLoading' });
      expect(state.isLoading).toBe(true);

      state = writerReducer(state, { type: 'writer/stopLoading' });
      expect(state.isLoading).toBe(false);
    });
  });

  describe('resultStream', () => {
    it('should append to stream and reset', () => {
      state = writerReducer(state, { type: 'writer/appendResultStream', payload: 'Hello ' });
      state = writerReducer(state, { type: 'writer/appendResultStream', payload: 'World' });
      expect(state.resultStream).toBe('Hello World');

      state = writerReducer(state, { type: 'writer/clearResultStream' });
      expect(state.resultStream).toBe('');
    });
  });

  describe('selection', () => {
    it('should update text selection', () => {
      state = writerReducer(state, {
        type: 'writer/setSelection',
        payload: { start: 10, end: 20, text: 'selected text' },
      });
      expect(state.selection.start).toBe(10);
      expect(state.selection.end).toBe(20);
      expect(state.selection.text).toBe('selected text');
    });
  });

  describe('selectedSectionId', () => {
    it('should set section and reset selection', () => {
      state = writerReducer(state, {
        type: 'writer/setSelection',
        payload: { start: 5, end: 10, text: 'test' },
      });
      state = writerReducer(state, { type: 'writer/setSelectedSectionId', payload: 'sec-2' });
      expect(state.selectedSectionId).toBe('sec-2');
      expect(state.selection).toEqual({ start: 0, end: 0, text: '' });
    });
  });
});
