# Progress Tracker — Architecture & Reference

## Overview

The Progress Tracker Dashboard (`components/ProgressTrackerView.tsx`) gives writers a daily analytics hub: circular progress ring, live session timer, streak display, 30-day velocity chart, and a 12-week GitHub-style heatmap. All charts are pure SVG — no external chart library.

## State Architecture

`features/progressTracker/progressTrackerSlice.ts` manages the live session and goal state:

```typescript
interface ProgressTrackerState {
  dailyGoalWords: number;        // default 500; clamped ≥ 1
  weeklyGoalWords: number;       // default 2500
  activeSession: WritingSessionLive | null;
  streakDays: number;            // synced from computeStreak
  longestStreak: number;
  totalWordsAllTime: number;     // running total added by endSession
}

interface WritingSessionLive {
  startedAt: number;             // Date.now()
  startWordCount: number;        // snapshot of project total words at session start
}
```

The slice does NOT store writing history — that lives in `projectSlice` as `writingHistory: { date: string; words: number }[]`.

## Session Lifecycle

1. **Start:** `progressTrackerActions.startSession(totalWordCount)` — snapshots current word count.
2. **Live timer:** `useProgressTrackerView` runs a `setInterval(1s)` to update `sessionElapsed` local state. Cleared on `endSession`.
3. **End:** `progressTrackerActions.endSession({ currentWordCount })` — calculates `delta = max(0, current - start)`, adds to `totalWordsAllTime`, dispatches `projectActions.addWritingSession({ startedAt, endedAt, wordsWritten })` (via the hook, not the slice directly).
4. **Streak sync:** After endSession, `computeStreak(writingHistory)` is re-run and `progressTrackerActions.syncStreak` is dispatched if the result differs.

## Streak Algorithm

```typescript
export function computeStreak(history: { date: string; words: number }[]):
  { current: number; longest: number }
```

- Filters to entries where `words > 0`.
- Sorts by date ascending.
- Iterates: consecutive calendar days → increment streak; gap → reset current.
- `current` is non-zero only if the most-recent entry is today or yesterday.

## Charts

All charts use pure inline SVG (consistent with existing `CharacterGraphView` and `SceneTimelinePanel`):

| Chart | Description |
|-------|-------------|
| **ProgressRing** | Circular `<circle>` with `strokeDashoffset` computed from goal progress |
| **VelocityChart** | 30-day area chart: `<polyline>` + `<polygon>` fill + SVG gradient; `role="img"` + `aria-label` with data summary |
| **Heatmap** | 12×7 `<rect>` cells; 5 intensity colors from `#ebedf0` to `#216e39`; week-columns, day-rows |
| **WeeklyBars** | 7 mini `<rect>` bars for current week day-by-day breakdown |

## Session Keyboard Shortcut

`Ctrl+Shift+S` — registered in `hooks/useGlobalKeyboardShortcuts.ts` — toggles start/stop session.

## i18n Keys

All keys under the `progress.*` namespace (25 keys) in `locales/*/common.json`:
- `progress.title`, `progress.session.*`, `progress.daily.*`, `progress.weekly.*`
- `progress.streak.*`, `progress.velocity.*`, `progress.heatmap.*`, `progress.goal.*`
