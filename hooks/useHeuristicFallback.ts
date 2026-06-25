/**
 * QNBS-v3: React seam for the heuristic-fallback signal. Subscribes to the module-level fallback
 * observable so any surface can show an "Assisted (offline)" state, and records each fallback to the
 * inference-telemetry sink (browser-only; routed through the analytics gate inside the service). Pure
 * UI/telemetry — never triggers a fallback, only reacts to one.
 */

import { useEffect, useState } from 'react';
import {
  getLastHeuristicFallback,
  type HeuristicFallbackEvent,
  subscribeHeuristicFallback,
} from '../services/ai/heuristicFallback';
import { recordInferenceTelemetry } from '../services/ai/telemetryService';

export function useHeuristicFallback(): HeuristicFallbackEvent | null {
  const [event, setEvent] = useState<HeuristicFallbackEvent | null>(() =>
    getLastHeuristicFallback(),
  );

  useEffect(() => {
    return subscribeHeuristicFallback((next) => {
      setEvent(next);
      // QNBS-v3: encode the fallback as a telemetry row using the existing schema (no migration) —
      // `backend: 'heuristic'`, `taskType: heuristic:<task>`, `modelId: <reasonKey>`. Best-effort.
      void recordInferenceTelemetry({
        taskType: `heuristic:${next.task}`,
        backend: 'heuristic',
        modelId: next.reasonKey,
        latencyMs: 0,
        success: true,
        timestamp: next.at,
      }).catch(() => {
        /* telemetry is best-effort and gated downstream */
      });
    });
  }, []);

  return event;
}
