import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import {
  captureActiveProjectIdentity,
  identityUnchanged,
  isExpectedAiCancellationError,
} from '../features/project/projectIdentity';
import { selectProjectData } from '../features/project/projectSelectors';
import {
  type PlotBeatSuggestion,
  suggestNextBeatThunk,
} from '../features/project/thunks/plotBoardAiThunks';
import type { PlotBeatHeuristicLabels } from '../services/ai/heuristicFallback/generators/plotBoardGenerator';
import { useTranslation } from './useTranslation';

function ownsPlotBoardRequest(
  requestRef: { current: number },
  requestId: number,
  originIdentity: string | null,
): boolean {
  return (
    requestRef.current === requestId &&
    identityUnchanged(originIdentity, captureActiveProjectIdentity())
  );
}

export function usePlotBoardAi(plotSummary: string, selectedSectionIds: string[]) {
  const dispatch = useAppDispatch();
  const { language, t } = useTranslation();
  const project = useAppSelector(selectProjectData);
  const [beats, setBeats] = useState<PlotBeatSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ragChunkCount, setRagChunkCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const activeProjectIdentity = captureActiveProjectIdentity();
  const summaryIsEligible = plotSummary.trim().length > 0;
  const requestContextKey = `${activeProjectIdentity ?? ''}\u0002${plotSummary}\u0000${selectedSectionIds.join('\u0001')}\u0000${language}`;
  const requestContextRef = useRef(requestContextKey);

  useEffect(() => {
    // QNBS-v3: input/project replacement invalidates an in-flight request before its result can publish.
    if (requestContextRef.current === requestContextKey) return;
    requestContextRef.current = requestContextKey;
    requestRef.current += 1;
    setIsLoading(false);
  }, [requestContextKey]);

  const suggestNextBeat = useCallback(async () => {
    if (!project || !summaryIsEligible) {
      requestRef.current += 1;
      setIsLoading(false);
      return;
    }
    // QNBS-v3: resolve offline next-beat labels here (the hook has t) so the generator stays pure.
    const beat = (key: string) => ({
      title: t(`plotBoard.heuristic.${key}.title`),
      description: t(`plotBoard.heuristic.${key}.description`),
      rationale: t(`plotBoard.heuristic.${key}.rationale`),
    });
    const heuristicLabels: PlotBeatHeuristicLabels = {
      position: t('plotBoard.heuristic.position'),
      beats: [beat('escalate'), beat('complicate'), beat('reverse')],
    };
    // QNBS-v3: a superseded request must not clear loading or publish results owned by its successor.
    const requestId = ++requestRef.current;
    const originIdentity = captureActiveProjectIdentity();
    const ownsRequest = () => ownsPlotBoardRequest(requestRef, requestId, originIdentity);
    setIsLoading(true);
    setError(null);
    try {
      const action = await dispatch(
        suggestNextBeatThunk({
          plotSummary,
          selectedSectionIds,
          lang: language,
          heuristicLabels,
        }),
      ).unwrap();
      if (!ownsRequest()) return;
      setBeats(action.beats);
      setRagChunkCount(action.ragChunkCount);
    } catch (err) {
      if (!ownsRequest()) return;
      if (isExpectedAiCancellationError(err)) return;
      setError(err instanceof Error ? err.message : String(err));
      setBeats([]);
    } finally {
      if (ownsRequest()) setIsLoading(false);
    }
  }, [dispatch, project, plotSummary, selectedSectionIds, language, summaryIsEligible, t]);

  return {
    t,
    beats,
    isLoading,
    ragChunkCount,
    error,
    suggestNextBeat,
    clearBeats: () => setBeats([]),
  };
}
