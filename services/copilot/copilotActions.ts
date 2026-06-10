/**
 * Copilot actions — the bridge between the Global Copilot and the ProForge Core Capability Layer
 * (plus the command system). This is the explicit, in-process ProForge↔Copilot wiring.
 * QNBS-v3: Intent detection is pure; actions delegate to the capability layer / command executor.
 */

import type { DiagnosticReport } from '../../features/proForge/types';
import type { ProForgeCapabilityLayer } from '../proForge/proForgeCapabilityLayer';

export type CopilotIntent = 'diagnostic' | 'explainView' | null;

const DIAGNOSTIC_PATTERNS = [
  /\bdiagnos/i,
  /\banalyze (my )?(manuscript|story|book)/i,
  /\bquality score\b/i,
  /\bhealth (check|score)\b/i,
];

const EXPLAIN_VIEW_PATTERNS = [
  /what can i do (here|on this)/i,
  /how does this (screen|page) work/i,
];

/** Lightweight keyword intent detection — keeps the assistant responsive without an AI round-trip. */
export function detectCopilotIntent(text: string): CopilotIntent {
  if (DIAGNOSTIC_PATTERNS.some((re) => re.test(text))) return 'diagnostic';
  if (EXPLAIN_VIEW_PATTERNS.some((re) => re.test(text))) return 'explainView';
  return null;
}

export interface DiagnosticSummary {
  score: number;
  summary: string;
}

/**
 * Run a ProForge intake diagnostic via the Core Capability Layer and extract a friendly summary.
 * Returns null when the capability layer is unavailable or the stage fails.
 */
export async function runCopilotDiagnostic(
  capability: ProForgeCapabilityLayer,
  projectId: string,
): Promise<DiagnosticSummary | null> {
  try {
    const result = await capability.runStage({ stage: 'intake', projectId });
    const report = result.agentOutput as DiagnosticReport | undefined;
    if (!report || report.isFallback) return null;
    return {
      score: report.qualityScore?.overall ?? 0,
      summary: report.summary ?? '',
    };
  } catch {
    return null;
  }
}
