// QNBS-v3: Phase 3 — typed front-end for the Rust TaskSupervisor (src-tauri/src/commands/
//          task_supervisor.rs). Routes CPU-bound text analysis to native Rust when the
//          enableRustCompute flag is on AND a Tauri runtime exposes the supervisor;
//          otherwise returns null so callers keep their JS/main-thread path.

import { routeTask } from './hybridRouter';
import { createLogger } from './logger';
import { isRustComputeAvailable } from './tauriTaskBridge';

const log = createLogger('rustTaskSupervisor');

/** Mirror of the Rust `TextAnalysis` struct (serde camelCase). */
export interface RustTextAnalysis {
  readonly wordCount: number;
  readonly charCount: number;
  readonly charCountNoSpaces: number;
  readonly sentenceCount: number;
  readonly syllableCount: number;
  /** Flesch Reading Ease (higher = easier); 0 for empty input. */
  readonly fleschReadingEase: number;
  /** Estimated minutes to read at 200 wpm. */
  readonly readingTimeMinutes: number;
}

export type RustTextDiffOp =
  | { readonly type: 'equal'; readonly token: string }
  | { readonly type: 'delete'; readonly token: string }
  | { readonly type: 'insert'; readonly token: string };

/**
 * Analyze text via the native Rust TaskSupervisor.
 *
 * Returns `null` when Rust compute is unavailable (web context, flag off, or the
 * supervisor command is not registered) — the caller should fall back to a JS
 * implementation. We probe `isRustComputeAvailable()` first so a Rust-only task is
 * never accidentally enqueued onto the web worker pool by the hybrid router.
 */
export async function analyzeTextViaRust(
  text: string,
  opts: { rustComputeEnabled: boolean },
): Promise<RustTextAnalysis | null> {
  if (!opts.rustComputeEnabled) return null;
  if (!(await isRustComputeAvailable())) return null;

  try {
    const handle = await routeTask<RustTextAnalysis>(
      'text.analyze',
      { text },
      { target: 'rust', rustComputeEnabled: true, priority: 'low' },
    );
    if (handle === null) return null;
    return await handle.result;
  } catch (err) {
    log.warn('Rust text.analyze failed — caller should use JS fallback', { err });
    return null;
  }
}

/**
 * Run the bounded word/whitespace diff through Rust when native compute is available.
 * A null result keeps the existing TypeScript diff as the compatibility fallback.
 */
export async function diffTextViaRust(
  oldText: string,
  newText: string,
  opts: { rustComputeEnabled: boolean },
): Promise<readonly RustTextDiffOp[] | null> {
  if (!opts.rustComputeEnabled) return null;
  if (!(await isRustComputeAvailable())) return null;

  try {
    const handle = await routeTask<readonly RustTextDiffOp[]>(
      'text.diff',
      { oldText, newText },
      { target: 'rust', rustComputeEnabled: true, priority: 'low' },
    );
    if (handle === null) return null;
    return await handle.result;
  } catch (err) {
    log.warn('Rust text.diff failed — caller should use JS fallback', { err });
    return null;
  }
}
