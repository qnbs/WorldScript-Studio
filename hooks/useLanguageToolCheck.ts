/**
 * QNBS-v3: Orchestrates the on-demand "Check this scene" grammar feature (PR-C1) — the bridge between
 * the pure `languageToolService` and the editor. Resolves the active locale → LanguageTool code from
 * the SSOT (`getLanguageToolCode`), enforces the privacy gate (`assertLanguageToolAllowed`), runs the
 * check on a section's text, and applies/ignores/dictionaries results. Heavy logic lives in the
 * (tested) service; this hook only wires Redux + settings + abort lifecycle.
 */

import { useCallback, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { selectManuscript } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { settingsActions } from '../features/settings/settingsSlice';
import { getLanguageToolCode } from '../i18n/locales';
import { assertLanguageToolAllowed } from '../services/languageToolClient';
import {
  applyMatchReplacement,
  checkText,
  type LanguageToolMatch,
} from '../services/languageToolService';
import { useTranslation } from './useTranslation';

export type LanguageToolUiStatus =
  | 'idle'
  | 'checking'
  | 'ok'
  | 'offline'
  | 'error'
  | 'disabled'
  | 'unsupported';

export interface UseLanguageToolCheckReturn {
  /** True when the active locale is LanguageTool-supported AND the integration is enabled. */
  available: boolean;
  /** True when the active locale has no LanguageTool coverage (feature hidden, not an error). */
  unsupportedLocale: boolean;
  status: LanguageToolUiStatus;
  matches: LanguageToolMatch[];
  /** Run a check against the given section's current content. */
  check: (sectionId: string) => Promise<void>;
  /** Apply one suggestion offset-safe into the section, then re-check (offsets shift). */
  applySuggestion: (sectionId: string, match: LanguageToolMatch, replacement: string) => void;
  /** Dismiss a single match from the current list (does not persist). */
  ignore: (match: LanguageToolMatch) => void;
  /** Persist a word to the user dictionary and drop its spelling matches from the list. */
  addToDictionary: (word: string) => void;
  /** Reset the panel. */
  clear: () => void;
}

/** Stable identity for a match within one result set (offset+rule is unique per check). */
function matchKey(match: LanguageToolMatch): string {
  return `${match.offset}:${match.length}:${match.ruleId}`;
}

export function useLanguageToolCheck(): UseLanguageToolCheckReturn {
  const dispatch = useAppDispatch();
  const { language } = useTranslation();
  const manuscript = useAppSelector(selectManuscript);
  const settings = useAppSelector((state) => state.settings);
  const [status, setStatus] = useState<LanguageToolUiStatus>('idle');
  const [matches, setMatches] = useState<LanguageToolMatch[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const ltCode = getLanguageToolCode(language);
  const unsupportedLocale = ltCode === null;
  // QNBS-v3: defensive against partial persisted settings (normalizePersistedSettings can lag a new
  // nested object) — a component must never crash on a missing settings branch (project convention).
  const enabled = settings?.integrations?.languageToolEnabled ?? false;
  const baseUrl = settings?.integrations?.languageToolBaseUrl ?? '';
  const dictionary = settings?.advancedEditor?.customDictionary ?? [];
  const available = !unsupportedLocale && enabled;

  const sectionContent = useCallback(
    (sectionId: string): string | null => {
      const section = manuscript.find((s) => s.id === sectionId);
      return section ? (section.content ?? '') : null;
    },
    [manuscript],
  );

  const check = useCallback(
    async (sectionId: string) => {
      if (unsupportedLocale || ltCode === null) {
        setStatus('unsupported');
        setMatches([]);
        return;
      }
      try {
        assertLanguageToolAllowed(settings, baseUrl);
      } catch {
        // Disabled in settings, invalid URL, or remote blocked under local-only privacy mode.
        setStatus('disabled');
        setMatches([]);
        return;
      }
      const content = sectionContent(sectionId);
      if (content === null) return;

      // Cancel any in-flight check so a rapid re-trigger never races.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('checking');
      try {
        const result = await checkText(content, ltCode, {
          baseUrl,
          signal: controller.signal,
          dictionary,
        });
        if (controller.signal.aborted) return;
        setMatches(result.matches);
        setStatus(result.status);
      } catch {
        // Aborted (superseded by a newer check) — leave the newer run to set state.
      }
    },
    [unsupportedLocale, ltCode, settings, baseUrl, dictionary, sectionContent],
  );

  const applySuggestion = useCallback(
    (sectionId: string, match: LanguageToolMatch, replacement: string) => {
      const content = sectionContent(sectionId);
      if (content === null) return;
      const next = applyMatchReplacement(content, match, replacement);
      if (next === content) return; // stale anchor — nothing applied
      dispatch(
        projectActions.updateManuscriptSection({ id: sectionId, changes: { content: next } }),
      );
      // Offsets of the remaining matches are now stale → re-check for a clean list.
      void check(sectionId);
    },
    [sectionContent, dispatch, check],
  );

  const ignore = useCallback((match: LanguageToolMatch) => {
    const key = matchKey(match);
    setMatches((prev) => prev.filter((other) => matchKey(other) !== key));
  }, []);

  const addToDictionary = useCallback(
    (word: string) => {
      const trimmed = word.trim();
      if (trimmed.length === 0) return;
      const lower = trimmed.toLowerCase();
      if (!dictionary.some((existing) => existing.toLowerCase() === lower)) {
        dispatch(settingsActions.setAdvancedEditor({ customDictionary: [...dictionary, trimmed] }));
      }
      // Drop every spelling match for this word from the visible list.
      setMatches((prev) =>
        prev.filter((other) => !(other.isSpelling && other.matchedText.toLowerCase() === lower)),
      );
    },
    [dictionary, dispatch],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMatches([]);
    setStatus('idle');
  }, []);

  return {
    available,
    unsupportedLocale,
    status,
    matches,
    check,
    applySuggestion,
    ignore,
    addToDictionary,
    clear,
  };
}
