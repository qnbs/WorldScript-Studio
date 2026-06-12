/// <reference lib="webworker" />
/**
 * Plugin Worker — Isolated execution context for StoryCraft plugins.
 * QNBS-v3: P0-1 — Plugins run inside a Function-scope sandbox with shadowed globals.
 *          P0-2 — Execution respects the AbortSignal supplied by WorkerBus v2.
 *          P0-3 — Read-only API snapshots are passed in the task payload; side effects
 *          (appendToCurrentScene, log) are collected and returned to the main thread for
 *          application. Async APIs that require main-thread state (generateText, storage)
 *          are explicitly unsupported inside the worker sandbox.
 */

import { registerTaskHandler, type WorkerHandlerContext } from '@domain/worker-bus';
import type { PluginPermission } from '../services/pluginRegistry';

// ---------------------------------------------------------------------------
// Task payload types
// ---------------------------------------------------------------------------

interface PluginExecutePayload {
  readonly pluginId: string;
  readonly code: string;
  readonly timeoutMs?: number;
  readonly grantedPermissions: readonly PluginPermission[];
  readonly readApiSnapshot: {
    readonly projectTitle: string;
    readonly sceneTitles: readonly string[];
  };
}

interface PluginSideEffect {
  readonly kind: 'append' | 'log';
  readonly payload: unknown;
}

interface PluginExecuteResult {
  readonly pluginId: string;
  readonly sideEffects: readonly PluginSideEffect[];
  readonly logs: readonly string[];
}

// ---------------------------------------------------------------------------
// Runtime guard setup
// ---------------------------------------------------------------------------

// QNBS-v3: Capture the original Function constructor before we install runtime guards.
// The worker uses this reference to build sandboxed runners; plugin code sees only the
// guarded (throwing) global Function.
const GlobalFunction = Function;

const AsyncFunction = (async () => {
  /** no-op */
}).constructor as typeof Function;
const GeneratorFunction = function* () {
  /** no-op */
}.constructor as typeof Function;
const AsyncGeneratorFunction = async function* () {
  /** no-op */
}.constructor as typeof Function;

function createDeniedConstructor(name: string): (...args: unknown[]) => never {
  return function deniedConstructor() {
    throw new Error(`${name} constructor is disabled inside the plugin sandbox`);
  };
}

interface GuardSnapshot {
  functionConstructor: (typeof Function)['prototype']['constructor'];
  asyncFunctionConstructor: (typeof Function)['prototype']['constructor'];
  generatorFunctionConstructor: (typeof Function)['prototype']['constructor'];
  asyncGeneratorFunctionConstructor: (typeof Function)['prototype']['constructor'];
  selfFunction: unknown;
  selfEval: unknown;
  selfWebAssembly: unknown;
}

/**
 * Install runtime guards that close common sandbox-escape paths.
 *
 * QNBS-v3: Shadowing dangerous globals as parameters is not enough — a plugin can still
 * reach the real Function constructor via `(function(){}).constructor`. We therefore
 * also override `Function.prototype.constructor` (and the async/generator variants) and
 * the global `Function`/`eval` bindings while the plugin runs, then restore them so the
 * dedicated worker stays healthy for subsequent tasks and tests.
 */
function installRuntimeGuards(): GuardSnapshot {
  const denied = createDeniedConstructor('Function');
  const deniedEval = function deniedEval() {
    throw new Error('eval is disabled inside the plugin sandbox');
  };

  // Snapshot originals before mutation.
  const snapshot: GuardSnapshot = {
    functionConstructor: Function.prototype.constructor,
    asyncFunctionConstructor: AsyncFunction.prototype.constructor,
    generatorFunctionConstructor: GeneratorFunction.prototype.constructor,
    asyncGeneratorFunctionConstructor: AsyncGeneratorFunction.prototype.constructor,
    selfFunction: (self as unknown as Record<string, unknown>)['Function'],
    selfEval: (self as unknown as Record<string, unknown>)['eval'],
    selfWebAssembly: (self as unknown as Record<string, unknown>)['WebAssembly'],
  };

  // Override the constructors plugin-defined functions would use to build new functions.
  // QNBS-v3: Some of these prototypes have non-writable but configurable constructors,
  // so Object.defineProperty is required instead of direct assignment.
  function defineDenied(proto: typeof Function.prototype, name: string): void {
    Object.defineProperty(proto, 'constructor', {
      value: createDeniedConstructor(name),
      writable: false,
      configurable: true,
      enumerable: false,
    });
  }

  Function.prototype.constructor = denied;
  defineDenied(AsyncFunction.prototype, 'AsyncFunction');
  defineDenied(GeneratorFunction.prototype, 'GeneratorFunction');
  defineDenied(AsyncGeneratorFunction.prototype, 'AsyncGeneratorFunction');

  // Override global bindings so direct `Function(...)` / `eval(...)` calls fail.
  // QNBS-v3: `eval` cannot be shadowed as a parameter or var in strict mode, so we neuter
  // the global binding instead. Plugin code referencing `eval` resolves to this override.
  (self as unknown as Record<string, unknown>)['Function'] = denied;
  (self as unknown as Record<string, unknown>)['eval'] = deniedEval;
  (self as unknown as Record<string, unknown>)['WebAssembly'] = undefined;

  return snapshot;
}

