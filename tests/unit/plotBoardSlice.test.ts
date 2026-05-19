import { describe, expect, it } from 'vitest';
import plotBoardReducer, {
  type PlotBoardState,
  plotBoardActions,
  selectActiveMode,
  selectAllSubplots,
  selectConnections,
  selectIsDrawingConnection,
  selectSelectedConnectionId,
  selectSnapToGrid,
  selectTensionOverrides,
} from '../../features/plotBoard/plotBoardSlice';
import type { PlotConnection, Subplot } from '../../types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSubplot(overrides?: Partial<Subplot>): Subplot {
  return {
    id: 'sp-1',
    name: 'Love arc',
    color: '#a855f7',
    sectionIds: [],
    ...overrides,
  };
}

function makeConnection(overrides?: Partial<PlotConnection>): PlotConnection {
  return {
    id: 'conn-1',
    fromSectionId: 'scene-a',
    toSectionId: 'scene-b',
    type: 'cause-effect',
    ...overrides,
  };
}

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

// ── Subplots ──────────────────────────────────────────────────────────────

describe('plotBoard — subplots', () => {
  it('adds a subplot', () => {
    const sp = makeSubplot();
    const state = plotBoardReducer(getInitialState(), plotBoardActions.addSubplot(sp));
    expect(selectAllSubplots({ plotBoard: state })).toHaveLength(1);
    expect(selectAllSubplots({ plotBoard: state })[0]!.name).toBe('Love arc');
  });

  it('updates a subplot name', () => {
    let state = plotBoardReducer(getInitialState(), plotBoardActions.addSubplot(makeSubplot()));
    state = plotBoardReducer(
      state,
      plotBoardActions.updateSubplot({ id: 'sp-1', changes: { name: 'Rivalry arc' } }),
    );
    expect(selectAllSubplots({ plotBoard: state })[0]!.name).toBe('Rivalry arc');
  });

  it('deletes a subplot and clears its filter', () => {
    let state = plotBoardReducer(getInitialState(), plotBoardActions.addSubplot(makeSubplot()));
    state = plotBoardReducer(state, plotBoardActions.setActiveSubplotFilter('sp-1'));
    state = plotBoardReducer(state, plotBoardActions.deleteSubplot('sp-1'));
    expect(selectAllSubplots({ plotBoard: state })).toHaveLength(0);
    expect(state.activeSubplotFilter).toBeNull();
  });

  it('assigns and removes a section from a subplot', () => {
    let state = plotBoardReducer(getInitialState(), plotBoardActions.addSubplot(makeSubplot()));
    state = plotBoardReducer(
      state,
      plotBoardActions.assignSectionToSubplot({ sectionId: 'scene-x', subplotId: 'sp-1' }),
    );
    expect(selectAllSubplots({ plotBoard: state })[0]!.sectionIds).toContain('scene-x');
    state = plotBoardReducer(
      state,
      plotBoardActions.removeSectionFromSubplot({ sectionId: 'scene-x', subplotId: 'sp-1' }),
    );
    expect(selectAllSubplots({ plotBoard: state })[0]!.sectionIds).not.toContain('scene-x');
  });
});

// ── Connections ───────────────────────────────────────────────────────────

describe('plotBoard — connections', () => {
  it('adds a connection', () => {
    const conn = makeConnection();
    const state = plotBoardReducer(getInitialState(), plotBoardActions.addConnection(conn));
    expect(selectConnections({ plotBoard: state })).toHaveLength(1);
  });

  it('prevents duplicate connections', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.addConnection(makeConnection()),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.addConnection(makeConnection({ id: 'conn-2' })),
    );
    expect(selectConnections({ plotBoard: state })).toHaveLength(1);
  });

  it('updates a connection type', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.addConnection(makeConnection()),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.updateConnection({ id: 'conn-1', changes: { type: 'parallel' } }),
    );
    expect(selectConnections({ plotBoard: state })[0]!.type).toBe('parallel');
  });

  it('removes a connection and deselects it', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.addConnection(makeConnection()),
    );
    state = plotBoardReducer(state, plotBoardActions.setSelectedConnection('conn-1'));
    state = plotBoardReducer(state, plotBoardActions.removeConnection('conn-1'));
    expect(selectConnections({ plotBoard: state })).toHaveLength(0);
    expect(selectSelectedConnectionId({ plotBoard: state })).toBeNull();
  });

  it('removes all connections for a deleted section', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.addConnection(makeConnection()),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.addConnection(
        makeConnection({ id: 'c2', fromSectionId: 'scene-c', toSectionId: 'scene-a' }),
      ),
    );
    state = plotBoardReducer(state, plotBoardActions.removeConnectionsForSection('scene-a'));
    expect(selectConnections({ plotBoard: state })).toHaveLength(0);
  });
});

// ── Draw mode ─────────────────────────────────────────────────────────────

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

  it('finishes draw and creates connection', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.startDrawConnection('scene-a'),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.finishDrawConnection({
        toSectionId: 'scene-b',
        type: 'cause-effect',
        newId: 'new-conn',
      }),
    );
    expect(selectConnections({ plotBoard: state })).toHaveLength(1);
    expect(selectIsDrawingConnection({ plotBoard: state })).toBe(false);
  });

  it('rejects self-loop in draw mode', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.startDrawConnection('scene-a'),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.finishDrawConnection({
        toSectionId: 'scene-a',
        type: 'cause-effect',
        newId: 'self',
      }),
    );
    expect(selectConnections({ plotBoard: state })).toHaveLength(0);
  });
});

// ── Tension overrides ─────────────────────────────────────────────────────

describe('plotBoard — tension overrides', () => {
  it('sets a tension override clamped to 0–10', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setTensionOverride({ sectionId: 's1', score: 15 }),
    );
    expect(selectTensionOverrides({ plotBoard: state })['s1']).toBe(10);
    state = plotBoardReducer(
      state,
      plotBoardActions.setTensionOverride({ sectionId: 's1', score: -5 }),
    );
    expect(selectTensionOverrides({ plotBoard: state })['s1']).toBe(0);
  });

  it('clears a single tension override', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setTensionOverride({ sectionId: 's1', score: 7 }),
    );
    state = plotBoardReducer(state, plotBoardActions.clearTensionOverride('s1'));
    expect(selectTensionOverrides({ plotBoard: state })['s1']).toBeUndefined();
  });

  it('clears all tension overrides', () => {
    let state = plotBoardReducer(
      getInitialState(),
      plotBoardActions.setTensionOverride({ sectionId: 's1', score: 7 }),
    );
    state = plotBoardReducer(
      state,
      plotBoardActions.setTensionOverride({ sectionId: 's2', score: 3 }),
    );
    state = plotBoardReducer(state, plotBoardActions.clearAllTensionOverrides());
    expect(Object.keys(selectTensionOverrides({ plotBoard: state }))).toHaveLength(0);
  });
});
