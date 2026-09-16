/**
 * useGlobalCopilot — business logic for the Global AI Copilot live assistant.
 * QNBS-v3: Streams replies via useWorldScriptAI (honours the privacy/local-first AI policy), is
 * context-aware (current view + project), bridges to ProForge through the Core Capability Layer,
 * drives the heuristic insight generator, and supports a heuristics-only offline mode.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useTransientUiStore } from '../app/transientUiStore';
import { useCommandExecutor } from '../contexts/CommandExecutorContext';
import {
  copilotActions,
  selectCopilotError,
  selectCopilotGeneratedForProjectIdentity,
  selectCopilotIsOpen,
  selectCopilotMessages,
  selectCopilotStatus,
} from '../features/copilot/copilotSlice';
import { selectEnableProForge } from '../features/featureFlags/featureFlagsSlice';
import {
  captureActiveProjectIdentity,
  getProjectTargetIdentity,
  identityUnchanged,
} from '../features/project/projectIdentity';
import { selectProjectData } from '../features/project/projectSelectors';
import { projectActions } from '../features/project/projectSlice';
import { getAiErrorMessage } from '../services/ai/aiErrorTaxonomy';
import { approximateManuscriptWordCount } from '../services/commands/wordCountApprox';
import { applyTextEdit } from '../services/copilot/actionApplier';
import { detectCopilotIntent, runCopilotDiagnostic } from '../services/copilot/copilotActions';
import {
  assembleCopilotPrompt,
  buildSystemPrompt,
  type CopilotContext,
} from '../services/copilot/copilotContextService';
import {
  cancelInsightGeneration,
  scheduleInsightGeneration,
} from '../services/copilot/insightGenerator';
import { createBrowserProForgeCapability } from '../services/proForge/adapters/browserProForgeCapability';
import type { ProForgeProjectSnapshot } from '../services/proForge/proForgeCapabilityCore';
import { viewNavigationLabelKey } from '../services/viewNavigationLabels';
import type { View } from '../types';
import { useTranslation } from './useTranslation';
import { useWorldScriptAI } from './useWorldScriptAI';

/** Subset of the project shape the snapshot reads — avoids `any` while staying tolerant. */
interface ProjectLike {
  id?: string;
  title?: string;
  logline?: string;
  manuscript?: Array<{ id: string; title?: string; content?: string }>;
  characters?: { entities?: Record<string, unknown> };
  worlds?: { entities?: Record<string, unknown> };
}

/** Map the live Redux project into the portable snapshot the capability layer expects. */
function toSnapshot(project: ProjectLike | null | undefined): ProForgeProjectSnapshot | null {
  if (!project) return null;
  return {
    id: project.id ?? 'default',
    title: project.title ?? '',
    logline: project.logline ?? '',
    manuscript: (project.manuscript ?? []).map((s) => ({
      id: s.id,
      title: s.title ?? '',
      content: s.content ?? '',
    })),
    characters: Object.values(project.characters?.entities ?? {})
      .filter(Boolean)
      .map((c: unknown) => ({ id: (c as { id: string }).id, name: (c as { name: string }).name })),
    worlds: Object.values(project.worlds?.entities ?? {})
      .filter(Boolean)
      .map((w: unknown) => ({ id: (w as { id: string }).id, name: (w as { name: string }).name })),
  };
}

