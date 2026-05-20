// QNBS-v3: plotBoardSlice now only holds viewport/UI state (mode, zoom, pan, draw state).
//          Connection/subplot/tension tests moved to projectSlice (they are undo-able there).
import { describe, expect, it } from 'vitest';
import plotBoardReducer, {
  type PlotBoardState,
  plotBoardActions,
  selectActiveMode,
  selectActiveSubplotFilter,
  selectIsDrawingConnection,
  selectSelectedConnectionId,
  selectSnapToGrid,
} from '../../features/plotBoard/plotBoardSlice';

// ── Helpers ────────────────────────────────────────────────────────────────

function getInitialState(): PlotBoardState {
  return plotBoardReducer(undefined, { type: '@@INIT' });
}

// ── Mode switching ─────────────────────────────────────────────────────────

describe('plotBoard — mode', () => {
  it('starts in swimlane mode', () => {
    const state = getInitialState();
    expect(selectActiveMode({ plotBoard: state })).toBe('swimlane');
  });

  it('switches to canvas mode', () => {
    const state = plotBoardReducer(getInitialState(), plotBoardActions.setActiveMode('canvas'));
    expect(selectActiveMode({ plotBoard: state })).toBe('canvas');
  });

  it('resets draw state when leaving canvas', () => {
    let state = getInitialState();
    state = plotBoardReducer(state, plotBoardActions.setActiveMode('canvas'));
    state = plotBoardReducer(state, plotBoardActions.startDrawConnection('scene-a'));
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(true);
    state = plotBoardReducer(state, plotBoardActions.setActiveMode('swimlane'));
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(false);
  });
});

// ── Viewport ──────────────────────────────────────────────────────────────

describe('plotBoard — viewport', () => {
  it('clamps zoom to 0.25–4', () => {
    let state = plotBoardReducer(getInitialState(), plotBoardActions.setZoom(0.01));
    expect(state.zoom).toBe(0.25);
    state = plotBoardReducer(getInitialState(), plotBoardActions.setZoom(99));
    expect(state.zoom).toBe(4);
  });

  it('sets pan', () => {
    const state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setPan({ panX: 100, panY: -50 }),
    );
    expect(state.panX).toBe(100);
    expect(state.panY).toBe(-50);
  });

  it('resets viewport', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setPan({ panX: 200, panY: 100 }),
    );
    state = plotBoardReducer(state, plotBoardActions.setZoom(2));
    state = plotBoardReducer(state, plotBoardActions.resetViewport());
    expect(state.zoom).toBe(1);
    expect(state.panX).toBe(0);
    expect(state.panY).toBe(0);
  });

  it('toggles snap-to-grid', () => {
    let state = plotBoardReducer(getInitialState(), plotBoardActions.setSnapToGrid(true));
    expect(selectSnapToGrid({ plotBoard: state })).toBe(true);
    state = plotBoardReducer(state, plotBoardActions.setSnapToGrid(false));
    expect(selectSnapToGrid({ plotBoard: state })).toBe(false);
  });
});

// ── Draw mode (UI state — connection creation is in projectSlice) ──────────

describe('plotBoard — draw mode', () => {
  it('starts draw mode', () => {
    const state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.startDrawConnection('scene-a'),
    );
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(true);
    expect(state.drawFromSectionId).toBe('scene-a');
  });

  it('cancels draw mode', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.startDrawConnection('scene-a'),
    );
    state = plotBoardReducer(state, plotBoardActions.cancelDrawConnection());
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(false);
    expect(state.drawFromSectionId).toBeNull();
  });

  it('finishDrawConnection clears draw UI state (connection created separately in projectSlice)', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.startDrawConnection('scene-a'),
    );
    state = plotBoardReducer(state, plotBoardActions.finishDrawConnection());
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(false);
    expect(state.drawFromSectionId).toBeNull();
  });
});

// ── Connection selection (UI state) ──────────────────────────────────────

describe('plotBoard — connection selection', () => {
  it('sets selected connection', () => {
    const state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setSelectedConnection('conn-1'),
    );
    expect(selectSelectedConnectionId({ plotBoard: state })).toBe('conn-1');
  });

  it('deselects connection with null', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setSelectedConnection('conn-1'),
    );
    state = plotBoardReducer(state, plotBoardActions.setSelectedConnection(null));
    expect(selectSelectedConnectionId({ plotBoard: state })).toBeNull();
  });
});

// ── Subplot filter (UI state) ─────────────────────────────────────────────

describe('plotBoard — subplot filter', () => {
  it('sets active subplot filter', () => {
    const state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setActiveSubplotFilter('sp-1'),
    );
    expect(selectActiveSubplotFilter({ plotBoard: state })).toBe('sp-1');
  });

  it('clears subplot filter with null', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setActiveSubplotFilter('sp-1'),
    );
    state = plotBoardReducer(state, plotBoardActions.setActiveSubplotFilter(null));
    expect(selectActiveSubplotFilter({ plotBoard: state })).toBeNull();
  });
});
