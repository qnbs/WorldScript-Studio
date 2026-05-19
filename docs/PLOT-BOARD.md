# Plot-Board v2 — Architecture & Reference

## Overview

Plot-Board v2 is StoryCraft's free-form scene canvas, replacing the swimlane-only view with three co-existing modes: **Swimlane** (Kanban), **Canvas** (free-form), and **Timeline** (Gantt-like). All modes share the same underlying data (`StorySection[]`) — no duplication.

## State Architecture

The canvas viewport, connections, subplots, and tension overrides live in a **separate Redux slice** (`features/plotBoard/plotBoardSlice.ts`) that is:

- **NOT** wrapped by `redux-undo` — pan/zoom actions should not enter the undo history.
- Persisted to `localStorage` (key `storycraft-plot-board`) via `plotBoardPersistenceMiddleware`.
- Reset on page load for drawing state (`isDrawingConnection`, `drawFromSectionId`, `selectedConnectionId`).

**Scene content** (title, summary, status, color, `position`) stays in `projectSlice` and is undo-able.

## Components

| File | Responsibility |
|------|---------------|
| `components/scene-board/PlotCanvas.tsx` | Canvas wrapper — CSS transform pan/zoom, pointer events, mini-map |
| `components/scene-board/ConnectionLayer.tsx` | SVG bezier paths for plot connections (inside transform div) |
| `components/scene-board/ConnectionToolbar.tsx` | Floating toolbar for the selected connection |
| `components/scene-board/SubplotPanel.tsx` | Collapsible subplot sidebar |
| `components/scene-board/TensionCurvePanel.tsx` | Collapsible SVG tension chart |
| `components/scene-board/SceneCard.tsx` | Sortable scene card (swimlane mode) |
| `components/scene-board/ActSwimlane.tsx` | Act column in swimlane mode |
| `components/SceneBoardView.tsx` | Orchestrator — mode tabs, context provider |

## Connection Types

| Type | Icon | Color | Curve style |
|------|------|-------|-------------|
| `cause-effect` | → | `#ef4444` | Vertical bow bezier |
| `parallel` | ∥ | `#3b82f6` | Horizontal S-curve, dashed stroke |
| `subplot` | ⊃ | `#8b5cf6` | Vertical bow bezier |
| `temporal` | ↔ | `#f59e0b` | Vertical bow bezier |
| `character-arc` | ♡ | `#10b981` | Vertical bow bezier |

When a connection has a `subplotId`, it inherits the subplot's color (overrides type default).

### Drawing Connections

1. Click the draw-connection button on a card (or trigger via `plotBoardActions.startDrawConnection`).
2. `isDrawingConnection` becomes `true`; the canvas cursor turns crosshair.
3. A dashed preview line tracks the cursor (canvas-space cursor position passed from `PlotCanvas` → `ConnectionLayer`).
4. Click a destination card → `finishDrawConnection` is dispatched (self-loops rejected).
5. Press Escape or change mode to cancel.

## Subplots

Subplots are stored as an `EntityState<Subplot>` in `plotBoardSlice`. Each subplot has a color and an array of `sectionIds`. The **SubplotPanel** dispatches:

- `addSubplot` / `deleteSubplot` / `updateSubplot`
- `assignSectionToSubplot` / `removeSectionFromSubplot`
- `setActiveSubplotFilter` — dims canvas cards not in the active subplot

## Tension Curve

`computeTensionCurve(sections, tensionOverrides)` (in `services/plotBoardService.ts`) maps each section to a 0–10 score:

| Status | Auto-score |
|--------|-----------|
| `draft` | 2 |
| `outline` | 3 |
| `first-draft` | 5 |
| `revised` | 7 |
| `final` | 9 |

User can drag a dot to override. Overrides dispatch `setTensionOverride`. Reset dispatches `clearAllTensionOverrides`.

## Beat Sheet Presets

Beat sheets are **static SVG overlay markers** — no AI calls, no new dependencies. Vertical dashed lines at proportional X positions. Available presets:

- `three-act` — 3 beats (Act 1 End, Midpoint, Act 2 End)
- `save-the-cat` — 15 beats at standard Blake Snyder positions
- `hero's-journey` — 12 stages (Campbell)

## Mobile Gestures

| Gesture | Action |
|---------|--------|
| One finger drag on background | Pan canvas |
| Two finger pinch | Zoom (0.25×–4×) |
| Two finger drag | Pan (via pinch midpoint) |
| Wheel | Zoom |
| ⊞ button | Toggle snap-to-grid (8px) |

Canvas pointer events use `setPointerCapture` for reliable drag even when the pointer leaves the element.

## Coordinate Systems

The canvas uses CSS transforms: `translate(panX, panY) scale(zoom)`. To convert screen coordinates to canvas coordinates:

```typescript
const canvasX = (screenX - panX) / zoom;
const canvasY = (screenY - panY) / zoom;
```

`ConnectionLayer` is rendered **inside** the transformed div, so its SVG coordinates match card positions directly (no coordinate conversion needed).

## Key Constraints

- Max zoom: 4× / Min zoom: 0.25× (clamped in `setZoom` reducer)
- Max connections rendered comfortably: ~50 (no adapter, plain array)
- Canvas virtual size: 2400×1600px (configurable via `canvasBounds` state in `PlotCanvas`)
- Snap grid: 8px
