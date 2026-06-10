/**
 * useGlobalCopilot — business logic for the Global AI Copilot live assistant.
 * QNBS-v3: Streams replies via useStoryCraftAI (honours the privacy/local-first AI policy), is
 * context-aware (current view + project), and bridges to ProForge through the Core Capability Layer.
 */

import { useCallback, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { useCommandExecutor } from '../contexts/CommandExecutorContext';
import {
  copilotActions,
  selectCopilotError,
  selectCopilotIsOpen,
  selectCopilotMessages,
  selectCopilotStatus,
} from '../features/copilot/copilotSlice';
import { selectEnableProForge } from '../features/featureFlags/featureFlagsSlice';
import { selectProjectData } from '../features/project/projectSelectors';
import { approximateManuscriptWordCount } from '../services/commands/wordCountApprox';
import { detectCopilotIntent, runCopilotDiagnostic } from '../services/copilot/copilotActions';
import {
  assembleCopilotPrompt,
  buildSystemPrompt,
  type CopilotContext,
} from '../services/copilot/copilotContextService';
import { createBrowserProForgeCapability } from '../services/proForge/adapters/browserProForgeCapability';
import type { ProForgeProjectSnapshot } from '../services/proForge/proForgeCapabilityCore';
import { viewNavigationLabelKey } from '../services/viewNavigationLabels';
import type { View } from '../types';
import { useStoryCraftAI } from './useStoryCraftAI';
import { useTranslation } from './useTranslation';

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
  const project = useAppSelector(selectProjectData);
  const enableProForge = useAppSelector(selectEnableProForge);

  const { runCompletion, stop, isLoading } = useStoryCraftAI({
    onIncremental: (full) => {
      dispatch(copilotActions.setLastAssistantContent(full));
    },
    onFinish: () => {
      dispatch(copilotActions.finishLastAssistant());
      dispatch(copilotActions.setStatus('idle'));
    },
    onError: (err) => {
      dispatch(copilotActions.setLastAssistantContent(t('copilot.error')));
      dispatch(copilotActions.finishLastAssistant());
      dispatch(copilotActions.setError(err.message));
    },
  });

  const buildContext = useCallback(
    (): CopilotContext => ({
      view: currentView,
      viewLabel: t(viewNavigationLabelKey(currentView)),
      projectTitle: project?.title ?? '',
      wordCount: approximateManuscriptWordCount(project),
      language,
    }),
    [currentView, t, project, language],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === 'streaming') return;

      dispatch(copilotActions.setError(null));
      dispatch(copilotActions.addMessage('user', trimmed));

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
    [status, dispatch, project, enableProForge, t, buildContext, messages, runCompletion],
  );

  const open = useCallback(() => dispatch(copilotActions.setOpen(true)), [dispatch]);
  const close = useCallback(() => {
    stop();
    // QNBS-v3 (CodeAnt #7): stop() can abort the stream without firing useStoryCraftAI's
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
    dispatch(copilotActions.clear());
  }, [dispatch, stop]);

  const suggestions = useMemo(
    () => [
      t('copilot.suggestionExplainView'),
      t('copilot.suggestionDiagnostic'),
      t('copilot.suggestionImprove'),
    ],
    [t],
  );

  return {
    t,
    isOpen,
    messages,
    status,
    error,
    isLoading,
    suggestions,
    sendMessage,
    open,
    close,
    toggle,
    clear,
    executeCommand,
  };
}

export type UseGlobalCopilotReturn = ReturnType<typeof useGlobalCopilot>;
