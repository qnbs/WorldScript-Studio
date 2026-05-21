import { useCallback, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectProjectData } from '../features/project/projectSelectors';
import {
  type PlotBeatSuggestion,
  suggestNextBeatThunk,
} from '../features/project/thunks/plotBoardAiThunks';
import { useTranslation } from './useTranslation';

export function usePlotBoardAi(plotSummary: string, selectedSectionIds: string[]) {
  const dispatch = useAppDispatch();
  const { language, t } = useTranslation();
  const project = useAppSelector(selectProjectData);
  const [beats, setBeats] = useState<PlotBeatSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [ragChunkCount, setRagChunkCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const suggestNextBeat = useCallback(async () => {
    if (!project || !plotSummary.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const action = await dispatch(
        suggestNextBeatThunk({
          plotSummary,
          selectedSectionIds,
          lang: language,
        }),
      ).unwrap();
      setBeats(action.beats);
      setRagChunkCount(action.ragChunkCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBeats([]);
    } finally {
      setIsLoading(false);
    }
  }, [dispatch, project, plotSummary, selectedSectionIds, language]);

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
