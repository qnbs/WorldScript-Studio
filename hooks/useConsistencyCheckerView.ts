import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import {
  selectAiCreativity,
  selectAllCharacters,
  selectAllWorlds,
  selectProjectData,
} from '../features/project/projectSelectors';
import { useTranslation } from '../hooks/useTranslation';
import { embedText } from '../services/ai/localEmbeddingService';
import { generateText } from '../services/aiProviderService';
import { loadStoryCodex } from '../services/codexService';
import { getPrompts } from '../services/geminiService';
import { retrieveContext } from '../services/localRagService';
import { logger } from '../services/logger';
import type { CharacterRelationship, StoryCodex } from '../types';

// QNBS-v3: structured consistency findings — the AI is asked to return a JSON array so results can
// be rendered as a severity-tagged list (mirroring the Story Bible hints) instead of a raw <pre>.
export type ConsistencySeverity = 'info' | 'warn' | 'error';

export interface ConsistencyFinding {
  /** Stable, unique id within a result set — used as the React list key. */
  id: string;
  severity: ConsistencySeverity;
  title: string;
  detail: string;
  ref?: string;
}

export type ConsistencyResult =
  | { kind: 'structured'; findings: ConsistencyFinding[] }
  | { kind: 'text'; text: string };

// QNBS-v3: tolerant severity normalization — models emit "warning", "ERROR", " High ", etc.
// Trim + lowercase, then map common variants so real problems aren't silently downgraded to info.
const normalizeSeverity = (raw: unknown): ConsistencySeverity => {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'error' || s === 'err' || s === 'critical' || s === 'high' || s === 'severe') {
    return 'error';
  }
  if (s === 'warn' || s === 'warning' || s === 'medium' || s === 'moderate') return 'warn';
  return 'info';
};

/**
 * Parse the model's response into structured findings, falling back to raw text when the output
 * is not valid finding-array JSON (so the results pane never regresses to empty).
 */
export const parseConsistencyResult = (raw: string): ConsistencyResult => {
  const fenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(fenced);
    if (Array.isArray(parsed)) {
      const findings: ConsistencyFinding[] = parsed
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f, index) => {
          const ref = typeof f['ref'] === 'string' && f['ref'] ? { ref: f['ref'] } : {};
          return {
            // QNBS-v3: id from source position guarantees a unique, stable React key even when
            // two findings share severity/title/detail (avoids list-item reuse / stale rows).
            id: String(index),
            severity: normalizeSeverity(f['severity']),
            title: typeof f['title'] === 'string' ? f['title'] : '',
            detail: typeof f['detail'] === 'string' ? f['detail'] : '',
            ...ref,
          };
        })
        .filter((f) => f.title || f.detail);
      // QNBS-v3: valid JSON array → structured, even when empty. An empty array means "no issues",
      // which the view renders as an explicit clean state rather than dumping raw "[]" as text.
      return { kind: 'structured', findings };
    }
  } catch {
    // Not JSON — fall back to the raw string below.
  }
  return { kind: 'text', text: raw };
};

export const useConsistencyCheckerView = () => {
  const { t, language } = useTranslation();
  const aiCreativity = useAppSelector(selectAiCreativity);
  const characters = useAppSelector(selectAllCharacters);
  const worlds = useAppSelector(selectAllWorlds);
  const projectData = useAppSelector(selectProjectData);
  const aiSettings = useAppSelector((state) => state.settings?.advancedAi);
  const ragMode = useAppSelector((state) => state.settings?.advancedAi?.ragMode ?? 'hybrid');
  const duckDbEnabled = useAppSelector(
    (state) => state.featureFlags?.enableDuckDbAnalytics ?? false,
  );
  const aiOptions = useMemo(
    () => ({
      provider: aiSettings?.provider,
      model: aiSettings?.model,
      temperature: aiSettings?.temperature,
      maxTokens: aiSettings?.maxTokens,
      ollamaBaseUrl: aiSettings?.ollamaBaseUrl,
    }),
    [aiSettings],
  );

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<ConsistencyResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [storyCodex, setStoryCodex] = useState<StoryCodex | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const projectId = projectData?.id || 'default';

    const loadCodex = async () => {
      if (!projectData) {
        setStoryCodex(null);
        return;
      }
      try {
        const codex = await loadStoryCodex(projectId);
        if (!cancelled) {
          setStoryCodex(codex);
        }
      } catch {
        if (!cancelled) {
          setStoryCodex(null);
        }
      }
    };

    loadCodex();

    return () => {
      cancelled = true;
    };
  }, [projectData]);

  const runCheck = useCallback(
    async (characterId: string) => {
      if (!projectData) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsChecking(true);
      try {
        const projectId = projectData.id || 'default';
        const character = characters.find((c) => c.id === characterId);

        // QNBS-v3: retrieve relevant chunks so we avoid sending the full manuscript to the AI.
        let ragChunks: string | undefined;
        if (character) {
          try {
            let queryEmb: Float32Array | undefined;
            if (ragMode === 'hybrid') {
              queryEmb = await embedText(character.name).catch(() => undefined);
            }
            const chunks = await retrieveContext(
              projectId,
              character.name,
              8,
              ragMode,
              queryEmb,
              duckDbEnabled && ragMode === 'hybrid',
            );
            if (chunks.length > 0) {
              ragChunks = chunks.map((c) => c.text).join('\n\n---\n\n');
            }
          } catch (ragErr) {
            logger.warn('RAG retrieval failed (non-critical):', ragErr);
          }
        }

        const promptArgs: {
          characterId: string;
          characters: typeof characters;
          worlds: typeof worlds;
          manuscript: typeof projectData.manuscript;
          relationships: CharacterRelationship[];
          lang: string;
          codex?: StoryCodex;
          ragChunks?: string;
        } = {
          characterId,
          characters,
          worlds,
          manuscript: projectData.manuscript,
          relationships: projectData.relationships || [],
          lang: language,
          // QNBS-v3: conditional spread avoids exactOptionalPropertyTypes violation.
          ...(ragChunks !== undefined ? { ragChunks } : {}),
        };

        if (storyCodex) {
          promptArgs.codex = storyCodex;
        }

        const { prompt } = getPrompts('consistencyCheck', promptArgs);
        const result = await generateText(prompt, aiCreativity, aiOptions, controller.signal);
        setCheckResult(parseConsistencyResult(result));
      } catch (error) {
        // QNBS-v3: treat any AbortError as a cancellation (not a failure). The provider layer can
        // surface aborts as a plain Error named 'AbortError', not only as a DOMException — and in
        // some runtimes DOMException is NOT an Error subclass — so guard on the name across both,
        // otherwise a cancelled run would overwrite a valid prior result.
        if (
          (error instanceof DOMException || error instanceof Error) &&
          error.name === 'AbortError'
        ) {
          return;
        }
        setCheckResult({
          kind: 'text',
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      } finally {
        setIsChecking(false);
        abortControllerRef.current = null;
      }
    },
    [
      characters,
      worlds,
      projectData,
      language,
      aiCreativity,
      aiOptions,
      storyCodex,
      ragMode,
      duckDbEnabled,
    ],
  );

  return {
    t,
    characters,
    selectedCharacterId,
    setSelectedCharacterId,
    checkResult,
    isChecking,
    runCheck,
    storyCodex,
  };
};