export function useGlobalCopilot(currentView: View) {
  const dispatch = useAppDispatch();
  const { t, language } = useTranslation();
  const executeCommand = useCommandExecutor();

  const isOpen = useAppSelector(selectCopilotIsOpen);
  const messages = useAppSelector(selectCopilotMessages);
  const status = useAppSelector(selectCopilotStatus);
  const error = useAppSelector(selectCopilotError);
  const generatedForProjectIdentity = useAppSelector(selectCopilotGeneratedForProjectIdentity);
  // QNBS-v3: panel-only overlay state lives in transientUiStore, not Redux (CodeAnt findings)
  const proactiveInsights = useTransientUiStore((s) => s.copilotInsights);
  // QNBS-v3: Ref tracks latest insight count without triggering buildContext re-identity —
  // prevents the feedback loop: insights update → buildContext changes → useEffect refires.
  const proactiveInsightsRef = useRef(proactiveInsights);
  proactiveInsightsRef.current = proactiveInsights;
  const heuristicsOnly = useTransientUiStore((s) => s.copilotHeuristicsOnly);
  const insightStatus = useTransientUiStore((s) => s.copilotInsightStatus);
  const setCopilotInsights = useTransientUiStore((s) => s.setCopilotInsights);
  const setCopilotHeuristicsOnly = useTransientUiStore((s) => s.setCopilotHeuristicsOnly);
  const setCopilotInsightStatus = useTransientUiStore((s) => s.setCopilotInsightStatus);
  const activeSectionId = useTransientUiStore((s) => s.activeSectionId);
  const project = useAppSelector(selectProjectData);
  // QNBS-v3: optional chaining -- getProjectTargetIdentity already handles null/undefined (fail-closed to null), and some mounted contexts (e.g. minimal test stores) may not have a project key at all.
  const projectIdentity = useAppSelector((state) =>
    getProjectTargetIdentity(state.project?.present),
  );
  // QNBS-v3 (#713): two different id-less project replacements both resolve to identity null, which projectIdentity alone can't tell apart -- combined with generation (which always bumps on import/restore) for the stream-cancellation effect below (fail-closed, mirrors app/listenerMiddleware.ts's predicate).
  const projectGeneration = useAppSelector((state) => state.project?.present?.generation ?? 0);
  // QNBS-v3: Phase 2 — apply-to-chapter status (transient, ephemeral)
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applying' | 'success' | 'error'>('idle');
  const enableProForge = useAppSelector(selectEnableProForge);

  // QNBS-v3 (#713): the identity the currently in-flight send targets -- checked live inside the streaming callbacks below since they're shared/stable and don't otherwise know which send they belong to.
  const sendTargetIdentityRef = useRef<string | null>(null);

  const { runCompletion, stop, isLoading } = useWorldScriptAI({
    source: 'copilot',
    onIncremental: (full) => {
      // QNBS-v3 (#713): discard a stale stream chunk if the project changed since this send started.
      if (!identityUnchanged(sendTargetIdentityRef.current, captureActiveProjectIdentity())) return;
      dispatch(copilotActions.setLastAssistantContent(full));
    },
    onFinish: () => {
      if (!identityUnchanged(sendTargetIdentityRef.current, captureActiveProjectIdentity())) return;
      dispatch(copilotActions.finishLastAssistant());
      dispatch(copilotActions.setStatus('idle'));
    },
    onError: (err) => {
      if (!identityUnchanged(sendTargetIdentityRef.current, captureActiveProjectIdentity())) return;
      // QNBS-v3 (Batch 1.2): show an actionable, classified message (e.g. "Invalid API key —
      // open Settings → AI…") instead of the generic copilot.error fallback.
      dispatch(copilotActions.setLastAssistantContent(getAiErrorMessage(err, t)));
      dispatch(copilotActions.finishLastAssistant());
      dispatch(copilotActions.setError(err.message));
    },
  });

  // QNBS-v3 (#713): combines identity + generation (not identity alone) since two different id-less project replacements both resolve to identity null -- genuinely read (compare-against-previous-value) so no lint suppression is needed.
  const copilotInvalidationKey = `${projectIdentity ?? ''}:${projectGeneration}`;
  const prevCopilotIdentityRef = useRef(copilotInvalidationKey);
  // QNBS-v3 (#713): actually cancel the in-flight stream on a project switch -- invalidateForProjectChange (listener middleware) only resets Redux state; without this, the old stream keeps running and its callbacks (guarded above) become no-ops at best, while still wasting the request.
  useEffect(() => {
    if (prevCopilotIdentityRef.current === copilotInvalidationKey) return;
    prevCopilotIdentityRef.current = copilotInvalidationKey;
    stop();
  }, [copilotInvalidationKey, stop]);

  const buildContext = useCallback(
    (): CopilotContext => ({
      view: currentView,
      viewLabel: t(viewNavigationLabelKey(currentView)),
      projectTitle: project?.title ?? '',
      wordCount: approximateManuscriptWordCount(project),
      language,
      // QNBS-v3: Enriched context for smarter AI prompting and dynamic suggestions.
      chapterCount: project?.manuscript?.length ?? 0,
      characterCount: Object.keys(project?.characters?.entities ?? {}).length,
      worldEntryCount: Object.keys(project?.worlds?.entities ?? {}).length,
      outlineCompleteness:
        project?.outline && project.outline.length > 0
          ? project.outline.filter((o) => o.description && o.description.trim().length > 5).length /
            project.outline.length
          : 0,
      // QNBS-v3: activeChapterId is omitted here (populated by Manuscript view in Phase 2).
      selectedText: '',
      openInsightCount: proactiveInsightsRef.current.length,
    }),
    // QNBS-v3: proactiveInsights excluded — reading via ref breaks the feedback loop where
    // insight updates re-trigger generation. Biome correctly exempts ref.current from deps.
    [currentView, t, project, language],
  );

  // QNBS-v3: Schedule proactive insight generation whenever project or language changes.
  // Cancelled on unmount / Copilot clear so we never dispatch into an unmounted component.
  useEffect(() => {
    if (!project) {
      // QNBS-v3: reset so status never stays stuck as 'running' after a project is unloaded
      setCopilotInsightStatus('idle');
      setCopilotInsights([]);
      return;
    }
    setCopilotInsightStatus('running');
    scheduleInsightGeneration(project, buildContext(), (findings) => {
      setCopilotInsights(findings);
      setCopilotInsightStatus('idle');
    });
    return () => {
      cancelInsightGeneration();
    };
    // QNBS-v3: `language` is already captured inside `buildContext` (its own dep), so removing
    // it from this array prevents the exhaustive-deps lint warning for a redundant dependency.
  }, [project, buildContext, setCopilotInsights, setCopilotInsightStatus]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'streaming') return;

      dispatch(copilotActions.setError(null));
      dispatch(copilotActions.addMessage('user', trimmed));
      // QNBS-v3 (#713): captured once per send, covering every reply path below -- applyLastSuggestion checks it later since copilotSlice is global Redux and survives a panel close/reopen across a project switch. Also drives sendTargetIdentityRef, which the streaming callbacks above check live (they're shared/stable and don't otherwise know which send they belong to).
      const targetProjectIdentity = captureActiveProjectIdentity();
      sendTargetIdentityRef.current = targetProjectIdentity;
      dispatch(copilotActions.setGeneratedForProjectIdentity(targetProjectIdentity));

      // QNBS-v3: Heuristics-only mode — skip all AI calls and reply with a summary of
      // current insights (offline, privacy-maximal).
      if (heuristicsOnly) {
        const reply =
          proactiveInsights.length > 0
            ? [
                t('copilot.heuristicsOnlyReply'),
                ...proactiveInsights.map(
                  (f) => `• ${t(f.titleKey, f.params)}: ${t(f.descriptionKey, f.params)}`,
                ),
              ].join('\n')
            : t('copilot.heuristicsOnlyNoFindings');
        dispatch(copilotActions.addMessage('assistant', reply));
        return;
      }

      // QNBS-v3: ProForge bridge — a "run a diagnostic" intent runs the intake stage via the
      // Core Capability Layer instead of a plain chat completion.
      const intent = detectCopilotIntent(trimmed);
      const snapshot = toSnapshot(project);
      if (intent === 'diagnostic' && enableProForge && snapshot) {
        dispatch(copilotActions.addMessage('assistant', t('copilot.runningDiagnostic'), true));
        dispatch(copilotActions.setStatus('streaming'));
        const capability = createBrowserProForgeCapability({
          getProject: () => snapshot,
          isEnabled: () => enableProForge,
        });
        const result = await runCopilotDiagnostic(capability, snapshot.id);
        // QNBS-v3 (#713): discard the diagnostic result if the project changed while it ran -- invalidateForProjectChange doesn't cancel this await, and the caller passes no AbortSignal to runCopilotDiagnostic.
        if (!identityUnchanged(targetProjectIdentity, captureActiveProjectIdentity())) return;
        const reply = result
          ? t('copilot.diagnosticResult', { score: result.score, summary: result.summary })
          : t('copilot.diagnosticFailed');
        dispatch(copilotActions.setLastAssistantContent(reply));
        dispatch(copilotActions.finishLastAssistant());
        dispatch(copilotActions.setStatus('idle'));
        return;
      }

      // Default: stream a context-aware chat completion.
      dispatch(copilotActions.addMessage('assistant', '', true));
      dispatch(copilotActions.setStatus('streaming'));
      const systemPrompt = buildSystemPrompt(buildContext());
      const prompt = assembleCopilotPrompt(
        systemPrompt,
        messages.map((m) => ({ role: m.role, content: m.content })),
        trimmed,
      );
      await runCompletion(prompt);
    },
    [
      status,
      dispatch,
      project,
      enableProForge,
      t,
      buildContext,
      messages,
      runCompletion,
      heuristicsOnly,
      proactiveInsights,
    ],
  );

  const open = useCallback(() => dispatch(copilotActions.setOpen(true)), [dispatch]);
  const close = useCallback(() => {
    stop();
    // QNBS-v3 (CodeAnt #7): stop() can abort the stream without firing useWorldScriptAI's
    // onFinish/onError, leaving status stuck at 'streaming' — after which sendMessage's
    // `status === 'streaming'` guard blocks every future send. Reset to idle on close so the
    // panel is usable again next time it opens.
    if (status === 'streaming') {
      dispatch(copilotActions.finishLastAssistant());
      dispatch(copilotActions.setStatus('idle'));
    }
    dispatch(copilotActions.setOpen(false));
  }, [dispatch, stop, status]);
  const toggle = useCallback(() => dispatch(copilotActions.toggle()), [dispatch]);
  const clear = useCallback(() => {
    stop();
    // QNBS-v3: cancel pending debounce so the scheduled insight callback can't fire after clear
    // and immediately repopulate insights (generation-token-free guard via direct cancel)
    cancelInsightGeneration();
    dispatch(copilotActions.clear());
    // QNBS-v3: reset panel overlay state in Zustand on clear (insights + status, not heuristicsOnly)
    setCopilotInsights([]);
    setCopilotInsightStatus('idle');
  }, [dispatch, stop, setCopilotInsights, setCopilotInsightStatus]);
  const toggleHeuristicsOnly = useCallback(
    () => setCopilotHeuristicsOnly(!heuristicsOnly),
    [setCopilotHeuristicsOnly, heuristicsOnly],
  );

  // QNBS-v3: Phase 2 — apply the code block from the last assistant message to the active section.
  // Uses applyTextEdit (offset-safe via applyReviewEditsToSection); dispatches into redux-undo
  // so Ctrl+Z always reverses the change.
  const applyLastSuggestion = useCallback(
    (codeBlock: string) => {
      if (!activeSectionId || !project) return;
      // QNBS-v3 (#713): reject applying a reply that targeted a different project incarnation -- copilotSlice is global Redux, so a stale reply can otherwise outlive a project switch and get inserted into the wrong project's manuscript.
      if (!identityUnchanged(generatedForProjectIdentity, captureActiveProjectIdentity())) return;
      const section = project.manuscript.find((s) => s.id === activeSectionId);
      if (!section) return;

      const existingContent = section.content ?? '';
      // QNBS-v3: CodeAnt — partial snippets must not silently overwrite the whole chapter.
      // Only proceed if the section is empty or the block is ≥70% of existing content length
      // (clear full-chapter-rewrite intent). Shorter blocks are rejected to prevent data loss.
      const isFullRewrite =
        !existingContent.trim() || codeBlock.length / Math.max(existingContent.length, 1) >= 0.7;
      if (!isFullRewrite) {
        setApplyStatus('error');
        setTimeout(() => setApplyStatus('idle'), 3000);
        return;
      }

      setApplyStatus('applying');
      try {
        const result = applyTextEdit(existingContent, '', codeBlock);
        if (result.applied > 0) {
          dispatch(
            projectActions.updateManuscriptSection({
              id: activeSectionId,
              changes: { content: result.content },
            }),
          );
          setApplyStatus('success');
        } else {
          setApplyStatus('error');
        }
      } catch {
        setApplyStatus('error');
      }
      // Auto-clear feedback after 3s
      setTimeout(() => setApplyStatus('idle'), 3000);
    },
    [activeSectionId, project, dispatch, generatedForProjectIdentity],
  );

  // QNBS-v3: Dynamic view + project-aware suggestions replace the static 3-string list.
  // Falls back to defaults when no project is loaded.
  const suggestions = useMemo((): string[] => {
    const defaults = [
      t('copilot.suggestionExplainView'),
      t('copilot.suggestionDiagnostic'),
      t('copilot.suggestionImprove'),
    ];

    if (!project?.title) return defaults;

    const ctx = buildContext();
    const dynamic: string[] = [];

    // View-specific suggestions
    if (
      currentView === 'sceneboard' &&
      proactiveInsights.some((f) => f.ruleId === 'tension-drop')
    ) {
      dynamic.push(t('copilot.suggestionTensionGap'));
    }
    if (currentView === 'characters' && ctx.characterCount > 0) {
      dynamic.push(t('copilot.suggestionCharacterArc'));
    }
    if (currentView === 'manuscript' && ctx.wordCount > 500) {
      dynamic.push(t('copilot.suggestionImproveOpening'));
    }
    if (currentView === 'dashboard' && proactiveInsights.length > 0) {
      dynamic.push(t('copilot.suggestionTopInsight'));
    }
    if (currentView === 'world') {
      dynamic.push(t('copilot.suggestionWorldBuilding'));
    }

    // Fill remaining slots with defaults (avoid duplicates)
    const all = [...dynamic, ...defaults];
    const seen = new Set<string>();
    return all
      .filter((s) => {
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      })
      .slice(0, 6);
  }, [t, project, currentView, proactiveInsights, buildContext]);

  return {
    t,
    isOpen,
    messages,
    status,
    error,
    isLoading,
    suggestions,
    proactiveInsights,
    heuristicsOnly,
    insightStatus,
    sendMessage,
    open,
    close,
    toggle,
    clear,
    toggleHeuristicsOnly,
    applyLastSuggestion,
    applyStatus,
    executeCommand,
  };
}

export type UseGlobalCopilotReturn = ReturnType<typeof useGlobalCopilot>;
