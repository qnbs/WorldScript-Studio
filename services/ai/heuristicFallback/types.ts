/**
 * Heuristic-fallback envelope + context types.
 *
 * QNBS-v3: When an AI feature cannot reach a model (offline, quota, error, Eco/Heuristics-only mode),
 * a registered per-feature heuristic generator produces a result from existing project data. This is
 * the shared envelope every generator returns — it deliberately reuses ProForge's `isFallback`
 * discriminator convention (`features/proForge/types.ts`) and adds one calibrated `confidence` field.
 * Pure data; no React, no heavy imports — safe to consume from the service layer.
 */

import type { ProjectData } from '../../../features/project/projectState';

export type HeuristicTier = 'advanced' | 'basic';

/** The result a heuristic generator returns. `T` is `string` for text tools, a typed shape for JSON. */
export interface HeuristicFallbackResult<T = string> {
  /** The heuristic output (text, or a schema-shaped object). */
  readonly data: T;
  /** Always true — marks this as a non-AI degraded result (mirrors ProForge `isFallback`). */
  readonly isFallback: true;
  /** Calibrated 0..1 quality estimate (basic templates ~0.3–0.5, context-rich ~0.6–0.8). */
  readonly confidence: number;
  /** Coarse quality band for UX (`advanced` = context-aware, `basic` = generic template). */
  readonly tier: HeuristicTier;
  /** i18n key explaining why we degraded (e.g. `error.fallback.offline`). */
  readonly reasonKey: string;
}

/** Inputs a generator may use. All optional so a generator takes only what it needs. */
export interface HeuristicContext {
  /** The original prompt (for text-generation tools that can extract context from it). */
  readonly prompt?: string;
  /** Current project data (offline-available via Redux selectors). */
  readonly project?: ProjectData;
  /** Feature-specific parameters (e.g. outline genre/idea/numChapters, target character id). */
  readonly params?: Readonly<Record<string, unknown>>;
  /** i18n key for why the fallback fired (carried through from the seam). */
  readonly reasonKey?: string;
}

export type HeuristicGenerator<T = unknown> = (
  ctx: HeuristicContext,
) => HeuristicFallbackResult<T> | null;

/** Clamp a raw score into the valid 0..1 confidence range. */
export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Factory for a well-formed envelope — generators should use this rather than building literals. */
export function makeHeuristicResult<T>(
  data: T,
  opts: { confidence: number; tier: HeuristicTier; reasonKey?: string },
): HeuristicFallbackResult<T> {
  return {
    data,
    isFallback: true,
    confidence: clampConfidence(opts.confidence),
    tier: opts.tier,
    reasonKey: opts.reasonKey ?? 'error.fallback.generic',
  };
}