function restoreRuntimeGuards(snapshot: GuardSnapshot): void {
  Function.prototype.constructor = snapshot.functionConstructor;
  Object.defineProperty(AsyncFunction.prototype, 'constructor', {
    value: snapshot.asyncFunctionConstructor,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(GeneratorFunction.prototype, 'constructor', {
    value: snapshot.generatorFunctionConstructor,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  Object.defineProperty(AsyncGeneratorFunction.prototype, 'constructor', {
    value: snapshot.asyncGeneratorFunctionConstructor,
    writable: false,
    configurable: true,
    enumerable: false,
  });
  (self as unknown as Record<string, unknown>)['Function'] = snapshot.selfFunction;
  (self as unknown as Record<string, unknown>)['eval'] = snapshot.selfEval;
  (self as unknown as Record<string, unknown>)['WebAssembly'] = snapshot.selfWebAssembly;
}

// ---------------------------------------------------------------------------
// Sandbox implementation
// ---------------------------------------------------------------------------

const DENIED_GLOBALS = new Set<string>([
  'self',
  'globalThis',
  'window',
  'top',
  'parent',
  'opener',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'indexedDB',
  'caches',
  'navigator',
  'location',
  'document',
  'localStorage',
  'sessionStorage',
  'importScripts',
  'Worker',
  'SharedArrayBuffer',
  'Atomics',
  'WebAssembly',
  'Intl',
  'Function',
  'constructor',
]);

/**
 * Normalize plugin source so ESM-style entrypoints compile inside a `Function` body.
 * QNBS-v3: Plugin entrypoints are fetched as text and must not rely on module loaders
 * inside the worker. We strip import/export statements and convert the common `run`
 * export forms into a plain script binding.
 */
function normalizePluginSource(code: string): string {
  // Remove full-line import/export declarations.
  let normalized = code
    .replace(/^import\s+[^;]+;?\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '');

  // Convert the supported `run` export forms to plain declarations.
  normalized = normalized
    .replace(/\bexport\s+async\s+function\s+run\b/g, 'async function run')
    .replace(/\bexport\s+function\s+run\b/g, 'function run')
    .replace(/\bexport\s+const\s+run\b/g, 'const run')
    .replace(/\bexport\s+default\s+[^;]+;?/g, '');

  return normalized.trim();
}

/**
 * Build a sandboxed runner for plugin code.
 * QNBS-v3: Uses `new Function` with explicit parameter names so every identifier the
 * plugin references must be resolved from the supplied sandbox object. Dangerous globals
 * are intentionally absent. The plugin must export a `run(api)` function.
 */
function createSandboxedRunner(
  code: string,
  sandbox: Record<string, unknown>,
): () => ((api: Record<string, unknown>) => Promise<void> | void) | undefined {
  const normalized = normalizePluginSource(code);
  const sandboxKeys = Object.keys(sandbox);
  const sandboxValues = Object.values(sandbox);

  // QNBS-v3: Prepend a shadow-declaration for every denied global so that even if the
  // plugin tries to access them they are undefined in this scope. Also shadow
  // `globalThis`/`self` with undefined to break escape paths.
  const shadowDeclarations = Array.from(DENIED_GLOBALS)
    .map((name) => `var ${name} = undefined;`)
    .join('\n');

  // QNBS-v3: Wrap the plugin code so it can declare `run` (or `export const run`) in a
  // way that survives the Function body. We collect the declared `run` binding and
  // return it. `const`/`let` declared inside the user code stay in the function scope.
  const wrapped = `
"use strict";
${shadowDeclarations}
var run;
${normalized}
return typeof run === 'function' ? run : undefined;
`;

  try {
    // QNBS-v3: Use the captured original Function constructor so runtime guards do not
    // prevent us from creating subsequent runners in this dedicated worker.
    const fn = new GlobalFunction(...sandboxKeys, wrapped);
    return () =>
      fn(...sandboxValues) as ((api: Record<string, unknown>) => Promise<void> | void) | undefined;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Plugin code failed to compile: ${message}`);
  }
}

function assertPermission(granted: ReadonlySet<PluginPermission>, perm: PluginPermission): void {
  if (!granted.has(perm)) {
    throw new Error(`Permission denied: ${perm}`);
  }
}

function buildSandboxApi(
  payload: PluginExecutePayload,
  sideEffects: PluginSideEffect[],
  logs: string[],
) {
  const granted = new Set(payload.grantedPermissions);
  const deny = (name: string): never => {
    throw new Error(
      `${name}() is not available inside the worker sandbox. Use pluginRegistry.executeAsync() for plugins that need ${name}.`,
    );
  };

  return {
    getProjectTitle: () => {
      assertPermission(granted, 'project.read');
      return payload.readApiSnapshot.projectTitle;
    },
    getSceneTitles: () => {
      assertPermission(granted, 'scene.read');
      return payload.readApiSnapshot.sceneTitles.slice();
    },
    appendToCurrentScene: (text: string) => {
      assertPermission(granted, 'scene.write');
      if (typeof text !== 'string') {
        throw new Error('appendToCurrentScene requires a string argument');
      }
      sideEffects.push({ kind: 'append', payload: text });
    },
    log: (message: string) => {
      const entry = typeof message === 'string' ? message : String(message);
      logs.push(entry);
    },
    // QNBS-v3: These APIs are synchronous throwers. Async throwers would return a rejected
    // Promise that a plugin could ignore; synchronous throw always propagates to run().
    generateText: () => deny('generateText'),
    storageRead: () => deny('storageRead'),
    storageWrite: () => deny('storageWrite'),
  };
}

function isPluginExecutePayload(value: unknown): value is PluginExecutePayload {
  const p = value as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return false;
  if (typeof p['pluginId'] !== 'string' || typeof p['code'] !== 'string') return false;
  if (!Array.isArray(p['grantedPermissions'])) return false;
  const snap = p['readApiSnapshot'] as Record<string, unknown> | undefined;
  if (!snap || typeof snap !== 'object') return false;
  if (typeof snap['projectTitle'] !== 'string' || !Array.isArray(snap['sceneTitles'])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Task handler
// ---------------------------------------------------------------------------

registerTaskHandler('plugin.execute', async (ctx: WorkerHandlerContext) => {
  if (!isPluginExecutePayload(ctx.payload)) {
    throw new Error('Invalid plugin.execute payload');
  }

  const payload = ctx.payload;
  const sideEffects: PluginSideEffect[] = [];
  const logs: string[] = [];
  const sandboxApi = buildSandboxApi(payload, sideEffects, logs);

  // QNBS-v3: The sandbox runner receives only the API object. We deliberately do NOT
  // pass any browser globals. The plugin's `run` function is extracted and invoked.
  const runner = createSandboxedRunner(payload.code, { api: sandboxApi });

  if (ctx.signal.aborted) {
    throw new Error('Plugin execution aborted before start');
  }

  const guardSnapshot = installRuntimeGuards();

  try {
    const runFn = runner();
    if (typeof runFn !== 'function') {
      throw new Error(`Plugin '${payload.pluginId}' has no exported run() function`);
    }

    ctx.emitProgress('running', 0.5);

    // QNBS-v3: Poll the AbortSignal before and after the plugin run. Long-running
    // synchronous plugin code cannot be pre-empted, but the timeout gates subsequent
    // side-effect application and async plugins cooperate via the signal.
    if (ctx.signal.aborted) {
      throw new Error('Plugin execution aborted');
    }

    const result = runFn(sandboxApi);
    if (result && typeof (result as Promise<void>).then === 'function') {
      await result;
    }

    if (ctx.signal.aborted) {
      throw new Error('Plugin execution aborted');
    }

    ctx.emitProgress('completed', 1);

    const executeResult: PluginExecuteResult = {
      pluginId: payload.pluginId,
      sideEffects,
      logs,
    };

    // QNBS-v3: Return the payload directly. The WorkerBus bootstrap wraps it; throwing here
    // on failure keeps the worker-bus contract consistent.
    return executeResult;
  } finally {
    restoreRuntimeGuards(guardSnapshot);
  }
});

// Handle unknown task types gracefully
registerTaskHandler('plugin.ping', async () => {
  return { status: 'ok', version: '1.0.0' };
});
