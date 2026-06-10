/**
 * Shared capability resolver for the ProForge MCP server.
 * QNBS-v3: Thin glue — parses CLI args, loads an optional default project payload, and builds a
 * ProForge Capability Layer (Node adapter) per request. All business logic lives in the repo's
 * Core Capability Layer; this file only wires ports for the MCP runtime.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createNodeProForgeCapability,
  type NodeCapabilityOptions,
} from '../../../services/proForge/adapters/nodeProForgeCapability';
import type { ProForgeCapabilityLayer } from '../../../services/proForge/proForgeCapabilityLayer';
import {
  ProForgeError,
  type ProjectPayload,
} from '../../../services/proForge/proForgeCapabilitySchemas';

interface CliOptions {
  projectFile?: string;
  historyFile?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--project' || arg === '-p') && argv[i + 1]) {
      opts.projectFile = argv[++i];
    } else if ((arg === '--history' || arg === '-h') && argv[i + 1]) {
      opts.historyFile = argv[++i];
    }
  }
  return opts;
}

const cli = parseArgs(process.argv.slice(2));

export const historyFile: string | undefined = cli.historyFile;

const baseOpts: NodeCapabilityOptions = {
  ...(historyFile !== undefined && { historyFile }),
};

// QNBS-v3 (CodeAnt #4): the --project file is read LAZILY, not at module top-level. Tool modules
// import this file, so a top-level `JSON.parse(readFileSync(...))` threw during import — before
// `main().catch()` in index.ts is installed — turning a bad/missing file into an uncaught import
// crash instead of the intended clean "failed to start" path. We now read on first use and wrap
// the failure in an actionable error that the tool try/catch (or main().catch()) handles.
let startupPayloadCache: { value: unknown } | undefined;
function getStartupPayload(): unknown {
  if (cli.projectFile === undefined) return null;
  if (startupPayloadCache !== undefined) return startupPayloadCache.value;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(cli.projectFile, 'utf8'));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // QNBS-v3: actionable VALIDATION (surfaced via fail()), not a raw Error (genericized to "Internal error").
    throw ProForgeError.validation(`Failed to load --project file "${cli.projectFile}": ${reason}`);
  }
  startupPayloadCache = { value };
  return value;
}

// QNBS-v3 (CodeAnt #5): cache the built capability per effective payload. createNodeProForgeCapability
// seeds the in-process memory bank on every build, so rebuilding it on each tool call duplicated RAG
// lore and grew memory unboundedly. Keying by a stable hash of the payload means seeding runs once per
// distinct payload; a rejected build is evicted so a later retry can rebuild.
type ResolvedCapability = { cap: ProForgeCapabilityLayer; payload: ProjectPayload };
const capabilityCache = new Map<string, Promise<ResolvedCapability>>();

/**
 * Resolve a capability layer + the effective payload for a request. Prefers an inline `project`
 * argument; falls back to the startup payload. Throws a clear error when neither is present.
 */
export async function resolveCapability(inlineProject?: unknown): Promise<ResolvedCapability> {
  const raw = inlineProject ?? getStartupPayload();
  if (!raw) {
    // QNBS-v3: actionable VALIDATION error so the client sees the guidance (fail() passes
    // ProForgeError through; only unexpected errors are genericized).
    throw ProForgeError.validation(
      'No project payload available. Pass a `project` argument or start the server with --project <file>.',
    );
  }
  const key = createHash('sha1').update(JSON.stringify(raw)).digest('hex');
  let entry = capabilityCache.get(key);
  if (entry === undefined) {
    entry = (async (): Promise<ResolvedCapability> => {
      const cap = await createNodeProForgeCapability(raw, baseOpts);
      // createNodeProForgeCapability validated the payload; re-read it for projectId/config access.
      return { cap, payload: raw as ProjectPayload };
    })();
    capabilityCache.set(key, entry);
    // Don't cache a failed build — let the next call retry from scratch.
    entry.catch(() => capabilityCache.delete(key));
  }
  return entry;
}

// QNBS-v3: the pure `applyEdits` op needs no project context, so memoize one inline capability.
let inlineCapabilityCache: Promise<ProForgeCapabilityLayer> | undefined;

/** Build a capability with no project context — for the pure `applyEdits` op. */
export async function inlineCapability(): Promise<ProForgeCapabilityLayer> {
  if (inlineCapabilityCache === undefined) {
    inlineCapabilityCache = createNodeProForgeCapability({ projectId: 'inline' }, baseOpts);
    inlineCapabilityCache.catch(() => {
      inlineCapabilityCache = undefined;
    });
  }
  return inlineCapabilityCache;
}

/** Test-only: clear the per-payload capability + startup caches so cases don't leak state. */
export function _resetCapabilityCacheForTest(): void {
  capabilityCache.clear();
  inlineCapabilityCache = undefined;
  startupPayloadCache = undefined;
}
