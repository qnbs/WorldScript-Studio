// QNBS-v3: High-level analytics hook. Feature-flag branch:
//          flag=off  → returns undefined/empty (callers use existing JS/Redux path unchanged).
//          flag=on   → fetches from DuckDB; exposes isLoading so UI can show skeleton.

import { useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { selectIsDuckDbReady } from '../features/analytics/analyticsSlice';
import { selectEnableDuckDbAnalytics } from '../features/featureFlags/featureFlagsSlice';
import { selectProjectData } from '../features/project/projectSelectors';
import {
  type DailyProgressRow,
  queryDailyProgress,
  querySceneOverlaps,
  queryStreak,
  queryWeeklyProgress,
  type SceneOverlapRow,
  type WeeklyProgressRow,
} from '../services/duckdb/duckdbAnalytics';

export interface AnalyticsData {
  /** Whether DuckDB analytics are active for this session. */
  isEnabled: boolean;
  isLoading: boolean;
  /** undefined = not yet fetched or flag off */
  dailyProgress: DailyProgressRow[] | undefined;
  weeklyProgress: WeeklyProgressRow[] | undefined;
  streak: { current: number; longest: number } | undefined;
  sceneOverlaps: SceneOverlapRow[] | undefined;
}

const DEFAULT: AnalyticsData = {
  isEnabled: false,
  isLoading: false,
  dailyProgress: undefined,
  weeklyProgress: undefined,
  streak: undefined,
  sceneOverlaps: undefined,
};

export function useAnalytics(): AnalyticsData {
  const isEnabled = useAppSelector(selectEnableDuckDbAnalytics);
  const isReady = useAppSelector(selectIsDuckDbReady);
  const project = useAppSelector(selectProjectData);

  const [data, setData] = useState<AnalyticsData>({ ...DEFAULT, isEnabled });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isEnabled || !isReady) {
      setData({ ...DEFAULT, isEnabled });
      return;
    }

    const projectId = project.id ?? 'default';
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setData((prev) => ({ ...prev, isEnabled: true, isLoading: true }));

    void (async () => {
      try {
        const [daily, weekly, streak, overlaps] = await Promise.all([
          queryDailyProgress(projectId, 30, ctrl.signal),
          queryWeeklyProgress(projectId, 12, ctrl.signal),
          queryStreak(projectId, ctrl.signal),
          querySceneOverlaps(projectId, ctrl.signal),
        ]);

        if (ctrl.signal.aborted) return;

        setData({
          isEnabled: true,
          isLoading: false,
          dailyProgress: daily,
          weeklyProgress: weekly,
          streak,
          sceneOverlaps: overlaps,
        });
      } catch {
        if (!ctrl.signal.aborted) {
          setData((prev) => ({ ...prev, isLoading: false }));
        }
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [isEnabled, isReady, project.id]);

  return data;
}
